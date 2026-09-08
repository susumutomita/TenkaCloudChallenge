"""Public previews: a 2x2 asset example, a reader/source example and output links.

These test explicit statement rules and return shapes. Passing does not establish
minimal selection, every flow, prose quality, or generalization to changed briefs.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from participant.lab import PRIMITIVES, PROPERTIES  # noqa: E402
from show import public_evidence  # noqa: E402
from starter.design import (  # noqa: E402
    architecture,
    attack_plan,
    classify_assets,
    compare_alternatives,
    property_matrix,
    required_properties,
    revise,
    select_primitive,
)


def _brief() -> dict:
    """Read the current deployment's public brief."""
    return public_evidence()["brief"]



def _small_brief():
    return {"id":"example", "statement":"B checks A's result without learning x",
            "actors":[{"id":"A", "role":"input_provider"}, {"id":"B", "role":"relying_party"}],
            "assets":[
                {"id":"x", "owner":"A", "known_to":["A"], "must_not_learn":["B"], "integrity_relied_on_by":[]},
                {"id":"y", "owner":"A", "known_to":["A","B"], "must_not_learn":[], "derived_from":["x"], "integrity_relied_on_by":["B"]}],
            "constraints":{}}


def test_asset_labels_follow_two_independent_facts():
    brief = _small_brief()
    brief["assets"] = [
        {"id":"a", "owner":"A", "known_to":["A"], "must_not_learn":[], "integrity_relied_on_by":[]},
        {"id":"b", "owner":"A", "known_to":["A"], "must_not_learn":["B"], "integrity_relied_on_by":[]},
        {"id":"c", "owner":"A", "known_to":["A"], "must_not_learn":[], "derived_from":["a"], "integrity_relied_on_by":[]},
        {"id":"d", "owner":"A", "known_to":["A"], "must_not_learn":["B"], "derived_from":["b"], "integrity_relied_on_by":[]}]
    assert classify_assets(brief) == {key:{"owner":"A", "classification":value} for key,value in
                                    (("a","public"),("b","private"),("c","derived-public"),("d","derived-private"))}


def test_reader_example_separates_zero_knowledge_from_computation_privacy():
    assert required_properties(_small_brief()) == dict(correctness=True, privacy=False, soundness=True,
                                                     zero_knowledge=True, binding=False, availability=False)


def test_comparison_contains_every_option_and_the_supplied_table_values():
    comparison = compare_alternatives(_small_brief())
    assert len(comparison) == len(PRIMITIVES)
    assert {entry["primitive"] for entry in comparison} == set(PRIMITIVES)
    for entry in comparison:
        option = PRIMITIVES[entry["primitive"]]
        assert set(entry["satisfies"]) == set(option["provides"])
        assert set(entry["assumptions"]) == set(option["assumptions"])
        assert set(entry["non_goals"]) == set(option["non_goals"])
        assert type(entry["admissible"]) is bool


def test_attack_plan_identifies_placed_trust_assumptions():
    brief = _brief()
    graph = architecture(brief, select_primitive(brief))
    plan = attack_plan(brief, graph)
    expected = {(primitive, trusted) for node in graph["nodes"] for primitive in node["primitives"]
                for trusted in PRIMITIVES[primitive]["trusts"]}
    reported = {(entry["assumption"]["primitive"], entry["assumption"]["trust"])
                for entry in plan if "assumption" in entry}
    assert reported == expected

def test_every_asset_is_classified() -> None:
    brief = _brief()
    classified = classify_assets(brief)
    assert set(classified) == {asset["id"] for asset in brief["assets"]}


def test_every_property_gets_an_answer() -> None:
    required = required_properties(_brief())
    assert set(required) == set(PROPERTIES)
    assert all(isinstance(value, bool) for value in required.values())


def test_correctness_is_always_required() -> None:
    assert required_properties(_brief())["correctness"] is True


def test_the_comparison_includes_using_no_cryptography() -> None:
    candidates = compare_alternatives(_brief())
    assert "none" in {candidate["primitive"] for candidate in candidates}


def test_the_selection_names_real_options() -> None:
    selection = select_primitive(_brief())
    assert isinstance(selection, (list, tuple))
    assert all(name in PRIMITIVES for name in selection)


def test_the_architecture_has_components_and_flows() -> None:
    brief = _brief()
    graph = architecture(brief, select_primitive(brief))
    assert graph.get("nodes") and graph.get("edges")


def test_the_attack_plan_meets_its_floor() -> None:
    brief = _brief()
    graph = architecture(brief, select_primitive(brief))
    assert len(attack_plan(brief, graph)) >= 5


def test_the_matrix_has_a_row_per_required_property() -> None:
    brief = _brief()
    graph = architecture(brief, select_primitive(brief))
    required = {prop for prop, needed in required_properties(brief).items() if needed}
    assert set(property_matrix(brief, graph)) == required


def test_revise_returns_a_whole_design() -> None:
    revised = revise(_brief())
    assert {"required", "selection", "architecture", "matrix"} <= set(revised)


def main() -> int:
    # `--only <substring>` backs `make test-one ID=...`: iterate on one behaviour
    # without re-reading the whole run.
    only = ""
    if "--only" in sys.argv:
        index = sys.argv.index("--only")
        only = sys.argv[index + 1] if index + 1 < len(sys.argv) else ""

    failures = 0
    selected = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        if only and only not in name:
            continue
        selected += 1
        try:
            fn()
            print(f"PASS {name}")
        except AssertionError as error:
            failures += 1
            print(f"FAIL {name}: {error or 'assertion failed'}")
        except Exception as error:  # noqa: BLE001 - a crash is a failure, reported as one
            failures += 1
            print(f"FAIL {name}: raised {type(error).__name__}")
    print()
    if selected == 0:
        print(f"no public test matched --only {only!r}")
        return 1
    print("public tests:", "all passed" if failures == 0 else f"{failures} failed")
    print()
    print("These previews cover small public rules and shapes. They do not prove every")
    print("selection, flow, experiment link or revised design is correct.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
