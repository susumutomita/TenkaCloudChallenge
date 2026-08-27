#!/usr/bin/env python3
"""[#381] Generate the Portal editor language material from metadata, and prove it stayed generated.

The text a participant reads in the Portal editor (problem name, description,
checkpoint labels) is embedded in each course problem's Portal server, normally
``local/verifier/server.py``, inside the ``BEGIN/END GENERATED PORTAL EDITOR API``
block. Split-boundary problems keep that public server under ``local/participant``.
The source of truth for that text — Japanese and English both — is the problem's
``metadata.json``: ``name`` / ``shortDescription`` / ``scoring.checks[].label`` and
their ``i18n.en`` counterparts.

Keeping the text in the block by hand is how the English got lost in the first place:
34 verifiers shipped Japanese-only strings while the finished translations sat in
metadata. This script closes that gap in both directions.

    python3 scripts/generate-course-workbenches.py --check    # the gate: drift fails
    python3 scripts/generate-course-workbenches.py --write    # regenerate in place

What it owns:

- **Generated blocks** (problems whose ``server.py`` carries the marker): the six
  language arguments — ``problem_name`` / ``description`` / ``checkpoint_labels`` and
  their ``_en`` twins — are regenerated from metadata. ``--check`` compares parsed
  values, so quoting style never matters; ``--write`` rewrites the lines.
- **The vendored adapter** (normally ``local/verifier/workbench.py``; split-boundary
  problems use ``local/participant/workbench.py``): every copy must be
  byte-identical to the canonical source in ``scripts/course-workbench/workbench.py``.
  Vendoring is the spec — each problem must deploy self-contained — so ``--write``
  re-distributes the canonical file rather than collapsing the copies into an import.
- **Hand-written payloads** (course problems with ``server.py`` but no marker):
  their ``config_payload()`` is authored per problem, so generation cannot reach it.
  ``--check`` still fails if the English strings from metadata do not appear verbatim
  in the source — the same drift, caught at the same gate, fixed by hand.

Nothing here runs at problem runtime. The verifier reads no file outside its own
directory; this script embeds the material at authoring time (#381's constraint).
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANONICAL_ADAPTER = ROOT / "scripts" / "course-workbench" / "workbench.py"
BLOCK_BEGIN = "# BEGIN GENERATED PORTAL EDITOR API"
BLOCK_END = "# END GENERATED PORTAL EDITOR API"
# Which package holds the *participant-facing* Portal for a problem. The default
# ("verifier") is the single-stage shape. Getting an entry wrong is not cosmetic: the
# language checks below then inspect the hidden verifier instead of the page a
# participant actually reads, and pass while the Portal shows the wrong text. That is
# exactly how cs-atomic-file-publish and cs-numeric-aggregation-order came to display
# cs-http-retry-idempotency's title and description to participants (Issue 449) with
# every gate green -- their Portal is `workbench/`, which was not listed here.
PORTAL_PACKAGES = {
    "cs-transaction-visibility-audit": "participant",
    "cs-auth-claim-audit": "participant",
    "ac26-bridge-experiment": "participant",
    "ac26-bridge-properties": "participant",
    "ac26-w1-constraint-lab": "participant",
    # Issue 525: #533 moved the four answer functions out of fixtures/generate.py, but
    # the derivation they moved into (verifier/server.py's `_expected_root_cause`) still
    # shipped in the single participant stage. The Portal moved to participant/ when the
    # grader stopped shipping there.
    "ac26-w1-underconstraint": "participant",
    "ac26-w2-linear-shares": "participant",
    # Issue 537/543: every checkpoint here is graded by running tests/hidden/, which
    # shipped in the single participant stage alongside the Portal. The Portal moved to
    # participant/ when the hidden suite stopped shipping there.
    "ac26-w3-schnorr": "participant",
    # Issue 537/538 (Issue 543 option B2): the hidden suite grades all three checkpoints
    # and fixtures/generate.py defines signed_message under the exact name
    # starter/assertion.py's own stub asks the learner to write, so both left the
    # participant stage and the Portal moved with them. Its config_payload is authored
    # per problem rather than generated, so the hand-written English check follows it to
    # participant/server.py.
    "ac26-w3-passkey-assertion": "participant",
    # Issue 543 option B2: the hidden suite grades every checkpoint and fixtures/
    # implements every stub, so both left the participant stage and the Portal moved
    # with them.
    "ac26-w5-lwe-rlwe": "participant",
    # Same option B2 split, same reason: the hidden suite grades all eight checkpoints
    # and fixtures/ implements the ten stubs starter/rgsw.py ships.
    "ac26-w5-rgsw-external": "participant",
    "ac26-w5-cmux-blind-rotation": "participant",
    # Same option B2 split, same reason: the hidden suite grades all eight checkpoints and
    # fixtures/ implements seven of the twelve stubs starter/pipeline.py ships.
    "ac26-w5-pbs-homnand": "participant",
    # Same option B2 split, same reason: the hidden suite grades all eight checkpoints and
    # fixtures/ implements all six stubs starter/extract.py ships.
    "ac26-w5-extract-key-switch": "participant",
    # Issue 537/538 (Issue 543 option B2): the hidden suite grades every checkpoint and
    # fixtures/generate.py implements node_hash under the exact name starter/commit.py's
    # own node_hash stub asks the learner to write, so both left the participant stage
    # and the Portal moved with them.
    "ac26-w4-commit-open": "participant",
    # Issue 537/538 (Issue 543 option B2): the hidden suite grades every checkpoint and
    # fixtures/generate.py implements encode, centered, decode, success_interval and
    # first_failure under the exact five names starter/encoding.py's own stubs ask the
    # learner to write, so both left the participant stage and the Portal moved with them.
    "ac26-w5-encoding-noise": "participant",
    # Issue 537/538 (Issue 543 option B2): the hidden suite grades four of the five
    # checkpoints and fixtures/generate.py's reference_shares builds a correct split of
    # this deployment's secret, so both left the participant stage and the Portal moved
    # with them.
    "ac26-w2-secret-sharing": "participant",
    # Issue 537/538 (Issue 543 option B2): every one of the five checkpoints is graded by
    # running tests/hidden/check_beaver.py against the submitted file, and
    # fixtures/generate.py's setting() returns x, y, a, b and c in the clear, so both
    # left the participant stage and the Portal moved with them.
    "ac26-w2-beaver-mul": "participant",
    # Issue 537/538 (Issue 543 option B2): all seven checkpoints are graded by running
    # tests/hidden/check_auditor.py against the submitted file, and that checker's
    # _expected_index and _leaks state the decision rule first_violation exists to make a
    # learner derive, while fixtures/generate.py's TRUTH names the verdict for each of
    # the seven programs by id, so both left the participant stage and the Portal moved
    # with them.
    "ac26-w2-privacy-audit": "participant",
    # Issue 537/538 (Issue 543 option B2): every one of the six checkpoints is graded by
    # running tests/hidden/check_oblivious.py against the submitted file, so its
    # assertions -- the two privacy properties included -- shipped in the learner's own
    # image, and fixtures/generate.py derives every setting they are graded against.
    # Both left the participant stage and the Portal moved with them; the supplied key
    # derivation stayed behind in participant/ot.py.
    "ac26-w2-oblivious-transfer": "participant",
    # Issue 537/538 (Issue 543 option B2): all eight checkpoints are graded by running
    # tests/hidden/check_aggregate.py against the submitted file, and that checker's
    # check_plan states the three numbers plan() must return, check_cost the round and
    # opening counts it accepts, and check_privacy the exact multiset a run may reveal.
    # fixtures/generate.py shipped there too and derives the secret counts and severities
    # behind plain_score. Both left the participant stage and the Portal moved with them;
    # the supplied opening handle stayed behind in participant/protocol.py.
    "ac26-w2-private-aggregate": "participant",
    # Issue 537/538 (Issue 543 option B2): tests/hidden/check_curve.py grades all eight
    # checkpoints and holds _ReferenceCurve -- a complete group law, with the identity
    # kept distinct from every affine point, the inverse, the chord and tangent formulas,
    # the vertical-tangent case and double-and-add -- which is the whole of what
    # starter/curve.py asks a learner to build. fixtures/generate.py shipped there too and
    # derives the curve, the sample points and the scalars behind the graded labels. Both
    # left the participant stage and the Portal moved with them; there is no supplied half
    # to carve out here.
    "ac26-w3-ec-group": "participant",
    # Issue 537/538 (Issue 543 option B2): tests/hidden/check_fftdomain.py grades all five
    # checkpoints and holds has_order -- "order exactly n" written out from the definition,
    # beside naive_omega (the rule the shipped starter trusts) and real_omega -- which is
    # the one thing starter/fftdomain.py says nothing else in the image will decide for the
    # learner. fixtures/generate.py left the participant stage with it; there is no
    # supplied half to carve out here, and the Portal moved to participant/.
    "ac26-w3-fft-domain": "participant",
    # Issue 537/538 (Issue 543 option B2): tests/hidden/check_ntt.py grades all six
    # checkpoints and holds has_order -- "order exactly n" written out from the definition
    # -- beside naive_omega, named there as "the rule the broken starter uses", and the
    # invalid_omega rejection inverse_transform is graded on. That order test is the one
    # thing starter/ntt.py says nothing else in the image will compute for the learner.
    # fixtures/generate.py left the participant stage with it; there is no supplied half
    # to carve out here, and the Portal moved to participant/.
    "ac26-w3-ntt-roots": "participant",
    # Issue 537/538 (Issue 543 option B2): tests/hidden/check_air.py grades all eight
    # checkpoints and states the rules starter/air.py withholds -- check_transition wants
    # steps - 1 residuals, which is the count the starter says to work out ("it is not the
    # number of rows"); that file's module docstring says "the transition out of row i
    # breaks row i+1", which is what first_violation is graded on; and
    # check_underconstrained writes out all four conditions a witness is accepted on.
    # fixtures/generate.py left the participant stage with it -- its honest_trace is by its
    # own docstring the reference answer for the trace checkpoint -- and a submission
    # transcribed from the two scored 5 of 8 checkpoints, 185 of 300 points. There is no
    # supplied half to carve out here, and the Portal moved to participant/.
    "ac26-w4-arithmetization": "participant",
    # Issue 537/538 (Issue 543 option B2): tests/hidden/check_pipeline.py grades all eight
    # checkpoints and holds _reference_first_fault -- a complete, correct implementation of
    # every layer contract starter/pipeline.py asks the learner to write -- while
    # check_graph, check_assumptions and check_diagnose write out the graph construction,
    # the assumption matrix and the layer order beside it. fixtures/generate.py left the
    # participant stage with it: UNSUPPORTED_CLAIMS is the cost checkpoint's ground truth,
    # and FAULTS maps every injected fault to the layer first_fault must report and to the
    # single field repair may touch. A submission transcribed from the two scored 7 of 8
    # checkpoints, 270 of 300 points. There is no supplied half to carve out here, and the
    # Portal moved to participant/.
    "ac26-w4-proof-pipeline": "participant",
    # Issue 537/538 (Issue 543 option B2): tests/hidden/check_prover.py states, phase by
    # phase, what every one of the eight checkpoints is graded on -- check_plan's expected
    # table is the whole plan, check_masks writes out A - x and B - y, check_product's two
    # named defects spell the fold-it-once rule, check_artifact lists the artifact's keys
    # and check_audit gives the six values an honest run reports. fixtures/generate.py left
    # the participant stage with it: setting, coefficients, witness and relation are what
    # the hidden labels h0..h3 are drawn from. A submission transcribed from the two scored
    # all eight checkpoints, 300 of 300 points. The supplied half -- the shares, the
    # triples, the instrumented runtime and linear_halves -- stayed with the participant as
    # participant/mpc.py, and the Portal moved to participant/.
    "ac26-w6-cosnark-beaver": "participant",
    # Issue 537/538 (Issue 543 option B2): tests/hidden/check_capstone.py states, phase by
    # phase, what every one of the eight checkpoints is graded on -- _spec_well_formed is the
    # whole transcript rule, _spec_view is view's answer written out, _leaks is the privacy
    # experiment, check_threshold states where the threshold sits and _mutants enumerates the
    # nine defects detects is graded against. fixtures/generate.py left the participant stage
    # with it: hidden_settings draws the six settings every checkpoint is graded on. A
    # submission transcribed from the two scored all eight checkpoints, 300 of 300 points.
    # The supplied half -- the setting object, the vocabulary, the tiny settings and the
    # randomness contract -- stayed with the participant as participant/lab.py, and the
    # Portal moved to participant/.
    "ac26-w7-capstone-demo": "participant",
    # Issue 537/538 (Issue 543 option B2): tests/hidden/check_design.py states, in full, the
    # rule each of the eight checkpoints is graded on -- _spec_requirements is
    # required_properties' answer written out, _spec_admissible is the admissible column of
    # compare_alternatives, _selection_failures states the four conditions select_primitive is
    # accepted on, _graph_failures states every condition an architecture must meet, and
    # _matrix_failures states each row's contract. fixtures/generate.py left the participant
    # stage with it: it draws the whole population every checkpoint is graded over. A
    # submission transcribed from the two scored 4 of 8 checkpoints (155 of 300 points) from
    # the stated rules alone, and 8 of 8 (300 of 300) once the remaining four artifacts were
    # built to the conditions the same file writes out. The supplied half -- the property
    # vocabulary and the option table -- stayed with the participant as participant/lab.py,
    # and the Portal moved to participant/.
    "ac26-w7-capstone-design": "participant",
    # Issue 537/538 (Issue 543 option B2): tests/hidden/check_guest.py is a complete and
    # correct implementation of every graded function -- _reference is reference_order,
    # _machine and _wrapped are machine_order, _rows is trace_evidence, _predicate is
    # verify_exploit, _verdict is triage down to the order the five verdicts have to be asked
    # in, and _probe_inputs/_separates are counterexample. fixtures/generate.py left the
    # participant stage with it: it holds exploit_quantity, candidate_truth and the
    # classification that draws one candidate of every verdict. A submission transcribed from
    # the two scored 8 of 8 checkpoints (300 of 300 points). The supplied half -- the
    # vocabulary, the two shapes and the domain check -- stayed with the participant as
    # participant/lab.py beside the eight practice guests, and the Portal moved to
    # participant/.
    "ac26-w6-zkvm-exploit-predicate": "participant",
    # Issue 537/538 (Issue 543 option B2): tests/hidden/check_guest.py implements four of the
    # eight graded functions outright -- _encode is encode_statement, _run is run_guest,
    # _journal is seal_journal and _leaks is the policy leak_report applies -- and
    # _not_statements/_not_witnesses enumerate every refusal three more are graded on.
    # fixtures/generate.py left the participant stage with it: it holds _machine (the same run
    # again), replay_truth and disclosure_truth. A submission transcribed from the two scored
    # 8 of 8 checkpoints (300 of 300 points). The supplied half -- the vocabulary, the
    # semantics profiles, the commitment, the image decoder, the two encoders and the toy
    # runner -- stayed with the participant as participant/lab.py, and the Portal moved to
    # participant/.
    "ac26-w6-zkvm-witness-binding": "participant",
    # Issue 537/538 (Issue 543 option B2): fixtures/generate.py is this problem's entire ground
    # truth under other names -- constrained is carried, underwritten is underwrites,
    # load_bearing is property_map, violations is contract_violations, first_broken is
    # first_failure, selection_truth is select, and _one_change_neighbours with
    # local_checks_pass and _whole is the search counterexample and repair are graded on --
    # beside BREAKS, which names per variant, identically on every seed, which node or edge each
    # deployment broke. tests/hidden/check_stack.py shipped with it. A submission transcribed
    # from the two scored 8 of 8 checkpoints (300 of 300 points). The supplied half -- the
    # closed vocabularies, the three levels of contract, the boundary classes and four graph
    # accessors -- stayed with the participant as participant/lab.py, and the Portal moved to
    # participant/.
    "ac26-w6-stack-design": "participant",
    # Issue 537/538 (Issue 543 option B2): tests/hidden/check_prover.py states, phase by
    # phase, what every one of the eight checkpoints is graded on -- _Scenario.canonical is
    # the parser's answer and the malformed list beside it is the whole of what that stage
    # must refuse, check_witness writes out the reported keys and the five tamperings,
    # _trace_failures computes operations, rounds, messages, parties and localOnly in the
    # report's own terms, and check_audit gives the five values an honest run reports.
    # fixtures/generate.py left the participant stage with it: setting, coefficients,
    # witness and relation are what the hidden labels h0..h3 are drawn from. A submission
    # transcribed from the two scored all eight checkpoints, 300 of 300 points. The supplied
    # half -- the shares, the instrumented runtime and the participant facade -- stayed with
    # the participant as participant/mpc.py, and the Portal moved to participant/.
    "ac26-w6-cosnark-linear": "participant",
    # Issue 537/538 (Issue 543 option B2): all eight checkpoints are graded by running
    # tests/hidden/check_prover.py against the submitted file, and that checker holds the
    # rules -- _expected_class is classify's answer, _authorized is open-set's,
    # _expected_leakage is leakage's. fixtures/specimens.py left the participant stage with
    # it: GROUND_TRUTH names, per specimen, the capabilities reached, the unauthorized
    # openings, the disclosed (channel, name) pairs and the recoverable secret, for exactly
    # the eight provers the problem asks about. A submission transcribed from the two scored
    # six of eight checkpoints, 230 of 300 points. fixtures/generate.py left as well:
    # setting, coefficients, witness, relation and value_catalog are what the hidden labels
    # h0..h3 are drawn from. The supplied half -- the sharing runtime, the disclosure sink,
    # the policy vocabulary, the bench, and the eight specimens as runnable objects -- stayed
    # with the participant as participant/mpc.py, participant/lab.py and
    # participant/specimens.py, and the Portal moved to participant/.
    "ac26-w6-cosnark-privacy": "participant",
    # Issue 537/538 (Issue 543 option B2): fixtures/generate.py's audit_log returns
    # victim_secret and victim_public beside the records -- the hunt checkpoint's answer
    # as a value -- secret_key derives every key in this deployment from the FLAG_SEED
    # the participant container already carries, and deterministic_nonce is the repair
    # checkpoint's answer with a docstring explaining it. The supplied half (group,
    # challenge, sign_with, and the truncated generator the collision checkpoint
    # measures) moved to participant/schnorr.py, and the Portal moved to participant/.
    "ac26-w3-nonce-reuse": "participant",
    # Issue 537/538: verifier/server.py's own _check_avalanche compared a submission
    # directly against a plain, seed-derived avalanche_distance defined in the same
    # file, and _check_properties/_check_storage compared against
    # fixtures/generate.py's quiz_answer over PROPERTY_STATEMENTS/STORAGE_STATEMENTS,
    # which ship every statement's correct verdict in plaintext -- all reachable from
    # the single participant stage. The Portal moved to participant/ when fixtures/
    # stopped shipping there.
    "sha256-compress-digest": "participant",
    # Issue 537/538 (Issue 543 option B2): the hidden suite grades every checkpoint and
    # fixtures/generate.py implements egcd under the exact name starter/field.py's own
    # stub asks the learner to write, with egcd_rows supplying the trace its egcd_trace
    # stub asks for, so both left the participant stage and the Portal moved with them.
    "ac26-w3-field-inverse": "participant",
    "ac26-w4-sumcheck-drill": "participant",
    "ac26-w3-schnorr-drill": "participant",
    "ac26-w4-plonk-drill": "participant",
    "ac26-w4-fri-drill": "participant",
    # Issue 537/538: verifier/server.py's own _check_rotate/_check_mux compared a
    # submission directly against fixtures/generate.py's rotate_case/mux_case, and
    # _check_dependency compared against first_affected_index, defined directly in
    # verifier/server.py -- all reachable from the single participant stage. The
    # Portal moved to participant/ when fixtures/ stopped shipping there.
    "sha256-schedule-logic": "participant",
    "sha256-bytes-padding": "participant",
    "acm-validation-migration": "workbench",
    "asm-worst-case-latency": "workbench",
    "cs-atomic-file-publish": "workbench",
    "cs-dst-daily-rollup": "workbench",
    "cs-http-retry-idempotency": "workbench",
    "cs-numeric-aggregation-order": "workbench",
    "cs-pagination-drift": "workbench",
    "cs-protocol-state-guard": "workbench",
}

# The language arguments the generator owns, in the order they are emitted after
# the anchor. Everything else in the block (root, seed, submitted_files, limits,
# per-problem callables) is authored and never touched.
LANGUAGE_ARGS = (
    "problem_name",
    "problem_name_en",
    "description",
    "description_en",
    "checkpoint_labels",
    "checkpoint_labels_en",
)


def problems_with_verifier() -> list[Path]:
    return sorted(
        path.parents[2]
        for path in (ROOT / "challenges").glob("*/local/verifier/server.py")
    )


def portal_package(problem: Path) -> str:
    return PORTAL_PACKAGES.get(problem.name, "verifier")


def portal_server_path(problem: Path) -> Path:
    return problem / "local" / portal_package(problem) / "server.py"


def portal_adapter_path(problem: Path) -> Path:
    return problem / "local" / portal_package(problem) / "workbench.py"


def language_material(problem: Path) -> dict[str, object]:
    meta = json.loads((problem / "metadata.json").read_text(encoding="utf-8"))
    en = meta.get("i18n", {}).get("en", {})
    checks = meta.get("scoring", {}).get("checks", [])
    en_checks = en.get("checks", [])
    en_labels = {}
    for index, check in enumerate(checks):
        counterpart = en_checks[index] if index < len(en_checks) else {}
        label = counterpart.get("label") if isinstance(counterpart, dict) else None
        if isinstance(label, str) and label:
            en_labels[check["id"]] = label
    return {
        "problem_name": meta.get("name"),
        "problem_name_en": en.get("name"),
        "description": meta.get("shortDescription"),
        "description_en": en.get("shortDescription"),
        "checkpoint_labels": {check["id"]: check["label"] for check in checks},
        "checkpoint_labels_en": en_labels,
    }


def split_block(server_source: str, problem_id: str) -> tuple[str, str, str]:
    before, _, rest = server_source.partition(BLOCK_BEGIN)
    block, _, after = rest.partition(BLOCK_END)
    if not block:
        raise SystemExit(f"{problem_id}: the generated block markers are damaged")
    return before, block, after


def parsed_args(block: str) -> dict[str, object]:
    found: dict[str, object] = {}
    for name in LANGUAGE_ARGS:
        match = re.search(rf"^(\s+){name}=(.+),\s*$", block, re.M)
        if match is not None:
            found[name] = ast.literal_eval(match.group(2))
    return found


def regenerate_block(block: str, material: dict[str, object], problem_id: str) -> str:
    """Rewrite the six language argument lines, leaving every other line alone."""
    lines = block.split("\n")
    anchor = None
    indent = "    "
    kept: list[str] = []
    for line in lines:
        match = re.match(r"^(\s+)(problem_name|problem_name_en|description|description_en|checkpoint_labels|checkpoint_labels_en)=(.+),\s*$", line)
        if match is None:
            kept.append(line)
            continue
        indent = match.group(1)
        if anchor is None:
            anchor = len(kept)
    if anchor is None:
        raise SystemExit(f"{problem_id}: no language argument lines found in the generated block")
    emitted = [f"{indent}{name}={material[name]!r}," for name in LANGUAGE_ARGS]
    return "\n".join(kept[:anchor] + emitted + kept[anchor:])


def check_generated(problem: Path, failures: list[str]) -> None:
    problem_id = problem.name
    server_path = portal_server_path(problem)
    source = server_path.read_text(encoding="utf-8")
    _, block, _ = split_block(source, problem_id)
    material = language_material(problem)
    for name in LANGUAGE_ARGS:
        if material[name] in (None, {}, ""):
            failures.append(f"{problem_id}: metadata is missing the material for {name} (#381 requires ja and en)")
            return
    found = parsed_args(block)
    for name in LANGUAGE_ARGS:
        if name not in found:
            failures.append(
                f"{problem_id}: the generated block has no {name}= line — run scripts/generate-course-workbenches.py --write"
            )
        elif found[name] != material[name]:
            failures.append(
                f"{problem_id}: {name} in the generated block does not match metadata — run scripts/generate-course-workbenches.py --write"
            )


def write_generated(problem: Path) -> bool:
    server_path = portal_server_path(problem)
    source = server_path.read_text(encoding="utf-8")
    before, block, after = split_block(source, problem.name)
    material = language_material(problem)
    rebuilt = before + BLOCK_BEGIN + regenerate_block(block, material, problem.name) + BLOCK_END + after
    if rebuilt != source:
        server_path.write_text(rebuilt, encoding="utf-8")
        return True
    return False


def check_handwritten(problem: Path, failures: list[str]) -> None:
    """The five authored payloads: the English from metadata must appear verbatim."""
    problem_id = problem.name
    server_path = portal_server_path(problem)
    source = server_path.read_text(encoding="utf-8")
    material = language_material(problem)
    missing = []
    for label, value in (
        ("i18n.en.name", material["problem_name_en"]),
        ("i18n.en.shortDescription", material["description_en"]),
    ):
        if not isinstance(value, str) or not value:
            missing.append(f"metadata has no {label}")
        elif value not in source:
            missing.append(f"{label} is not in the payload")
    labels_en = material["checkpoint_labels_en"]
    if not isinstance(labels_en, dict) or set(labels_en) != set(material["checkpoint_labels"]):
        missing.append("metadata i18n.en.checks does not cover every checkpoint")
    else:
        for checkpoint, label in labels_en.items():
            if label not in source:
                missing.append(f"the en label for {checkpoint} is not in the payload")
    if missing:
        failures.append(
            f"{problem_id}: hand-written config_payload() drifted from metadata english — {'; '.join(missing)}. "
            f"This payload is authored, not generated: edit {server_path.relative_to(problem)} so the Portal editor "
            "carries the same english the metadata does."
        )


def check_adapter_copies(failures: list[str], write: bool) -> int:
    canonical = CANONICAL_ADAPTER.read_bytes()
    rewritten = 0
    for problem in problems_with_verifier():
        copy = portal_adapter_path(problem)
        if not copy.is_file():
            continue
        if copy.read_bytes() != canonical:
            if write:
                copy.write_bytes(canonical)
                rewritten += 1
            else:
                failures.append(
                    f"{problem.name}: {copy.relative_to(problem)} drifted from "
                    "scripts/course-workbench/workbench.py — "
                    "run scripts/generate-course-workbenches.py --write. The copies are the spec (each problem deploys "
                    "self-contained); the canonical source is where the adapter is edited."
                )
    return rewritten


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="fail on any drift, change nothing")
    mode.add_argument("--write", action="store_true", help="regenerate blocks and re-distribute the adapter")
    args = parser.parse_args()

    failures: list[str] = []
    generated = 0
    handwritten = 0
    rewritten_blocks = 0

    for problem in problems_with_verifier():
        source = portal_server_path(problem).read_text(encoding="utf-8")
        if BLOCK_BEGIN in source:
            generated += 1
            if args.write:
                if write_generated(problem):
                    rewritten_blocks += 1
                check_generated(problem, failures)
            else:
                check_generated(problem, failures)
        else:
            handwritten += 1
            check_handwritten(problem, failures)

    rewritten_adapters = check_adapter_copies(failures, write=args.write)

    if args.write:
        print(
            f"regenerated {rewritten_blocks} block(s), re-distributed {rewritten_adapters} adapter copy(ies) "
            f"across {generated} generated + {handwritten} hand-written problems"
        )
    else:
        print(f"checked {generated} generated blocks, {handwritten} hand-written payloads, and the vendored adapter copies")

    for failure in failures:
        print(f"FAIL {failure}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
