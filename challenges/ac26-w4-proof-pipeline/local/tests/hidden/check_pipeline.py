"""Hidden tests. Run by /verify against a copy of the learner's pipeline.py.

Two rules hold throughout, and both are here because an earlier draft broke them:

  * **Ground truth comes from the fixtures, never from the submission.** A checker that
    grades `repair` by running the learner's own `first_fault` on the result passes a
    submission whose diagnosis and whose repair are wrong in the same direction. Every
    verdict below is computed from `fixtures.generate`, which knows which fault was
    injected and which field it touched, plus the independent walk at the bottom of
    this file.

  * **Every check runs on both pipelines.** A and B differ in stage count, stage names,
    layer list, and minimum query count. A submission that hardcodes A's shape passes
    nothing here.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    CLAIMS,
    FAULTS,
    PIPELINES,
    UNSUPPORTED_CLAIMS,
    applicable_faults,
    constraint_artifact,
    faulted_run,
    honest_run,
    non_setup_inputs,
    pipeline,
    stage_with_layer,
)

NAMES = ("A", "B")
LABELS = ("h0", "h1", "h2")


def _definitions() -> dict:
    return {name: pipeline(name) for name in NAMES}


def check_graph(module, seed: str) -> list[str]:
    """The artifact graph, and the dangling artifacts a broken pipeline would show."""
    failures: list[str] = []
    for name in NAMES:
        definition = pipeline(name)
        try:
            graph = module.artifact_graph(definition)
        except Exception as error:  # noqa: BLE001
            return [f"building the artifact graph raised {type(error).__name__}"]
        if not isinstance(graph, dict) or not graph:
            failures.append("the artifact graph is not a non-empty mapping")
            continue

        produced: dict[str, str] = {
            artifact: "setup" for artifact in definition["setup"]["produces"]
        }
        consumers: dict[str, list[str]] = {}
        for stage in definition["stages"]:
            for artifact in stage["produces"]:
                produced[artifact] = stage["name"]
            for artifact in stage["consumes"]:
                consumers.setdefault(artifact, []).append(stage["name"])

        if set(graph) != set(produced) | set(consumers):
            failures.append("the graph does not have a node for every artifact")
            continue
        if any(graph[artifact].get("produced_by") != stage for artifact, stage in produced.items()):
            failures.append("an artifact is attributed to the wrong producing stage")
            continue
        if any(
            sorted(graph[artifact].get("consumed_by", [])) != sorted(stages)
            for artifact, stages in consumers.items()
        ):
            failures.append("an artifact's consumer list is wrong")
            continue

        try:
            dangling = module.dangling_artifacts(definition)
        except Exception as error:  # noqa: BLE001
            return [f"listing dangling artifacts raised {type(error).__name__}"]
        # Setup material has a producer -- the setup. An implementation that walks only
        # the stage list leaves it at None, and then every key looks dangling.
        if sorted(dangling) != []:
            failures.append("a complete pipeline was reported as having dangling artifacts")
            continue

        # And a pipeline that really is broken has to be reported as such: delete the
        # stage that produces the polynomial artifacts and they come from nowhere.
        broken = pipeline(name)
        polynomial_stage = stage_with_layer(broken, "polynomial")
        orphans = sorted(polynomial_stage["produces"])
        broken["stages"] = [
            stage for stage in broken["stages"] if stage["name"] != polynomial_stage["name"]
        ]
        if sorted(module.dangling_artifacts(broken)) != orphans:
            failures.append("an artifact with no producer was not reported as dangling")
    return failures


def _contract_case(module, checker: str, layer: str, seed: str) -> list[str]:
    """One layer's contract: clean on honest runs, and firing on the faults that break it.

    The honest half is not a formality. Half the ways to get a contract wrong -- reading
    the wrong field, applying a contract to a pipeline that does not have the stage --
    show up as a false positive rather than a false negative.
    """
    failures: list[str] = []
    faults = [fault for fault, spec in FAULTS.items() if spec["layer"] == layer]
    for name in NAMES:
        definition = pipeline(name)
        for label in LABELS:
            try:
                clean = getattr(module, checker)(definition, honest_run(seed, name, label))
            except Exception as error:  # noqa: BLE001
                return [f"{checker} raised {type(error).__name__} on an honest run"]
            if clean:
                return [f"{checker} reported a failure on an honest {name} run"]
        for fault in faults:
            if fault not in applicable_faults(name):
                continue
            reported = getattr(module, checker)(definition, faulted_run(seed, name, fault))
            if not reported:
                failures.append(f"{checker} did not notice an injected fault")
            elif not isinstance(reported, list) or not all(isinstance(m, str) for m in reported):
                failures.append(f"{checker} does not report a list of strings")
    return failures


def check_wiring(module, seed: str) -> list[str]:
    failures = _contract_case(module, "check_inputs", "input-boundary", seed)
    if failures:
        return failures

    for name in NAMES:
        # The record under-declares its own secrets: the witness is published AND
        # dropped from `secret`. Intersecting `public` with `secret` now finds nothing,
        # so a contract that trusts the record clears it. The definition still says no
        # verifier in this pipeline consumes a witness, and that is the ground truth.
        run = honest_run(seed, name)
        run["public"] = sorted({*run["public"], "witness"})
        run["secret"] = [artifact for artifact in run["secret"] if artifact != "witness"]
        if not module.check_inputs(pipeline(name), run):
            failures.append("a leak went unnoticed because the run did not admit to it")
    return failures


def check_constraints(module, seed: str) -> list[str]:
    """The commitment succeeded in every run here. That is the whole checkpoint."""
    failures = _contract_case(module, "check_constraints", "arithmetization", seed)
    failures.extend(_contract_case(module, "check_commitment", "commitment", seed))
    if failures:
        return failures

    for name in NAMES:
        definition = pipeline(name)

        # A run that rejected an unsatisfied constraint is doing its job and must not be
        # reported. An implementation that flags "any unsatisfied constraint" rather
        # than "accepted despite one" fails here.
        rejected = faulted_run(seed, name, "accepts-unsatisfied-constraint")
        rejected["verdict"] = "reject"
        if module.check_constraints(definition, rejected):
            failures.append("a run that correctly rejected an unsatisfied constraint was flagged")

        # `commitment_ok` is True in every run in this problem, including the one just
        # above with an unsatisfied constraint. A contract that reads it accepts that run.
        accepted = faulted_run(seed, name, "accepts-unsatisfied-constraint")
        if not module.check_constraints(definition, accepted):
            failures.append("an accepting run with an unsatisfied constraint was passed")

        # Setup material is public and fixed before the run, so requiring the commitment
        # to bind it would fail every honest run.
        commit_stage = stage_with_layer(definition, "commitment")
        if set(commit_stage["consumes"]) & set(definition["setup"]["produces"]):
            run = honest_run(seed, name)
            run["committed"] = sorted(non_setup_inputs(definition, commit_stage["name"]))
            if module.check_commitment(definition, run):
                failures.append("the commitment contract demands that setup material be committed")

        # And the artifact carrying constraint satisfaction is the one that matters:
        # dropping it has to be caught even though the commitment still succeeded.
        run = honest_run(seed, name)
        run["committed"] = [a for a in run["committed"] if a != constraint_artifact(definition)]
        if not module.check_commitment(definition, run):
            failures.append("dropping the constraint artifact from the commitment went unnoticed")
    return failures


def check_transcript(module, seed: str) -> list[str]:
    return _contract_case(module, "check_transcript", "transcript", seed)


def check_opening(module, seed: str) -> list[str]:
    failures = _contract_case(module, "check_openings", "opening", seed)
    failures.extend(_contract_case(module, "check_degree", "low-degree", seed))
    if failures:
        return failures

    for name in NAMES:
        definition = pipeline(name)

        # Counting rather than including: check as many openings as were required, but
        # not the ones that were required.
        run = honest_run(seed, name)
        run["openings_checked"] = [f"decoy-{entry}" for entry in run["openings_required"]]
        if not module.check_openings(definition, run):
            failures.append("checking the wrong openings passed as long as the count matched")

        # B's minimum is eight queries and A's is one. A submission that hardcoded a
        # threshold, or that only tested `queries == 0`, fails one of these.
        run = honest_run(seed, name)
        run["queries"] = definition["min_queries"] - 1
        if not module.check_openings(definition, run):
            failures.append("a query count below the pipeline's own minimum was accepted")
        run["queries"] = definition["min_queries"]
        if module.check_openings(definition, run):
            failures.append("a query count at the pipeline's own minimum was rejected")

    # A has no low-degree stage. Applying the contract there anyway fails every A run.
    run = honest_run(seed, "A")
    run["low_degree_checked"] = False
    if module.check_degree(pipeline("A"), run):
        failures.append("the low-degree contract was applied to a pipeline without that stage")
    return failures


def check_assumptions(module, seed: str) -> list[str]:
    failures: list[str] = []
    try:
        matrix = module.assumption_matrix(_definitions())
    except Exception as error:  # noqa: BLE001
        return [f"building the assumption matrix raised {type(error).__name__}"]
    if not isinstance(matrix, dict) or set(matrix) != set(NAMES):
        return ["the assumption matrix does not have an entry for each pipeline"]

    for name in NAMES:
        definition = PIPELINES[name]
        entry = matrix[name]
        if entry.get("setup") != definition["setup"]["kind"]:
            failures.append(f"pipeline {name}'s setup kind is wrong")
            continue
        if entry.get("transparent") != (definition["setup"]["kind"] == "transparent"):
            failures.append(f"pipeline {name} is classified as the wrong kind of setup")
            continue
        if sorted(entry.get("assumptions", [])) != sorted(definition["setup"]["assumptions"]):
            failures.append(f"pipeline {name}'s assumptions are wrong")
            continue
        # The whole misconception in one line: the transparent pipeline's assumption
        # list is not empty, and an implementation that made "transparent" mean
        # "assumption-free" has just emptied it.
        if not entry["assumptions"]:
            failures.append(f"pipeline {name} is presented as resting on no assumption")

    if not failures and matrix["A"]["transparent"] == matrix["B"]["transparent"]:
        failures.append("the two setups are classified the same way")
    return failures


def check_cost(module, seed: str) -> list[str]:
    failures: list[str] = []
    definitions = _definitions()
    try:
        reported = module.unsupported_claims(definitions, list(CLAIMS))
    except Exception as error:  # noqa: BLE001
        return [f"filtering the claims raised {type(error).__name__}"]
    if sorted(reported) != sorted(UNSUPPORTED_CLAIMS):
        missed = sorted(set(UNSUPPORTED_CLAIMS) - set(reported))
        wrong = sorted(set(reported) - set(UNSUPPORTED_CLAIMS))
        if missed:
            failures.append("an unsupported claim was let through")
        if wrong:
            failures.append("a claim the profiles do support was rejected")
        return failures

    # Rejecting everything scores the same as reading the profiles, unless the empty
    # claim list is handled too.
    if module.unsupported_claims(definitions, []) != []:
        failures.append("an empty claim list produced unsupported claims")

    # The comparison has to be a real ordering rather than a preference for one
    # pipeline: A's prover is the more expensive of the two, so this probe IS unsupported.
    probe = [
        {
            "id": "probe",
            "kind": "comparison",
            "about": "A",
            "against": "B",
            "property": "prover_time",
            "asserts": "smaller",
            "text": "probe",
        }
    ]
    if module.unsupported_claims(definitions, probe) != ["probe"]:
        failures.append("the cost comparison does not order the two profiles")

    # And the ordering has to be the declared one. "linear" sorts before "logarithmic"
    # alphabetically and after it by cost, so comparing the class names as strings gets
    # this backwards -- and gets it backwards on the two real profiles too, silently,
    # because there the two orderings happen to agree.
    ordering_probe = {
        "P": {"cost": {"proof_size": "linear"}, "setup": {"kind": "trusted", "assumptions": ["x"]}},
        "Q": {
            "cost": {"proof_size": "logarithmic"},
            "setup": {"kind": "trusted", "assumptions": ["x"]},
        },
    }
    if module.unsupported_claims(
        ordering_probe,
        [
            {
                "id": "order",
                "kind": "comparison",
                "about": "P",
                "against": "Q",
                "property": "proof_size",
                "asserts": "smaller",
                "text": "order",
            }
        ],
    ) != ["order"]:
        failures.append("cost classes are ordered alphabetically rather than by cost")
    return failures


def check_diagnose(module, seed: str) -> list[str]:
    """The first broken layer, and a repair that changes only what the fault damaged."""
    failures: list[str] = []
    for name in NAMES:
        definition = pipeline(name)

        try:
            order = list(module.layer_order(definition))
        except Exception as error:  # noqa: BLE001
            return [f"deriving the layer order raised {type(error).__name__}"]
        expected_order: list[str] = []
        for stage in definition["stages"]:
            if stage["layer"] not in expected_order:
                expected_order.append(stage["layer"])
        if order != expected_order:
            failures.append(f"pipeline {name}'s layer order does not match its stage order")
            continue

        if module.first_fault(definition, honest_run(seed, name)) is not None:
            failures.append(f"an honest {name} run was diagnosed with a fault")
            continue

        for fault in applicable_faults(name):
            expected_layer = FAULTS[fault]["layer"]
            field = FAULTS[fault]["repair_field"]
            run = faulted_run(seed, name, fault)

            diagnosed = module.first_fault(definition, run)
            if diagnosed != expected_layer:
                failures.append(f"a fault was diagnosed as {diagnosed!r}, not its own layer")
                continue

            repaired = module.repair(definition, run)
            if not isinstance(repaired, dict) or set(repaired) != set(run):
                failures.append("a repair did not produce a run record with the same fields")
                continue
            changed = sorted(key for key in run if repaired[key] != run[key])
            if changed != [field]:
                # Rebuilding a clean run passes every contract while destroying the
                # evidence; flipping the verdict silences every contract at once.
                # Both show up right here.
                failures.append(
                    f"repairing a fault changed {changed or ['nothing']}, "
                    f"not just the one field the fault damaged"
                )
                continue
            if _reference_first_fault(definition, repaired) is not None:
                failures.append("the repair for a fault still breaks a contract")

    # Two broken layers, one report: the earliest. This is the case a checker that
    # returns the worst, or the last, gets wrong.
    for name in NAMES:
        definition = pipeline(name)
        run = faulted_run(seed, name, "challenge-before-commitment")
        run["public"] = sorted({*run["public"], "witness"})
        if module.first_fault(definition, run) != "input-boundary":
            failures.append("with two layers broken, the later one was reported")
    return failures


# --- ground truth ----------------------------------------------------------
#
# A second implementation of the contracts, deliberately not imported from
# reference/pipeline.py and never taken from the submission. `repair` is graded against
# this, so a submission cannot certify its own repair with its own checker.


def _reference_first_fault(definition: dict, run: dict) -> str | None:
    setup = set(definition["setup"]["produces"])
    produced = set(setup)
    for stage in definition["stages"]:
        produced.update(stage["produces"])
    verifier = stage_with_layer(definition, "verifier")
    prover_only = produced - set(verifier["consumes"]) - {"verdict"}

    seen: list[str] = []
    for stage in definition["stages"]:
        layer = stage["layer"]
        if layer in seen:
            continue
        seen.append(layer)
        if layer == "input-boundary":
            if set(run["public"]) & set(run["secret"]):
                return layer
            if set(verifier["consumes"]) - set(run["public"]):
                return layer
            if set(run["public"]) & prover_only:
                return layer
            if set(run["setup_material"]) != setup:
                return layer
        elif layer == "arithmetization":
            if run["verdict"] == "accept" and any(
                not entry["satisfied"] for entry in run["constraints"]
            ):
                return layer
        elif layer == "commitment":
            commit_stage = stage_with_layer(definition, "commitment")
            if (set(commit_stage["consumes"]) - setup) - set(run["committed"]):
                return layer
        elif layer == "transcript":
            challenge_stage = stage_with_layer(definition, "transcript")
            if set(challenge_stage["consumes"]) - set(run["absorbed_before_challenge"]):
                return layer
        elif layer == "opening":
            if set(run["openings_required"]) - set(run["openings_checked"]):
                return layer
            if run["queries"] < definition["min_queries"]:
                return layer
        elif layer == "low-degree" and not run["low_degree_checked"]:
            return layer
    return None


PHASES = (
    check_graph,
    check_wiring,
    check_constraints,
    check_transcript,
    check_opening,
    check_assumptions,
    check_cost,
    check_diagnose,
)


def run(module, seed: str) -> list[str]:
    failures: list[str] = []
    for phase in PHASES:
        failures.extend(phase(module, seed))
    return failures
