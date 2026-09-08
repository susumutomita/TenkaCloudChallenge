"""Public previews: return shapes and the statement's two-wire example.

The small example checks actual carried labels, conditional coverage and its
publication violation. Deployment-wide diagnosis, counterexample construction,
minimal repair and all combinations of briefs still need checkpoint verification.
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

# Read only the public diagrams supplied by the current deployment.
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
EVIDENCE = public_evidence()
SOUND = sound_architectures(EVIDENCE)["mpc-prover"]
BRIEFS = briefs(EVIDENCE)
EDGE_IDS = {edge["id"] for edge in SOUND["edges"]}
NODE_IDS = {node["id"] for node in SOUND["nodes"]}


def _two_wire_example(public_output=False):
    labels = dict(representation="plaintext", classification="secret", algebra=None,
                  keyDomain=None, identity=None, serialization="canonical-v1")
    return {
        "caseId": "two-wire-example",
        "nodes": (
            dict(id="source", layer="host-orchestration", domain="one", transformation="carry"),
            dict(id="carry", layer="primitive-inside", domain="one", transformation="carry"),
            dict(id="sink", layer="host-orchestration", domain="one", transformation="carry"),
        ),
        "edges": (
            dict(id="e1", source="source", target="carry", **labels),
            dict(id="e2", source="carry", target="sink", **{
                **labels, "classification": "public" if public_output else "secret"}),
        ),
        "obligations": {},
        "policy": dict(mayDeclassify=(), mayCombine=(), mayKeySwitch=(), mayLift=(),
                       distinctDomains=(), maxCrossings=0),
    }


def test_carried_matches_the_two_wire_example():
    result = stack.carried(_two_wire_example(public_output=True))
    assert result == {"e1": {}, "e2": {
        "representation": "plaintext", "classification": "secret", "algebra": None,
        "keyDomain": None, "identity": None, "serialization": "canonical-v1"}}


def test_contracts_finds_the_two_wire_publication():
    assert tuple(stack.contract_violations(_two_wire_example(True))) == (("e2", "data-classification"),)


def test_underwrites_checks_the_two_wire_input_and_output():
    assert tuple(stack.underwrites(_two_wire_example())["carry"]) == ("correctness", "privacy")
    assert tuple(stack.underwrites(_two_wire_example(True))["carry"]) == ()


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
    # This happy-path preview is one public rule; it does not check all contracts.
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
    # These public inputs must retain the dictionary shape described in the statement.
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
    print("The two-wire example checks a public rule. Passing previews does not grade every")
    print("deployment, first-failure order, counterexample, minimal repair, or combined brief.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
