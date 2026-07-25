"""`make inspect` — the two pipelines, one honest run, and one run with something wrong.

The faulted run printed at the end is a real fault from the hidden set, but which one
is not announced. Reading the record against the stage contracts is the exercise.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (
    CLAIMS,
    applicable_faults,
    faulted_run,
    health_token,
    honest_run,
    pipeline,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _show_pipeline(name: str) -> None:
    definition = pipeline(name)
    setup = definition["setup"]
    print(f"pipeline {name}  ({definition['family']})")
    print(f"  setup      : {setup['kind']}, produces {', '.join(setup['produces'])}")
    print(f"  rests on   : {', '.join(setup['assumptions'])}")
    print(f"  min queries: {definition['min_queries']}")
    print(f"  cost       : {definition['cost']}")
    print()
    print(f"  {'stage':<12} {'layer':<16} {'consumes':<58} produces")
    for stage in definition["stages"]:
        consumes = ", ".join(stage["consumes"]) or "-"
        produces = ", ".join(stage["produces"])
        print(f"  {stage['name']:<12} {stage['layer']:<16} {consumes:<58} {produces}")
    print()


def _show_run(title: str, run: dict) -> None:
    print(title)
    for key in (
        "public",
        "secret",
        "setup_material",
        "commitment_ok",
        "committed",
        "absorbed_before_challenge",
        "openings_required",
        "openings_checked",
        "queries",
        "low_degree_checked",
        "verdict",
    ):
        value = run[key]
        rendered = ", ".join(map(str, value)) if isinstance(value, list) else str(value)
        print(f"  {key:<26} {rendered}")
    unsatisfied = [entry["id"] for entry in run["constraints"] if not entry["satisfied"]]
    print(f"  {'constraints':<26} {len(run['constraints'])} total, unsatisfied: {unsatisfied or 'none'}")
    print()


def main() -> None:
    print("health token :", health_token(SEED))
    print()
    for name in ("A", "B"):
        _show_pipeline(name)

    _show_run("an honest run of A:", honest_run(SEED, "A"))

    # Deterministic from the seed, so the same checkout always shows the same one.
    faults = applicable_faults("B")
    chosen = faults[sum(SEED.encode()) % len(faults)]
    _show_run("a run of B with one thing wrong:", faulted_run(SEED, "B", chosen))
    print("Which layer's contract broke first? Every later layer will look wrong too.")
    print()

    print("claims to sort into supported and unsupported:")
    for claim in CLAIMS:
        print(f"  {claim['id']:<34} {claim['text']}")
    print()
    print("Two of these confuse a property of the setup with a property of the assumptions.")


if __name__ == "__main__":
    main()
