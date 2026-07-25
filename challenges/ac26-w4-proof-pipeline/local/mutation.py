"""Author-side check: break the reference on purpose and confirm the hidden tests notice.

Every mutation here is a *plausible* implementation, not a typo. Most of them pass the
public tests and every honest run; they differ only in what they do when a pipeline is
actually broken, or when the pipeline is B rather than A.

Nothing in this file is an equivalent mutant. Two candidates were dropped while writing
it: excluding `verdict` from the prover-only set (nothing ever publishes it, so
including it changes no verdict) and sorting `dangling_artifacts`' output (the hidden
tests sort before comparing). A mutation that cannot change an outcome does not
demonstrate coverage, and listing it would inflate the count for nothing.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden import check_pipeline  # noqa: E402

REFERENCE = (ROOT / "reference" / "pipeline.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: tuple[tuple[str, list[tuple[str, str]]], ...] = (
    (
        "leaves setup material out of the graph, so every key looks dangling",
        [
            (
                '    for artifact in definition["setup"]["produces"]:\n'
                '        slot(artifact)["produced_by"] = "setup"\n',
                "",
            )
        ],
    ),
    (
        "trusts the run's own list of secrets instead of deriving it",
        [
            (
                "    leaked = sorted(public & _prover_only(definition))",
                "    leaked = sorted(public & secret)",
            )
        ],
    ),
    (
        "accepts setup material as long as there is some",
        [
            (
                "    if set(run[\"setup_material\"]) != expected_material:",
                "    if not run[\"setup_material\"]:",
            )
        ],
    ),
    (
        "reads commitment_ok instead of the constraints",
        [
            (
                '    unsatisfied = [entry["id"] for entry in run["constraints"] if not entry["satisfied"]]\n'
                '    if unsatisfied and run["verdict"] == "accept":',
                '    unsatisfied = [entry["id"] for entry in run["constraints"] if not entry["satisfied"]]\n'
                '    if unsatisfied and not run["commitment_ok"]:',
            )
        ],
    ),
    (
        "flags any unsatisfied constraint, including one the run correctly rejected",
        [
            (
                '    if unsatisfied and run["verdict"] == "accept":',
                "    if unsatisfied:",
            )
        ],
    ),
    (
        "requires the commitment to bind the setup material too",
        [
            (
                '    required = set(commit_stage["consumes"]) - _setup_artifacts(definition)',
                '    required = set(commit_stage["consumes"])',
            )
        ],
    ),
    (
        "checks only that the commitment absorbed something",
        [
            (
                '    missing = sorted(required - set(run["committed"]))\n    if missing:',
                '    missing = sorted(required - set(run["committed"]))\n    if not run["committed"]:',
            )
        ],
    ),
    (
        "absorbs the commitment but not the statement",
        [
            (
                '    missing = sorted(set(challenge_stage["consumes"]) - set(run["absorbed_before_challenge"]))',
                '    missing = sorted({"commitment"} - set(run["absorbed_before_challenge"]))',
            )
        ],
    ),
    (
        "compares how many openings were checked instead of which ones",
        [
            (
                '    missing = sorted(set(run["openings_required"]) - set(run["openings_checked"]))\n'
                "    if missing:",
                '    missing = sorted(set(run["openings_required"]) - set(run["openings_checked"]))\n'
                '    if len(run["openings_checked"]) < len(run["openings_required"]):',
            )
        ],
    ),
    (
        "treats zero queries as the only bad query count",
        [
            (
                '    if run["queries"] < definition["min_queries"]:',
                '    if run["queries"] == 0:',
            )
        ],
    ),
    (
        "applies the low-degree contract to every pipeline",
        [
            (
                '    if _stage_with_layer(definition, "low-degree") is None:\n        return []\n',
                "",
            )
        ],
    ),
    (
        "derives transparency from an empty assumption list",
        [
            (
                '            "transparent": definition["setup"]["kind"] == "transparent",',
                '            "transparent": not definition["setup"]["assumptions"],',
            )
        ],
    ),
    (
        "reports a transparent setup as resting on nothing",
        [
            (
                '            "assumptions": sorted(definition["setup"]["assumptions"]),',
                '            "assumptions": []\n'
                '            if definition["setup"]["kind"] == "transparent"\n'
                '            else sorted(definition["setup"]["assumptions"]),',
            )
        ],
    ),
    (
        "takes a transparent pipeline's word that it assumes nothing",
        [
            (
                '            supported = not definitions[claim["about"]]["setup"]["assumptions"]',
                '            supported = definitions[claim["about"]]["setup"]["kind"] == "transparent"',
            )
        ],
    ),
    (
        "compares cost classes as strings rather than by rank",
        [
            ("            supported = _rank(mine) < _rank(theirs)", "            supported = mine < theirs")
        ],
    ),
    (
        "hardcodes A's layer order, which misplaces B's low-degree stage",
        [
            (
                "    order: list[str] = []\n"
                '    for stage in definition["stages"]:\n'
                '        if stage["layer"] not in order:\n'
                '            order.append(stage["layer"])\n'
                "    return order",
                "    return [\n"
                '        "input-boundary",\n'
                '        "arithmetization",\n'
                '        "polynomial",\n'
                '        "commitment",\n'
                '        "transcript",\n'
                '        "opening",\n'
                '        "verifier",\n'
                "    ]",
            )
        ],
    ),
    (
        "reports the last broken layer instead of the first",
        [
            (
                "        if contract(definition, run):\n            return layer\n    return None",
                "    broken = [\n"
                "        layer\n"
                "        for layer in layer_order(definition)\n"
                "        if CONTRACTS.get(layer) and CONTRACTS[layer](definition, run)\n"
                "    ]\n"
                "    return broken[-1] if broken else None",
            )
        ],
    ),
    (
        "repairs by rebuilding a run that satisfies everything",
        [
            (
                '    fixed = dict(run)\n    if layer == "input-boundary":',
                "    fixed = dict(run)\n"
                '    fixed["public"] = sorted(_stage_with_layer(definition, "verifier")["consumes"])\n'
                '    fixed["setup_material"] = sorted(_setup_artifacts(definition))\n'
                '    fixed["committed"] = sorted(\n'
                '        set(_stage_with_layer(definition, "commitment")["consumes"])\n'
                "        - _setup_artifacts(definition)\n"
                "    )\n"
                '    fixed["absorbed_before_challenge"] = sorted(\n'
                '        _stage_with_layer(definition, "transcript")["consumes"]\n'
                "    )\n"
                '    fixed["openings_checked"] = sorted(run["openings_required"])\n'
                '    fixed["queries"] = max(run["queries"], definition["min_queries"])\n'
                '    fixed["low_degree_checked"] = True\n'
                '    fixed["verdict"] = "reject"\n'
                "    return fixed\n"
                '    if layer == "input-boundary":',
            )
        ],
    ),
    (
        "repairs a bad transcript by rejecting instead of absorbing",
        [
            (
                '    elif layer == "transcript":\n'
                "        challenge_stage = _stage_with_layer(definition, \"transcript\")\n"
                '        fixed["absorbed_before_challenge"] = sorted(\n'
                '            set(run["absorbed_before_challenge"]) | set(challenge_stage["consumes"])\n'
                "        )",
                '    elif layer == "transcript":\n        fixed["verdict"] = "reject"',
            )
        ],
    ),
)


def _load(source: str):
    import types

    module = types.ModuleType("mutant")
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author tool
    return module


def main() -> int:
    baseline = check_pipeline.run(_load(REFERENCE), SEED)
    if baseline:
        print(f"FAIL reference implementation does not pass the hidden tests: {baseline}")
        return 1
    print("PASS reference implementation passes the hidden tests")

    survivors = 0
    for name, substitutions in MUTATIONS:
        missing = [needle for needle, _ in substitutions if needle not in REFERENCE]
        if missing:
            print(f"SURVIVED {name} (the mutation no longer applies to the reference)")
            survivors += 1
            continue
        mutated = REFERENCE
        for needle, replacement in substitutions:
            mutated = mutated.replace(needle, replacement)
        try:
            failures = check_pipeline.run(_load(mutated), SEED)
        except Exception as error:  # noqa: BLE001 - a mutation that crashes is caught
            failures = [f"raised {type(error).__name__}"]
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            print(f"SURVIVED {name}")
            survivors += 1

    if survivors:
        print(f"\n{survivors} mutation(s) survived. The hidden tests have a hole.")
        return 1
    print(f"\nAll {len(MUTATIONS)} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
