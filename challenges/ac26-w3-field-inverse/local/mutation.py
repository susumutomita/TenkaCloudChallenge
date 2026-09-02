"""Author-side check: break the reference on purpose and confirm the hidden tests notice.

The ones that matter most are the ones a working implementation is most likely to
contain: computing the inverse by Fermat's little theorem (fine on a prime, silently
wrong on a composite), the same shortcut behind a gcd guard (passes *every* checkpoint
but `units` -- it was a two-minute full score before that checkpoint existed), and
reducing only at the end (fine until a product overflows a comparison the tests make).

The `units` near-misses are run twice: in-process against the hidden suite, and again
through `verifier.server.evaluate_with_message`, so the seed-suffix path and the §15
message shape (property names only, never a number) are covered as well.
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
    # ---- `units` near-misses: everything below passes the other six checkpoints. ----
    (
        "inverts by the shortcut behind a gcd guard, so composite units get a wrong answer",
        [
            (
                "        return FieldElement(self.field, s)",
                "        return FieldElement(self.field, pow(self.value, self.field.modulus - 2,"
                " self.field.modulus))",
            )
        ],
    ),
    (
        "refuses every inverse over a composite modulus",
        [
            (
                "        g, s, _t = egcd(self.value, self.field.modulus)\n",
                "        if non_invertible_element(self.field.modulus) != 0:\n"
                '            raise NotInvertible("composite modulus")\n'
                "        g, s, _t = egcd(self.value, self.field.modulus)\n",
            )
        ],
    ),
    (
        "guards only the multiples of the smallest non-invertible element",
        [
            (
                "        g, s, _t = egcd(self.value, self.field.modulus)\n"
                "        # gcd != 1 is the only honest answer for a composite modulus. Fermat's little\n"
                "        # theorem would return a number here instead of raising.\n"
                "        if g != 1:\n"
                '            raise NotInvertible("element shares a factor with the modulus")\n'
                "        return FieldElement(self.field, s)",
                "        witness = non_invertible_element(self.field.modulus)\n"
                "        if witness and self.value % witness == 0:\n"
                '            raise NotInvertible("multiple of the smallest non-invertible element")\n'
                "        return FieldElement(self.field, pow(self.value, self.field.modulus - 2,"
                " self.field.modulus))",
            )
        ],
    ),
    (
        "division skips the gcd check and multiplies by the Bezout coefficient",
        [
            (
                "        return self * self._same(other).inverse()",
                "        other = self._same(other)\n"
                "        if other.value == 0:\n"
                '            raise NotInvertible("zero has no multiplicative inverse")\n'
                "        return self * FieldElement(self.field, egcd(other.value, self.field.modulus)[1])",
            )
        ],
    ),
)

#: The mutations above that only `units` can catch. Each is asserted to pass the other
#: six checkpoints in-process (so it really is a near-miss, not a plain bug) and to be
#: rejected by the verifier's own subprocess path with a property-only message.
UNITS_NEAR_MISSES = tuple(name for name, _ in MUTATIONS[-4:])


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

    survivors += _verifier_pass()

    if survivors:
        print(f"\n{survivors} mutation(s) survived. The hidden tests have a hole.")
        return 1
    print(f"\nAll {len(MUTATIONS)} mutations killed, and the verifier pass agrees.")
    return 0


def _mutate(name: str) -> str:
    mutated = REFERENCE
    for needle, replacement in dict(MUTATIONS)[name]:
        mutated = mutated.replace(needle, replacement)
    return mutated


def _other_six(module) -> list[str]:
    return [
        *check_field.check_normalize(module, SEED),
        *check_field.check_arithmetic(module, SEED),
        *check_field.check_egcd_trace(module, SEED),
        *check_field.check_inverse(module, SEED),
        *check_field.check_errors(module, SEED),
        *check_field.check_composite(module, SEED),
    ]


def _carries_value(message: str) -> bool:
    """A digit in a message would be the modulus or an element -- except the literal
    `[0, modulus)` range the canonical-representative and closure messages spell out."""
    return any(character.isdigit() for character in message.replace("[0,", ""))


def _verifier_pass() -> int:
    """The `units` near-misses through the real seam, and the reference with them.

    `evaluate_with_message` runs the submission in the verifier's subprocess under the
    `:units` seed suffix -- a different modulus from the in-process run above, so a
    mutation killed here was killed twice on two moduli. The message is checked for
    shape only: it must name properties and carry no digit beyond the literal `[0,` of
    a range, because any other digit would be the modulus or an element (AGENTS.md §15).
    """
    from verifier.server import evaluate_with_message  # noqa: PLC0415 - after sys.path

    survivors = 0
    correct, message = evaluate_with_message("units", REFERENCE)
    if not correct:
        print(f"FAIL the verifier rejects the reference on units ({message})")
        survivors += 1
    else:
        print("PASS the verifier accepts the reference on units")
    for name in UNITS_NEAR_MISSES:
        mutated = _mutate(name)
        leftovers = _other_six(_load(mutated))
        if leftovers:
            print(f"FAIL {name} is not a near-miss: another checkpoint already fails it ({leftovers[0]})")
            survivors += 1
            continue
        correct, message = evaluate_with_message("units", mutated)
        if correct:
            print(f"SURVIVED {name} (through the verifier)")
            survivors += 1
        elif not message or _carries_value(message):
            print(f"FAIL {name}: verifier message is missing or carries a value ({message!r})")
            survivors += 1
        else:
            print(f"KILLED {name} (verifier: {message})")
    return survivors


if __name__ == "__main__":
    raise SystemExit(main())
