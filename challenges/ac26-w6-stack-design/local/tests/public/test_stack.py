"""Public tests: shapes, plus the one answer the problem text already handed you.

They check that every function answers for every edge, node and property it was asked about,
that a violation is a pair of a wire and a boundary class, that a repair and a counterexample
come back as architectures rather than as edits, that a design names all five of its fields, and
that a sound architecture has nothing wrong with it. That last one is not a spoiler — it is
stated outright in the starter, and every stack gets it right.

What is missing is everything else. Nothing here hands over an architecture that is broken,
nothing asks which of several symptoms came first, nothing checks that a counterexample left
every component content, nothing checks that a repair changed the deployment rather than the
requirement, and nothing hands over a brief that needs two primitives at once. The hidden
verifier does all five, one checkpoint at a time.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

from participant.lab import (  # noqa: E402
    ATTRIBUTES,
    BOUNDARY_CLASSES,
    CASES,
    EDGE_FIELDS,
    NODE_FIELDS,
    PROPERTIES,
    VARIANTS,
)
from show import briefs, public_evidence, sound_architectures  # noqa: E402
import stack  # noqa: E402

# Issue 537/538 (Issue 543 option B2): `fixtures/generate.py` does not ship in the participant
# image any more -- it holds this problem's whole ground truth under other names (`constrained`
# is `carried`, `violations` is `contract_violations`, `first_broken` is `first_failure`,
# `selection_truth` is `select`, and so on) as well as `BREAKS`, which names what each variant
# broke on every seed at once. `show.public_evidence` reads `GET /public` over the
# Compose-internal network (or `PUBLIC_EVIDENCE_JSON`, or the checkout's own fixtures when
# neither is set), and hands back the same architectures and briefs this file has always used.
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
EVIDENCE = public_evidence()
SOUND = sound_architectures(EVIDENCE)["mpc-prover"]
BRIEFS = briefs(EVIDENCE)
EDGE_IDS = {edge["id"] for edge in SOUND["edges"]}
NODE_IDS = {node["id"] for node in SOUND["nodes"]}


def test_carried_answers_for_every_edge_in_the_graph() -> None:
    answered = stack.carried(dict(SOUND))
    assert isinstance(answered, dict)
    assert set(answered) == EDGE_IDS


def test_carried_gives_each_edge_a_mapping_of_attributes() -> None:
    for requirement in stack.carried(dict(SOUND)).values():
        assert isinstance(requirement, dict)


def test_underwrites_answers_for_every_node_in_the_graph() -> None:
    answered = stack.underwrites(dict(SOUND))
    assert isinstance(answered, dict)
    assert set(answered) == NODE_IDS


def test_property_map_answers_for_all_five_properties() -> None:
    # Including the one no wire carries. An empty answer is an answer; a missing key is not.
    answered = stack.property_map(dict(SOUND))
    assert isinstance(answered, dict)
    assert set(answered) == set(PROPERTIES)


def test_contract_violations_returns_edge_and_boundary_class_pairs() -> None:
    for pair in stack.contract_violations(dict(SOUND)):
        assert isinstance(pair, (list, tuple)) and len(pair) == 2
        assert pair[0] in EDGE_IDS
        assert pair[1] in BOUNDARY_CLASSES


def test_a_sound_architecture_breaks_nothing() -> None:
    # The happy path, and the only one of the categories the problem text states outright.
    # A stack that gets this and nothing else clears no checkpoint.
    assert tuple(stack.contract_violations(dict(SOUND))) == ()


def test_first_failure_finds_nothing_wrong_with_a_sound_architecture() -> None:
    assert stack.first_failure(dict(SOUND)) is None


def test_counterexample_returns_an_architecture_rather_than_an_edit() -> None:
    built = stack.counterexample(dict(SOUND), "privacy")
    assert isinstance(built, dict)
    assert {edge["id"] for edge in built["edges"]} == EDGE_IDS
    assert {node["id"] for node in built["nodes"]} == NODE_IDS


def test_repair_returns_an_architecture_rather_than_an_edit() -> None:
    built = stack.repair(dict(SOUND))
    assert isinstance(built, dict)
    assert {edge["id"] for edge in built["edges"]} == EDGE_IDS
    assert {node["id"] for node in built["nodes"]} == NODE_IDS


def test_every_variant_rebuilds_into_an_architecture_you_can_read() -> None:
    # Issue 543 option B2: the thirteen deployments arrive as data now rather than from
    # `broken(seed, variant)`. This pins the round trip -- the shape the starter is written
    # against, not the diagnosis, which is the checkpoint.
    from show import broken_architectures

    deployments = broken_architectures(EVIDENCE)
    assert set(deployments) == set(VARIANTS)
    for built in deployments.values():
        assert built["caseId"] in CASES
        assert isinstance(built["nodes"], tuple) and isinstance(built["edges"], tuple)
        for node in built["nodes"]:
            assert set(node) == set(NODE_FIELDS)
        for edge in built["edges"]:
            assert set(edge) == set(EDGE_FIELDS)


def test_a_policy_and_its_obligations_survive_the_wire() -> None:
    assert isinstance(SOUND["policy"]["maxCrossings"], int)
    for group in SOUND["policy"]["distinctDomains"]:
        assert isinstance(group, tuple)
    for promises in SOUND["obligations"].values():
        for attribute, promise in promises.items():
            assert attribute in ATTRIBUTES
            assert isinstance(promise, tuple) and len(promise) == 2
            assert promise[1] in BOUNDARY_CLASSES


def test_select_names_all_five_fields_of_a_design() -> None:
    design = stack.select(dict(BRIEFS[0]))
    assert isinstance(design, dict)
    assert set(design) == {"primitives", "public", "secret", "trust", "dominantCost"}


def main() -> int:
    only = ""
    if "--only" in sys.argv:
        index = sys.argv.index("--only")
        only = sys.argv[index + 1] if index + 1 < len(sys.argv) else ""
    failures = 0
    selected = 0
    for name, function in sorted(globals().items()):
        if not name.startswith("test_") or not callable(function):
            continue
        if only and only not in name:
            continue
        selected += 1
        try:
            function()
            print(f"PASS {name}")
        except AssertionError as error:
            failures += 1
            print(f"FAIL {name}: {str(error) or 'assertion failed'}")
        except Exception as error:  # noqa: BLE001
            failures += 1
            print(f"FAIL {name}: raised {type(error).__name__}")
    print()
    if selected == 0:
        print(f"no public test matched --only {only!r}")
        return 1
    print("public tests:", "all passed" if failures == 0 else f"{failures} failed")
    print()
    print("Note what is missing above: nothing here hands over an architecture that is broken,")
    print("nothing asks which of several symptoms came first, nothing checks that a")
    print("counterexample left every component content, nothing checks that a repair changed the")
    print("deployment rather than the requirement, and nothing hands over a brief that needs two")
    print("primitives at once.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
