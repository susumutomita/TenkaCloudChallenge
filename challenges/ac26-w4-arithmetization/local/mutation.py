"""Author-side check: break the reference on purpose and confirm the hidden tests notice.

The two that matter most produce a system that looks complete: checking only the final
row, and dropping the boundary constraints. Both accept traces that are not the
computation, and neither is visible from the happy path.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden import check_air  # noqa: E402

REFERENCE = (ROOT / "reference" / "air.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: tuple[tuple[str, list[tuple[str, str]]], ...] = (
    (
        "checks only the last transition instead of every one",
        [("    for index in range(len(trace) - 1):\n        a, b = trace[index]", "    for index in range(len(trace) - 2, len(trace) - 1):\n        a, b = trace[index]")],
    ),
    (
        "drops the boundary constraints entirely",
        [
            (
                "    return [(trace[0][0] - start_a) % p, (trace[0][1] - start_b) % p]",
                "    return [0, 0]",
            )
        ],
    ),
    (
        "reports a transition failure at the row it came from, not the row it broke",
        [('            return {"row": index + 1, "kind": "transition"}', '            return {"row": index, "kind": "transition"}')],
    ),
    (
        "calls a wrong starting state a transition failure",
        [
            (
                "    if any(residual != 0 for residual in boundary_residuals(trace, setting)):\n"
                '        return {"row": 0, "kind": "boundary"}',
                "    pass",
            )
        ],
    ),
    (
        "interpolates over the integers instead of the field",
        [
            (
                "        scale = values[index] * pow(denominator, -1, p) % p",
                "        scale = values[index] // denominator if denominator else 0",
            )
        ],
    ),
    (
        "confuses the transition weight with the field modulus",
        [
            (
                "        out.append((((a + b) - next_a) % p, ((b + weight * a) - next_b) % p))",
                "        out.append((((a + b) - next_a) % p, ((b + p * a) - next_b) % p))",
            )
        ],
    ),
    (
        "produces a residual per row rather than per adjacent pair",
        [("    for index in range(len(trace) - 1):\n        a, b = trace[index]", "    for index in range(len(trace)):\n        a, b = trace[index % len(trace)]")],
    ),
    (
        "returns the honest trace as the underconstrained witness",
        [('    forged["start"] = ((start_a + 1) % p, start_b)', '    forged["start"] = (start_a, start_b)')],
    ),
    (
        "leaves one column unconstrained",
        [
            (
                "        out.append((((a + b) - next_a) % p, ((b + weight * a) - next_b) % p))",
                "        out.append((((a + b) - next_a) % p, 0))",
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
    baseline = check_air.run(_load(REFERENCE), SEED)
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
            failures = check_air.run(_load(mutated), SEED)
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
