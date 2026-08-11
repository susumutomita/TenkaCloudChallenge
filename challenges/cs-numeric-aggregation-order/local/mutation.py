"""Break the reference eight ways and require the hidden properties to notice."""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_aggregate import run

REFERENCE = (Path(__file__).parent / "reference" / "aggregate.py").read_text(encoding="utf-8")
# Issue 440: scaffold-leftover guard は tests/hidden に check_*.py 1 本だけを許す。
# これは hidden test ではなく mutation suite が読む author 専用の mutant なので、
# reference/ と同格の mutants/ へ置く (参加者 image には元から入らない)。
FSUM_MUTANT = (Path(__file__).parent / "mutants" / "sidecar_mutant.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: list[tuple[str, str, str]] = [
    (
        "accumulates the total in a float",
        '    total = sum((amount for _, amount in parsed), Decimal("0.00")).quantize(CENTS)',
        '    total = Decimal(f"{sum(float(amount) for _, amount in parsed):.2f}")',
    ),
    (
        "sorts before adding, which hides the order dependence without fixing it",
        '    total = sum((amount for _, amount in parsed), Decimal("0.00")).quantize(CENTS)',
        '    total = Decimal(f"{sum(sorted(float(amount) for _, amount in parsed)):.2f}")',
    ),
    (
        "parses each amount through a float before it becomes a Decimal",
        "            exact = Decimal(amount)",
        "            exact = Decimal(float(amount)).quantize(CENTS)",
    ),
    (
        "drops the leftover cents instead of allocating them",
        "    for position in range(remaining):\n        identifier = rows[order[position % len(order)]][0]\n        result[identifier] = result[identifier] + PERCENT",
        "    for position in range(0):\n        identifier = rows[order[position % len(order)]][0]\n        result[identifier] = result[identifier] + PERCENT",
    ),
    (
        "rounds every share on its own, so the parts can exceed the whole",
        '    floored = [(identifier, value.quantize(PERCENT, rounding="ROUND_DOWN")) for identifier, value in exact_shares]',
        "    floored = [(identifier, value.quantize(PERCENT)) for identifier, value in exact_shares]",
    ),
    (
        "dumps every leftover cent onto one row instead of the largest remainders",
        "        identifier = rows[order[position % len(order)]][0]",
        "        identifier = rows[0][0]",
    ),
    (
        "reports no shares when every amount is zero",
        '    if total == 0:\n        shares = {identifier: Decimal("0.00") for identifier, _ in rows}\n        if rows:\n            shares[rows[0][0]] = HUNDRED.quantize(PERCENT)',
        '    if total == 0:\n        shares = {identifier: Decimal("0.00") for identifier, _ in rows}\n        if False:\n            shares[rows[0][0]] = HUNDRED.quantize(PERCENT)',
    ),
    (
        "accepts amounts with more precision than the contract allows",
        "        if exact != exact.quantize(CENTS) or exact < 0:",
        "        if exact < 0:",
    ),
]


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mutant")
    module.__dict__["__file__"] = "<mutant>"
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author-only test
    return module


def main() -> int:
    baseline = run(_load(REFERENCE), SEED)
    if baseline:
        print("the reference does not pass its hidden suite:")
        for failure in baseline:
            print(f"  {failure}")
        return 1
    print("reference: passes")

    survivors: list[str] = []
    for name, before, after in MUTATIONS:
        if before not in REFERENCE:
            print(f"BROKEN {name}: mutation target is missing")
            survivors.append(name)
            continue
        source = REFERENCE.replace(before, after, 1)
        try:
            failures = run(_load(source), SEED)
        except Exception as error:  # noqa: BLE001 - a crashing mutant is killed
            failures = [type(error).__name__]
        if failures:
            print(f"killed {name}")
        else:
            print(f"SURVIVED {name}")
            survivors.append(name)

    fsum_name = "uses math.fsum, which removes the order dependence but not the error"
    try:
        failures = run(_load(FSUM_MUTANT), SEED)
    except Exception as error:  # noqa: BLE001 - a crashing mutant is killed
        failures = [type(error).__name__]
    if failures:
        print(f"killed {fsum_name}")
    else:
        print(f"SURVIVED {fsum_name}")
        survivors.append(fsum_name)

    if survivors:
        print(f"{len(survivors)} mutation(s) survived")
        return 1
    print(f"all {len(MUTATIONS) + 1} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
