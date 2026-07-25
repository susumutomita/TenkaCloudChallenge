"""Author-side check: break the reference on purpose and confirm the hidden tests notice.

The interesting entries here are the ones that stay *correct*. Reusing a triple, or
opening each product separately, both produce exactly the right score -- so if the suite
only checked the answer, half of this list would survive and the problem would be
grading nothing beyond arithmetic.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden import check_aggregate  # noqa: E402

REFERENCE = (ROOT / "reference" / "aggregate.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

# Each entry is (name, [(needle, replacement), ...]). Substitutions replace *every*
# occurrence: reusing one triple, for instance, only becomes the reuse defect when both
# the masking loop and the recombination loop take the same triple. Patching one of the
# two is a different bug -- an inconsistency -- and would be killed for the wrong reason.
MUTATIONS: tuple[tuple[str, list[tuple[str, str]]], ...] = (
    (
        "reuses one triple for every product (still correct)",
        [("triple = triple_list[index]", "triple = triple_list[0]")],
    ),
    (
        "opens each product separately (still correct, k rounds)",
        [
            (
                "    opened = io.open_batch(to_open)",
                "    opened = [v for pair in [io.open_batch(to_open[i:i+2])"
                " for i in range(0, len(to_open), 2)] for v in pair]",
            )
        ],
    ),
    (
        "claims one round per multiplication",
        [
            (
                'return {"multiplications": k, "triples": k, "rounds": 1}',
                'return {"multiplications": k, "triples": k, "rounds": k}',
            )
        ],
    ),
    (
        "claims one triple for the whole aggregate",
        [
            (
                'return {"multiplications": k, "triples": k, "rounds": 1}',
                'return {"multiplications": k, "triples": 1, "rounds": 1}',
            )
        ],
    ),
    (
        "adds the public bias to every share",
        [
            (
                "out[0] = (out[0] + constant) % p",
                "out = [(share + constant) % p for share in out]",
            )
        ],
    ),
    (
        "folds the public product into every share",
        [("product[0] = (product[0] + d * e) % p", "product = [(q + d * e) % p for q in product]")],
    ),
    (
        "opens the running subtotal",
        [
            (
                '    return add_public(total, spec["bias"], p)',
                '    io.open_batch([list(total)])\n    return add_public(total, spec["bias"], p)',
            )
        ],
    ),
    (
        # Reducing only at the very end is *equivalent* to reducing as you go, so
        # dropping one `% p` alone would be an equivalent mutant and would survive
        # forever. The real defect is never reducing at all, which is why this entry
        # removes both reductions and produces shares outside the field.
        "computes over the integers, so shares leave the field",
        [
            (
                "total = [(t + q) % p for t, q in zip(total, product)]",
                "total = [t + q for t, q in zip(total, product)]",
            ),
            ("out = [share % p for share in shares]", "out = list(shares)"),
        ],
    ),
    (
        "assumes a fixed party count",
        [('    p, k = spec["p"], spec["parties"]', '    p, k = spec["p"], 3')],
    ),
)


def _load(source: str):
    import types

    module = types.ModuleType("mutant")
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author tool
    return module


def main() -> int:
    baseline = check_aggregate.run(_load(REFERENCE), SEED)
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
            failures = check_aggregate.run(_load(mutated), SEED)
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
