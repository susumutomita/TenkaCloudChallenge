#!/usr/bin/env python3
"""Contract checks for the course containers consumed by Participant Portal.

The existing per-problem suites remain the source of truth for cryptographic grading.
This test guards the delivery layer added by the migration: every target must be
reachable from the Portal, expose only authored evidence, preserve raw code submission
compatibility, and bind direct answers to the current deployment.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHARED_TARGETS = (
    "ac26-w2-secret-sharing",
    "ac26-w2-linear-shares",
    "ac26-w2-beaver-mul",
    "ac26-w2-oblivious-transfer",
    "ac26-w2-privacy-audit",
    "ac26-w2-private-aggregate",
    "ac26-w3-field-inverse",
    "ac26-w3-ec-group",
    "ac26-w3-nonce-reuse",
    "ac26-w3-schnorr",
    "ac26-w3-schnorr-drill",
    "ac26-w4-sumcheck-drill",
    "ac26-w4-plonk-drill",
    "ac26-w4-fri-drill",
    "ac26-w4-arithmetization",
    "ac26-w4-commit-open",
    "ac26-w4-proof-pipeline",
    "ac26-w5-encoding-noise",
    "ac26-w5-lwe-rlwe",
    "ac26-w5-rgsw-external",
    "ac26-w5-cmux-blind-rotation",
    "ac26-w5-extract-key-switch",
    "ac26-w5-pbs-homnand",
    "ac26-w6-cosnark-linear",
    "ac26-w6-cosnark-beaver",
    "ac26-w6-cosnark-privacy",
    "ac26-w6-zkvm-exploit-predicate",
    "ac26-w6-zkvm-witness-binding",
    "ac26-w6-stack-design",
    "ac26-w7-capstone-design",
    "ac26-w7-capstone-demo",
    "cs-transaction-visibility-audit",
    "sha256-bytes-padding",
    "sha256-schedule-logic",
    "sha256-compress-digest",
)
SPLIT_PORTAL_MODULES = {
    # Issue 537/538/543: same move, one problem at a time. `padded_length` and
    # `broken_pad_zeros_only` are plain functions in fixtures/generate.py, so the split
    # had to take `fixtures/` out of the participant stage entirely -- show.py and the
    # public tests read this deployment's evidence from the verifier's GET /public.
    "sha256-bytes-padding": "participant.server",
    "cs-transaction-visibility-audit": "participant.server",
    # Issue 440: #437 は participant/ に公開 Workbench を置く分離型。 元の branch は
    # 別の集合 (問題 id の frozenset) を足していたが、 main 側はこの map へ
    # 一般化済みなので、 古い機構を戻さずここへ寄せる。
    "cs-cache-generation-fence": "participant.server",
    # Issue 543/537: 単一 stage の drill を、生成された Portal editor API を持つ他の
    # split-boundary 問題と同じ形へ分離した。 answer 導出は verifier/expected.py のみに
    # 残る。 #546 が sumcheck、 本 PR が残り 3 問。
    "ac26-w4-sumcheck-drill": "participant.server",
    "ac26-w3-schnorr-drill": "participant.server",
    "ac26-w4-plonk-drill": "participant.server",
    "ac26-w4-fri-drill": "participant.server",
    # Issue 537/538/543: these four moved their Portal to participant/ when
    # fixtures/ stopped shipping to the participant image. generate-course-workbenches.py
    # の PORTAL_PACKAGES と対で更新する必要がある — 片方だけだと、この checker が
    # verifier.server を見に行って "GET APIs missing" で落ちる。
    "cs-auth-claim-audit": "participant.server",
    "ac26-bridge-experiment": "participant.server",
    "ac26-bridge-properties": "participant.server",
    "ac26-w1-constraint-lab": "participant.server",
    # Issue 537/538: same move. verifier/server.py's _check_rotate/_check_mux compared a
    # submission directly against fixtures/generate.py's rotate_case/mux_case, and
    # _check_dependency compared against first_affected_index, defined directly in
    # verifier/server.py -- all reachable from the single participant stage.
    # generate-course-workbenches.py の PORTAL_PACKAGES と対で更新する必要がある —
    # 片方だけだと、この checker が verifier.server を見に行って "GET APIs missing" で落ちる。
    "sha256-schedule-logic": "participant.server",
    # Issue 525: same move, for the reason #533 did not finish -- the answer functions
    # left fixtures/generate.py but the grader that derives `root-cause`'s accepted JSON
    # kept shipping to the participant stage alongside the Portal.
    "ac26-w1-underconstraint": "participant.server",
    # Issue 537/538/543: same move, one problem at a time. This one keeps the shared
    # adapter (it is in SHARED_TARGETS above), so the Portal API moved to
    # participant/server.py together with the vendored participant/workbench.py, while
    # the `tcw1.` seal is re-checked independently in verifier/server.py.
    "ac26-w2-linear-shares": "participant.server",
    # Issue 537/543: same move again. Here the leak is not a fixtures-derived value but
    # `tests/hidden/check_schnorr.py` itself — all eight checkpoints are graded by
    # running it, and it shipped in the participant stage. `fixtures/` stays in that
    # stage (it derives the statement, not a verdict), so only the hidden suite and the
    # scoring process moved.
    "ac26-w3-schnorr": "participant.server",
    # Issue 537/538 (Issue 543 option B2): same move, and both leaks at once —
    # `tests/hidden/check_assertion.py` grades all three checkpoints and shipped in the
    # participant stage, and `fixtures/generate.py` defines `signed_message` under the
    # exact name `starter/assertion.py` asks the learner to write while labelling every
    # assertion by kind for any seed. `show.py` and the public tests read `GET /public`
    # from the verifier now. generate-course-workbenches.py の PORTAL_PACKAGES と対で
    # 更新する必要がある — 片方だけだと、この checker が verifier.server を見に行って
    # "GET APIs missing" で落ちる。
    "ac26-w3-passkey-assertion": "participant.server",
    # Issue 543 option B2: both leaks at once here — `tests/hidden/check_lwe.py` grades
    # all eight checkpoints and shipped in the participant stage, and
    # `fixtures/generate.py` implements the eleven functions `starter/lwe.py` asks the
    # learner to write, so it left that stage too. `show.py` and the public tests read
    # `GET /public` from the verifier now.
    "ac26-w5-lwe-rlwe": "participant.server",
    # Issue 543 option B2, the same two leaks: `tests/hidden/check_rgsw.py` grades all
    # eight checkpoints and shipped in the participant stage, and `fixtures/generate.py`
    # implements the ten functions `starter/rgsw.py` asks the learner to write, so it
    # left that stage too. `show.py` and the public tests read `GET /public` from the
    # verifier now. The supplied ring stayed behind in `participant/ring.py`.
    "ac26-w5-rgsw-external": "participant.server",
    "ac26-w5-cmux-blind-rotation": "participant.server",
    # Same option B2 split, same two leaks: `tests/hidden/check_pipeline.py` grades all
    # eight checkpoints, and `fixtures/generate.py` implements seven of the twelve names
    # `starter/pipeline.py` asks the learner to write. `show.py` reads `GET /public` from
    # the verifier now. The supplied Week 5 stack stayed behind in `participant/fhe.py`,
    # which is where the starter and the public tests import it from.
    "ac26-w5-pbs-homnand": "participant.server",
    # Same option B2 split, same two leaks: `tests/hidden/check_extract.py` grades all
    # eight checkpoints, and `fixtures/generate.py` implements every one of the six names
    # `starter/extract.py` asks the learner to write. `show.py` reads `GET /public` from
    # the verifier now. The supplied TFHE layer stayed behind in `participant/fhe.py`,
    # which is where the starter and the public tests import it from.
    "ac26-w5-extract-key-switch": "participant.server",
    # Issue 537/538 (Issue 543 option B2): same move, driven by the `COPY verifier/` shape
    # rather than by a detector finding. `tests/hidden/check_oblivious.py` grades all six
    # checkpoints and shipped in the single participant stage together with the process
    # that runs it, so its assertions -- including the two privacy properties the problem
    # asks a learner to derive -- were readable in the learner's own image. `show.py` and
    # the public tests read `GET /public` from the verifier now, and the supplied key
    # derivation stayed behind in `participant/ot.py`.
    "ac26-w2-oblivious-transfer": "participant.server",
    # Issue 537/538 (Issue 543 option B2): same move. tests/hidden/check_commit.py
    # grades every checkpoint and fixtures/generate.py implements node_hash under the
    # exact name starter/commit.py's own node_hash stub asks the learner to write, both
    # of which shipped in the single participant stage.
    # generate-course-workbenches.py の PORTAL_PACKAGES と対で更新する必要がある —
    # 片方だけだと、この checker が verifier.server を見に行って "GET APIs missing" で落ちる。
    "ac26-w4-commit-open": "participant.server",
    # Issue 537/538 (Issue 543 option B2): same move. tests/hidden/check_encoding.py
    # grades every checkpoint and fixtures/generate.py implements encode, centered,
    # decode, success_interval and first_failure under the exact five names
    # starter/encoding.py's own stubs ask the learner to write, all of which shipped in
    # the single participant stage.
    # generate-course-workbenches.py の PORTAL_PACKAGES と対で更新する必要がある —
    # 片方だけだと、この checker が verifier.server を見に行って "GET APIs missing" で落ちる。
    "ac26-w5-encoding-noise": "participant.server",
    # Issue 537/538 (Issue 543 option B2): same move. tests/hidden/check_sharing.py
    # grades four of the five checkpoints and fixtures/generate.py's reference_shares
    # builds a correct split of this deployment's secret, all of which shipped in the
    # single participant stage.
    # generate-course-workbenches.py の PORTAL_PACKAGES と対で更新する必要がある —
    # 片方だけだと、この checker が verifier.server を見に行って "GET APIs missing" で落ちる。
    "ac26-w2-secret-sharing": "participant.server",
    # Issue 537/538 (Issue 543 option B2): same move. tests/hidden/check_beaver.py grades
    # every one of the five checkpoints and fixtures/generate.py's setting() returns
    # x, y, a, b and c in the clear, all of which shipped in the single participant stage.
    # generate-course-workbenches.py の PORTAL_PACKAGES と対で更新する必要がある —
    # 片方だけだと、この checker が verifier.server を見に行って "GET APIs missing" で落ちる。
    "ac26-w2-beaver-mul": "participant.server",
    # Issue 537/538 (Issue 543 option B2): same move. tests/hidden/check_auditor.py grades
    # all seven checkpoints and its _expected_index / _leaks state the rule first_violation
    # exists to make a learner derive, and fixtures/generate.py's TRUTH names the verdict
    # for each of the seven programs, all of which shipped in the single participant stage.
    # generate-course-workbenches.py の PORTAL_PACKAGES と対で更新する必要がある —
    # 片方だけだと、この checker が verifier.server を見に行って "GET APIs missing" で落ちる。
    "ac26-w2-privacy-audit": "participant.server",
    # Issue 537/538 (Issue 543 option B2): same move. tests/hidden/check_aggregate.py
    # grades all eight checkpoints and its check_plan, check_cost and check_privacy state
    # the three numbers plan() must return, the round and opening counts, and the exact
    # multiset a run may reveal; fixtures/generate.py derives the secret counts and
    # severities behind plain_score, all of which shipped in the single participant stage.
    # generate-course-workbenches.py の PORTAL_PACKAGES と対で更新する必要がある —
    # 片方だけだと、この checker が verifier.server を見に行って "GET APIs missing" で落ちる。
    "ac26-w2-private-aggregate": "participant.server",
    # Issue 537/538 (Issue 543 option B2): same move. tests/hidden/check_curve.py grades
    # all eight checkpoints and holds _ReferenceCurve, a complete group law -- the
    # identity, the inverse, the chord and tangent formulas, the vertical tangent and
    # double-and-add, which is the whole of what starter/curve.py asks for;
    # fixtures/generate.py derives the curve, the sample points and the scalars behind the
    # graded labels, and both shipped in the single participant stage.
    # generate-course-workbenches.py の PORTAL_PACKAGES と対で更新する必要がある —
    # 片方だけだと、この checker が verifier.server を見に行って "GET APIs missing" で落ちる。
    "ac26-w3-ec-group": "participant.server",
    # Issue 537/538: same move. verifier/server.py's own _check_avalanche compared a
    # submission directly against a plain, seed-derived avalanche_distance defined in
    # the same file, and _check_properties/_check_storage compared against
    # fixtures/generate.py's quiz_answer over PROPERTY_STATEMENTS/STORAGE_STATEMENTS,
    # which ship every statement's correct verdict in plaintext -- all reachable from
    # the single participant stage.
    # generate-course-workbenches.py の PORTAL_PACKAGES と対で更新する必要がある —
    # 片方だけだと、この checker が verifier.server を見に行って "GET APIs missing" で落ちる。
    "sha256-compress-digest": "participant.server",
    # Issue 537/538 (Issue 543 option B2): same move. tests/hidden/check_field.py grades
    # every checkpoint and fixtures/generate.py implements egcd under the exact name
    # starter/field.py's own stub asks the learner to write, with egcd_rows supplying
    # the row-for-row trace its egcd_trace stub asks for, all of which shipped in the
    # single participant stage.
    # generate-course-workbenches.py の PORTAL_PACKAGES と対で更新する必要がある —
    # 片方だけだと、この checker が verifier.server を見に行って "GET APIs missing" で落ちる。
    "ac26-w3-field-inverse": "participant.server",
}
# Execute the heavier inspect/public-test adapter on representative problems from
# each family. The catalogue's existing sharded suite executes every problem's own
# public, reference, mutation, and verifier tests.
REPRESENTATIVES = {
    "ac26-w2-secret-sharing",
    "ac26-w3-schnorr",
    "ac26-w5-pbs-homnand",
    "ac26-w7-capstone-demo",
    "sha256-compress-digest",
}
FORBIDDEN_DOC_TERMS = (
    "Browser Workbench",
    "open the endpoint",
)

PROBE = r'''
import importlib
import json
import sys
from pathlib import Path

sys.path.insert(0, ".")
server = importlib.import_module(sys.argv[1])
CHECKPOINTS = server.CHECKPOINTS
_WORKBENCH = server._WORKBENCH

config = _WORKBENCH.config_payload()
starter = _WORKBENCH.starter_payload()
metadata = json.loads(Path("..", "metadata.json").read_text(encoding="utf-8"))
checks = {item["id"]: item for item in metadata["scoring"]["checks"]}
assert tuple(config["submittedFiles"]) == tuple(starter)
assert tuple(item["id"] for item in config["checkpoints"]) == tuple(CHECKPOINTS)
assert all(isinstance(value, str) and value.strip() for value in starter.values())
for item in config["checkpoints"]:
    expected_input = "multiline" if item["kind"] == "code" else "text"
    assert checks[item["id"]].get("input", "text") == expected_input

# [#381] The Portal editor must carry the English the metadata already has.
en = metadata.get("i18n", {}).get("en", {})
served = config.get("i18n", {}).get("en", {})
assert served.get("name") == en.get("name"), "config i18n.en.name != metadata i18n.en.name"
assert served.get("description") == en.get("shortDescription"), "config i18n.en.description != metadata i18n.en.shortDescription"
expected_labels = {item["id"]: en["checks"][index]["label"] for index, item in enumerate(metadata["scoring"]["checks"])}
assert served.get("checkpointLabels") == expected_labels, "config i18n.en.checkpointLabels != metadata i18n.en.checks labels"

manual = {
    item["id"]: "0"
    for item in config["checkpoints"]
    if item["kind"] == "answer"
}
prepared = _WORKBENCH.prepare_submissions(starter, manual)
assert prepared["ok"] is True
assert set(prepared["submissions"]) == set(CHECKPOINTS)

for item in config["checkpoints"]:
    checkpoint = item["id"]
    submission = prepared["submissions"][checkpoint]
    if item["kind"] == "code":
        assert submission.startswith("tcw1.")
        assert "\n" not in submission and "\r" not in submission
        expected_source = starter[config["submittedFiles"][0]] if len(starter) == 1 else json.dumps(starter, separators=(",", ":"), ensure_ascii=False)
        assert _WORKBENCH.unwrap_submission(checkpoint, submission) == expected_source
        # Existing callers that still submit raw source remain compatible.
        assert _WORKBENCH.unwrap_submission(checkpoint, expected_source) == expected_source
    else:
        assert _WORKBENCH.unwrap_submission(checkpoint, "0") is None
        assert _WORKBENCH.unwrap_submission(checkpoint, submission) == 0
        other = type(_WORKBENCH)(
            root=_WORKBENCH.root,
            seed=_WORKBENCH.seed + ":other",
            problem_id=_WORKBENCH.problem_id,
            problem_name=_WORKBENCH.problem_name,
            description=_WORKBENCH.description,
            submitted_files=_WORKBENCH.submitted_files,
            code_checkpoints=_WORKBENCH.code_checkpoints,
            checkpoints=_WORKBENCH.checkpoints,
            checkpoint_labels=_WORKBENCH.checkpoint_labels,
            max_body_bytes=_WORKBENCH.max_body_bytes,
            run_timeout_seconds=_WORKBENCH.run_timeout_seconds,
            max_output_bytes=_WORKBENCH.max_output_bytes,
            limit_fn=_WORKBENCH.limit_fn,
        )
        assert other.unwrap_submission(checkpoint, submission) is None

result = {"config": config, "prepared": len(prepared["submissions"])}
if sys.argv[2] == "heavy":
    inspection = _WORKBENCH.inspect_payload()
    assert isinstance(inspection.get("output"), str) and inspection["output"].strip()
    public = _WORKBENCH.run_public_tests(starter)
    assert isinstance(public.get("passed"), bool)
    assert isinstance(public.get("output"), str) and public["output"].strip()
    result["publicPassed"] = public["passed"]
print(json.dumps(result, ensure_ascii=False))
'''

# The first four course problems predate the shared adapter above. Keep their code
# checkpoint declarations explicit while verifying the same Portal editor contract.
LEGACY_CODE_CHECKPOINTS = {
    "ac26-bridge-experiment": {"generalize"},
    "ac26-bridge-properties": {"transfer"},
    "ac26-w1-constraint-lab": {"residuals", "boolean", "membership", "transfer"},
    "ac26-w1-underconstraint": {"build", "audit", "exploit", "repair", "mutation-transfer"},
    "cs-cache-generation-fence": {"basic-invalidate", "fence", "per-key", "generalize"},
}
# These legacy-config problems intentionally put the participant-facing Portal API
# in a public-only image rather than in the hidden verifier process.
PASSKEY_TARGET = "ac26-w3-passkey-assertion"
ALL_TARGETS = (*LEGACY_CODE_CHECKPOINTS, *SHARED_TARGETS, PASSKEY_TARGET)

LEGACY_PROBE = r'''
import importlib
import json
import sys
from pathlib import Path

sys.path.insert(0, ".")
server = importlib.import_module(sys.argv[1])
CHECKPOINTS = server.CHECKPOINTS
config_payload = server.config_payload
starter_payload = server.starter_payload

config = config_payload()
starter = starter_payload()
metadata = json.loads(Path("..", "metadata.json").read_text(encoding="utf-8"))
checks = {item["id"]: item for item in metadata["scoring"]["checks"]}

assert config["id"] == metadata["id"]
assert tuple(config["submittedFiles"]) == tuple(starter)
assert tuple(item["id"] for item in config["checkpoints"]) == tuple(CHECKPOINTS)
assert all(isinstance(value, str) and value.strip() for value in starter.values())
for item in config["checkpoints"]:
    assert item["kind"] in ("code", "answer")
    assert isinstance(item["label"], str) and item["label"].strip()
    expected_input = "multiline" if item["kind"] == "code" else "text"
    assert checks[item["id"]].get("input", "text") == expected_input

# [#381] The Portal editor must carry the English the metadata already has.
en = metadata.get("i18n", {}).get("en", {})
served = config.get("i18n", {}).get("en", {})
assert served.get("name") == en.get("name"), "config i18n.en.name != metadata i18n.en.name"
assert served.get("description") == en.get("shortDescription"), "config i18n.en.description != metadata i18n.en.shortDescription"
expected_labels = {item["id"]: en["checks"][index]["label"] for index, item in enumerate(metadata["scoring"]["checks"])}
assert served.get("checkpointLabels") == expected_labels, "config i18n.en.checkpointLabels != metadata i18n.en.checks labels"

print(json.dumps(config, ensure_ascii=False))
'''

PASSKEY_PROBE = r'''
import importlib
import json
import sys
from pathlib import Path

sys.path.insert(0, ".")
# The module is passed in rather than hard-coded: Issue 543 option B2 moved this
# problem's Portal editor API out of the hidden verifier and into participant/server.py,
# and SPLIT_PORTAL_MODULES is the one place that records where a problem's Portal lives.
server = importlib.import_module(sys.argv[1])
CHECKPOINTS = server.CHECKPOINTS
config_payload = server.config_payload
prepare_submissions = server.prepare_submissions
starter_payload = server.starter_payload

config = config_payload()
starter = starter_payload()
metadata = json.loads(Path("..", "metadata.json").read_text(encoding="utf-8"))
checks = {item["id"]: item for item in metadata["scoring"]["checks"]}

assert config["id"] == metadata["id"]
assert tuple(config["submittedFiles"]) == tuple(starter)
assert tuple(item["id"] for item in config["checkpoints"]) == tuple(CHECKPOINTS)
assert all(item["kind"] == "code" for item in config["checkpoints"])
assert all(checks[checkpoint].get("input") == "multiline" for checkpoint in CHECKPOINTS)
prepared = prepare_submissions("portal-contract-seed", starter)
assert prepared["ok"] is True
assert set(prepared["submissions"]) == set(CHECKPOINTS)
assert all(value == starter["assertion.py"] for value in prepared["submissions"].values())

# [#381] The Portal editor must carry the English the metadata already has.
en = metadata.get("i18n", {}).get("en", {})
served = config.get("i18n", {}).get("en", {})
assert served.get("name") == en.get("name"), "config i18n.en.name != metadata i18n.en.name"
assert served.get("description") == en.get("shortDescription"), "config i18n.en.description != metadata i18n.en.shortDescription"
expected_labels = {item["id"]: en["checks"][index]["label"] for index, item in enumerate(metadata["scoring"]["checks"])}
assert served.get("checkpointLabels") == expected_labels, "config i18n.en.checkpointLabels != metadata i18n.en.checks labels"

print(json.dumps(config, ensure_ascii=False))
'''


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def check_static(problem_id: str) -> None:
    problem = ROOT / "challenges" / problem_id
    local = problem / "local"
    metadata = json.loads((problem / "metadata.json").read_text(encoding="utf-8"))
    runtime = metadata.get("runtime")
    require(isinstance(runtime, dict), f"{problem_id}: runtime missing")
    verify_url = runtime.get("verifyUrl")
    require(
        isinstance(verify_url, str) and verify_url.endswith("/verify"),
        f"{problem_id}: bad verifyUrl",
    )
    require(
        "challengeEndpoints" not in runtime,
        f"{problem_id}: duplicate challenge endpoint remains",
    )

    require(
        (local / "verifier" / "server.py").is_file(),
        f"{problem_id}: missing local/verifier/server.py",
    )
    require(not (local / "workbench").exists(), f"{problem_id}: duplicate UI assets remain")
    portal_module = SPLIT_PORTAL_MODULES.get(problem_id, "verifier.server")
    portal_package = portal_module.split(".")[0]
    portal_server_path = (local / Path(*portal_module.split("."))).with_suffix(".py")
    support_path = local / portal_package / "workbench.py"
    if problem_id in SPLIT_PORTAL_MODULES:
        require(portal_server_path.is_file(), f"{problem_id}: public participant API missing")
    if problem_id in SHARED_TARGETS:
        require(
            support_path.is_file(),
            f"{problem_id}: shared Portal API adapter missing",
        )

    dockerfile = (local / "Dockerfile").read_text(encoding="utf-8")
    require("COPY workbench/" not in dockerfile, f"{problem_id}: image still copies duplicate UI")
    require(
        " AS participant" in dockerfile and " AS author" in dockerfile,
        f"{problem_id}: stage split lost",
    )

    verifier_server = (local / "verifier" / "server.py").read_text(encoding="utf-8")
    portal_server = portal_server_path.read_text(encoding="utf-8")
    support = support_path.read_text(encoding="utf-8") if support_path.is_file() else ""
    require(
        "/api/config" in portal_server and "/api/inspect" in portal_server,
        f"{problem_id}: GET APIs missing",
    )
    require(
        "/api/test" in portal_server and "/api/prepare" in portal_server,
        f"{problem_id}: POST APIs missing",
    )
    require("content-security-policy" in portal_server, f"{problem_id}: CSP missing")
    require("WORKBENCH_ASSETS" not in portal_server, f"{problem_id}: asset map remains")
    require("_WORKBENCH.asset" not in portal_server, f"{problem_id}: asset route remains")
    require(
        "shell=True" not in portal_server + verifier_server + support,
        f"{problem_id}: shell=True introduced",
    )
    require(
        "os.system" not in portal_server + verifier_server + support,
        f"{problem_id}: os.system introduced",
    )
    adapter_source = portal_server + support if problem_id in SPLIT_PORTAL_MODULES else support
    require(
        "from reference" not in adapter_source and "tests.hidden" not in adapter_source,
        f"{problem_id}: answers leaked into adapter",
    )
    if problem_id in SPLIT_PORTAL_MODULES:
        require(
            "/api/config" not in verifier_server
            and "/api/inspect" not in verifier_server
            and "/api/test" not in verifier_server
            and "/api/prepare" not in verifier_server,
            f"{problem_id}: participant APIs remain in hidden verifier",
        )
        participant_stage = dockerfile.split("FROM base AS participant", 1)[1].split(
            "FROM base AS verifier", 1
        )[0]
        require("participant/" in participant_stage, f"{problem_id}: participant API not copied")
        for forbidden in ("verifier/", "tests/hidden", "reference/", "mutation.py"):
            require(
                forbidden not in participant_stage,
                f"{problem_id}: participant stage contains {forbidden}",
            )

    instructions = str(metadata.get("instructions") or "")
    require(
        "Participant Portal" in instructions,
        f"{problem_id}: instructions do not start in Participant Portal",
    )
    documents = [json.dumps(metadata, ensure_ascii=False)]
    for readme in ("README.md", "README.ja.md"):
        text = (problem / readme).read_text(encoding="utf-8")
        require("Participant Portal" in text, f"{problem_id}: {readme} omits Portal path")
        documents.append(text)
    combined = "\n".join(documents).casefold()
    for term in FORBIDDEN_DOC_TERMS:
        require(
            term.casefold() not in combined,
            f"{problem_id}: obsolete host-only direction remains: {term}",
        )


def check_runtime(problem_id: str) -> None:
    mode = "heavy" if problem_id in REPRESENTATIVES else "light"
    portal_module = SPLIT_PORTAL_MODULES.get(problem_id, "verifier.server")
    completed = subprocess.run(
        [sys.executable, "-I", "-c", PROBE, portal_module, mode],
        cwd=ROOT / "challenges" / problem_id / "local",
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=180,
        check=False,
    )
    require(
        completed.returncode == 0,
        f"{problem_id}: runtime probe failed\n{completed.stdout}",
    )
    payload = json.loads(completed.stdout.strip().splitlines()[-1])
    require(payload["prepared"] > 0, f"{problem_id}: no Portal submissions prepared")


def check_legacy_input_contract(problem_id: str, code_checkpoints: set[str]) -> None:
    metadata_path = ROOT / "challenges" / problem_id / "metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    checks = metadata["scoring"]["checks"]
    actual = {check["id"] for check in checks if check.get("input", "text") == "multiline"}
    require(
        actual == code_checkpoints,
        f"{problem_id}: multiline checkpoints {sorted(actual)} != {sorted(code_checkpoints)}",
    )
    module = SPLIT_PORTAL_MODULES.get(problem_id, "verifier.server")
    server_path = (
        ROOT / "challenges" / problem_id / "local" / Path(*module.split("."))
    ).with_suffix(".py")
    server = server_path.read_text(encoding="utf-8")
    require("/api/config" in server, f"{problem_id}: GET /api/config missing")

    completed = subprocess.run(
        [sys.executable, "-I", "-c", LEGACY_PROBE, module],
        cwd=ROOT / "challenges" / problem_id / "local",
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=30,
        check=False,
    )
    require(
        completed.returncode == 0,
        f"{problem_id}: generic Portal editor config probe failed\n{completed.stdout}",
    )


def check_passkey_contract() -> None:
    completed = subprocess.run(
        [
            sys.executable,
            "-I",
            "-c",
            PASSKEY_PROBE,
            SPLIT_PORTAL_MODULES.get(PASSKEY_TARGET, "verifier.server"),
        ],
        cwd=ROOT / "challenges" / PASSKEY_TARGET / "local",
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=30,
        check=False,
    )
    require(
        completed.returncode == 0,
        f"{PASSKEY_TARGET}: Portal editor config probe failed\n{completed.stdout}",
    )


def main() -> int:
    for problem_id, code_checkpoints in LEGACY_CODE_CHECKPOINTS.items():
        check_static(problem_id)
        check_legacy_input_contract(problem_id, code_checkpoints)
        print(f"PASS {problem_id} input and config contract")
    for problem_id in SHARED_TARGETS:
        check_static(problem_id)
        check_runtime(problem_id)
        print(f"PASS {problem_id}")
    check_static(PASSKEY_TARGET)
    check_passkey_contract()
    print(f"PASS {PASSKEY_TARGET}")
    print(f"\n{len(ALL_TARGETS)} Portal editor API contracts passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
