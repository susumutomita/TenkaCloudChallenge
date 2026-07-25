"""Author-side check: break the reference on purpose and confirm the hidden tests notice.

The list is dominated by the ways a *nearly* correct group law fails. Using the chord's
slope for doubling, or treating the identity as (0, 0), both produce plausible points
for most inputs and break only where the group law's case split lives -- which is
exactly what the checkpoints are aimed at.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden import check_curve  # noqa: E402

REFERENCE = (ROOT / "reference" / "curve.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: tuple[tuple[str, list[tuple[str, str]]], ...] = (
    (
        "adds points coordinate-wise",
        [
            (
                "        x = (slope * slope - self.x - other.x) % p\n"
                "        y = (slope * (self.x - x) - self.y) % p",
                "        x = (self.x + other.x) % p\n        y = (self.y + other.y) % p",
            )
        ],
    ),
    (
        "represents the identity as (0, 0)",
        [
            ("        return self.x is None and self.y is None", "        return (self.x, self.y) == (0, 0)"),
            ("        return Point(self, None, None)", "        return Point(self, 0, 0)"),
        ],
    ),
    (
        "doubles with the chord's numerator instead of the tangent's",
        [("(3 * self.x * self.x + self.curve.a)", "(other.y - self.y)")],
    ),
    (
        "misses the inverse case, so P + (-P) divides by zero",
        [
            (
                "        if self.x == other.x and (self.y + other.y) % p == 0:\n"
                "            # P + (-P), which includes P + P when y == 0.\n"
                "            return self.curve.infinity()",
                "        pass",
            )
        ],
    ),
    (
        "consumes the scalar's bits most significant first",
        [
            (
                "            if scalar & 1:\n"
                "                result = result + addend\n"
                "            addend = addend + addend\n"
                "            scalar >>= 1",
                "            if scalar & (1 << (scalar.bit_length() - 1)):\n"
                "                result = result + addend\n"
                "            addend = addend + addend\n"
                "            scalar >>= 1",
            )
        ],
    ),
    (
        "returns the point itself for a scalar of zero",
        [
            (
                "        result = self.curve.infinity()\n        addend = Point(self.curve, self.x, self.y)",
                "        result = Point(self.curve, self.x, self.y)\n"
                "        addend = Point(self.curve, self.x, self.y)",
            )
        ],
    ),
    (
        "accepts a pair that is not on the curve",
        [
            (
                "        if not self.contains(candidate):\n"
                '            raise NotOnCurve(f"({x}, {y}) does not satisfy the curve equation")',
                "        pass",
            )
        ],
    ),
    (
        "lets points from two different curves be combined",
        [
            (
                "        if not isinstance(other, Point) or other.curve.params != self.curve.params:\n"
                '            raise CurveMismatch("points come from different curves")',
                "        pass",
            )
        ],
    ),
    (
        "negates by flipping x instead of y",
        [
            (
                "        return Point(self.curve, self.x, (-self.y) % self.curve.p)",
                "        return Point(self.curve, (-self.x) % self.curve.p, self.y)",
            )
        ],
    ),
    (
        # `addend = self` alone is an equivalent mutant: __add__ returns a new Point, so
        # nothing is written through the alias. The real defect is __add__ writing its
        # result into the receiver, which is what this substitutes.
        "writes the sum into the point it was given instead of returning a new one",
        [
            (
                "        x = (slope * slope - self.x - other.x) % p\n"
                "        y = (slope * (self.x - x) - self.y) % p\n"
                "        return Point(self.curve, x, y)",
                "        x = (slope * slope - self.x - other.x) % p\n"
                "        y = (slope * (self.x - x) - self.y) % p\n"
                "        self.x, self.y = x, y\n"
                "        return self",
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
    baseline = check_curve.run(_load(REFERENCE), SEED)
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
            failures = check_curve.run(_load(mutated), SEED)
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
