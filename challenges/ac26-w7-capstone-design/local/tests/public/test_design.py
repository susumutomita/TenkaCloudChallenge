"""Public tests: they show you the shape of the answer. They do not prove it.

They work through exactly one brief — the one `make inspect` prints — and they check
structure, not judgement. Nothing here asks whether your requirements follow from the brief,
whether your selection is minimal, whether an asset leaks across an edge, or what happens
when the facts change. All of that is graded, and none of it is visible from here.

Read `misconception.public-tests-are-complete` in the README before trusting a green run.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import PRIMITIVES, PROPERTIES, public_brief  # noqa: E402
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

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _brief() -> dict:
    return public_brief(SEED)


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
    assert isinstance(selection, list)
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
    print("Passing these does not mean you are done. They read one brief, and they never")
    print("ask whether your answers follow from it — only whether they have the right shape.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
