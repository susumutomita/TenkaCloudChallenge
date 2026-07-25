"""Author-side check: break the reference on purpose and confirm the hidden tests notice.

Most of these produce a file that is self-consistent: a reversed digit order with a
reversed gadget still round-trips, and an RGSW whose row layout is wrong still works
against an external product that is wrong the same way. They only separate from the
reference once something built here has to agree with something built there, which is why
every RGSW check in the hidden suite is crossed.

Nothing here is an equivalent mutant, and two candidates were dropped to keep it that way.
Both are artifacts of `q = base ** levels`:

  * removing `value % modulus` from `decompose` changes nothing, because taking exactly
    `levels` base-B digits **is** reduction modulo `base ** levels`. Verified exhaustively
    over every viable parameter set and every value in `[-3q, 3q)`, including negatives.
  * removing `% modulus` from `recompose` changes nothing either: `levels` digits each below
    `base`, weighted by the gadget, sum to at most `q - 1`.

Both lines stay in the reference. They say what is meant and they would be load-bearing
under an approximate gadget, which is what a real implementation uses. They are simply not
detectable here, and an unkillable entry in this list would teach that a SURVIVED line can
be ignored.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden import check_rgsw  # noqa: E402

REFERENCE = (ROOT / "reference" / "rgsw.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: tuple[tuple[str, list[tuple[str, str]]], ...] = (
    (
        "builds the gadget vector most-significant first",
        [
            (
                '    return tuple(params["base"] ** index for index in range(params["levels"]))',
                '    return tuple(params["base"] ** index for index in reversed(range(params["levels"])))',
            )
        ],
    ),
    (
        "reverses the digit order, which a round trip alone cannot see",
        [
            (
                "        digits.append(remaining % base)\n        remaining //= base\n    return tuple(digits)",
                "        digits.append(remaining % base)\n        remaining //= base\n    return tuple(reversed(digits))",
            )
        ],
    ),
    (
        "hardcodes a base of two instead of reading the parameters",
        [
            (
                '    base, remaining = params["base"], value % params["modulus"]',
                '    base, remaining = 2, value % params["modulus"]',
            )
        ],
    ),
    (
        "produces one digit too few",
        [('    for _ in range(params["levels"]):', '    for _ in range(params["levels"] - 1):')],
    ),
    (
        "transposes levels and coefficients in the polynomial decomposition",
        [
            (
                "    return tuple(\n"
                "        tuple(per_coefficient[k][i] for k in range(degree))\n"
                '        for i in range(params["levels"])\n'
                "    )",
                "    return tuple(tuple(d) for d in per_coefficient)",
            )
        ],
    ),
    (
        "uses a float logarithm, which is off by one at an exact power",
        [
            (
                "    needed, covered = 0, 1\n"
                "    while covered < modulus:\n"
                "        covered *= base\n"
                "        needed += 1\n"
                "    return needed",
                "    import math\n"
                "    return int(math.ceil(math.log(modulus, base)))",
            )
        ],
    ),
    (
        "reports the largest representable value rather than the smallest unrepresentable one",
        [
            (
                "    reach = base**levels\n    return reach if reach < modulus else None",
                "    reach = base**levels\n    return reach - 1 if reach < modulus else None",
            )
        ],
    ),
    (
        "puts every gadget term in the a slot, so the b half of the product is unweighted",
        [
            (
                "        if j < levels:\n"
                "            rows.append((_bump(params, mask, selector * gadget[j]), body))\n"
                "        else:\n"
                "            rows.append((_reduce(params, mask), _bump(params, body, selector * gadget[j - levels])))",
                "        if j < levels:\n"
                "            rows.append((_bump(params, mask, selector * gadget[j]), body))\n"
                "        else:\n"
                "            rows.append((_bump(params, mask, selector * gadget[j - levels]), body))",
            )
        ],
    ),
    (
        "swaps which half of the rows carries which slot",
        [
            ("        if j < levels:\n            rows.append((_bump", "        if j >= levels:\n            rows.append((_bump")
        ],
    ),
    (
        "keeps the selector in the returned structure, where a product could read it",
        [
            (
                "            rows.append((_reduce(params, mask), _bump(params, body, selector * gadget[j - levels])))\n"
                "    return tuple(rows)",
                "            rows.append((_reduce(params, mask), _bump(params, body, selector * gadget[j - levels]), selector))\n"
                "    return tuple(rows)",
            )
        ],
    ),
    (
        "accepts a selector that is not a bit",
        [
            (
                '    if selector not in (0, 1):\n        raise ValueError("the selector is a bit")',
                "    pass",
            )
        ],
    ),
    (
        "shifts the gadget term into the linear coefficient instead of the constant one",
        [("    out[0] = (out[0] + amount) % params[\"modulus\"]", "    out[-1] = (out[-1] + amount) % params[\"modulus\"]")],
    ),
    (
        "decomposes only the b half, dropping the mask's contribution",
        [
            (
                '    return list(decompose_poly(params, ciphertext["a"])) + list(\n'
                '        decompose_poly(params, ciphertext["b"])\n'
                "    )",
                '    zero = tuple([0] * params["degree"])\n'
                '    return [zero] * params["levels"] + list(decompose_poly(params, ciphertext["b"]))',
            )
        ],
    ),
    (
        "concatenates the two digit vectors the other way round",
        [
            (
                '    return list(decompose_poly(params, ciphertext["a"])) + list(\n'
                '        decompose_poly(params, ciphertext["b"])\n'
                "    )",
                '    return list(decompose_poly(params, ciphertext["b"])) + list(\n'
                '        decompose_poly(params, ciphertext["a"])\n'
                "    )",
            )
        ],
    ),
    (
        "stops one row short of the end",
        [
            (
                '    for j in range(2 * params["levels"]):\n'
                "        left = ring_add(params, left, ring_mul(params, digits[j], rgsw[j][0]))",
                '    for j in range(2 * params["levels"] - 1):\n'
                "        left = ring_add(params, left, ring_mul(params, digits[j], rgsw[j][0]))",
            )
        ],
    ),
    (
        "returns its input, which decrypts correctly for selector 1 and is not a product",
        [
            (
                "    digits = _digit_vector(params, ciphertext)\n"
                '    left = right = tuple([0] * params["degree"])',
                "    return dict(ciphertext)\n"
                "    digits = _digit_vector(params, ciphertext)\n"
                '    left = right = tuple([0] * params["degree"])',
            )
        ],
    ),
    (
        "labels every trace row with the a slot",
        [('                "slot": "a" if j < params["levels"] else "b",', '                "slot": "a",')],
    ),
    (
        "reports the partial product as the accumulator, so the trace never sums",
        [
            (
                '                "accumulated_a": left,\n                "accumulated_b": right,',
                '                "accumulated_a": partial_a,\n                "accumulated_b": partial_b,',
            )
        ],
    ),
)


def _load(source: str):
    import types

    module = types.ModuleType("mutant")
    module.__dict__["__file__"] = str(ROOT / "reference" / "rgsw.py")
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author tool
    return module


def main() -> int:
    baseline = check_rgsw.run(_load(REFERENCE), SEED)
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
            failures = check_rgsw.run(_load(mutated), SEED)
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
