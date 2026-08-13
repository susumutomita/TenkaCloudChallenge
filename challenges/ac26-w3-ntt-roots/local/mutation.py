"""Author-side check: break the reference on purpose and confirm the hidden tests notice.

The two that matter most are the ones a working implementation is most likely to
contain: computing the inverse by Fermat's little theorem (fine on a prime, silently
wrong on a composite) and reducing only at the end (fine until a product overflows a
comparison the tests make).
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden import check_field  # noqa: E402

REFERENCE = (ROOT / "reference" / "field.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: tuple[tuple[str, list[tuple[str, str]]], ...] = (
    (
        "inverts by Fermat's little theorem, so composites get a wrong answer",
        [
            (
                "        g, s, _t = egcd(self.value, self.field.modulus)\n"
                "        # gcd != 1 is the only honest answer for a composite modulus. Fermat's little\n"
                "        # theorem would return a number here instead of raising.\n"
                "        if g != 1:\n"
                "            raise NotInvertible(\"element shares a factor with the modulus\")\n"
                "        return FieldElement(self.field, s)",
                "        return FieldElement(self.field, pow(self.value, self.field.modulus - 2,"
                " self.field.modulus))",
            )
        ],
    ),
    (
        "returns zero as its own inverse instead of raising",
        [
            (
                '        if self.value == 0:\n            raise NotInvertible("zero has no multiplicative inverse")',
                "        if self.value == 0:\n            return FieldElement(self.field, 0)",
            )
        ],
    ),
    (
        "returns the Bezout coefficient even when the gcd is not 1",
        [('        if g != 1:\n            raise NotInvertible("element shares a factor with the modulus")', "        pass")],
    ),
    (
        "does not normalize on construction",
        [("        self.value = value % field.modulus", "        self.value = value")],
    ),
    (
        "forgets the reduction in multiplication only",
        [
            (
                "    def __mul__(self, other: \"FieldElement\") -> \"FieldElement\":\n"
                "        return FieldElement(self.field, self.value * self._same(other).value)",
                "    def __mul__(self, other: \"FieldElement\") -> \"FieldElement\":\n"
                "        out = FieldElement(self.field, 0)\n"
                "        out.value = self.value * self._same(other).value\n"
                "        return out",
            )
        ],
    ),
    (
        "allows elements of different moduli to be combined",
        [
            (
                '        if not isinstance(other, FieldElement) or other.field.modulus != self.field.modulus:\n'
                '            raise FieldMismatch("elements come from different moduli")',
                "        pass",
            )
        ],
    ),
    (
        "reports a non-invertible element for a prime modulus",
        [("        if g != 1:\n            return candidate", "        if g != 1 or candidate == 2:\n            return candidate")],
    ),
    (
        "emits only the last row of the extended Euclidean trace",
        [
            (
                '        rows.append({"q": q, "r": old_r, "s": old_s, "t": old_t})\n    return rows',
                '        rows.append({"q": q, "r": old_r, "s": old_s, "t": old_t})\n    return rows[-1:]',
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
    baseline = check_field.run(_load(REFERENCE), SEED)
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
            failures = check_field.run(_load(mutated), SEED)
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
