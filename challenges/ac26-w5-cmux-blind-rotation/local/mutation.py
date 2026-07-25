"""Author-side check: break the reference on purpose and confirm the hidden tests notice.

Two families run through this list. The first is arithmetic that is wrong in one place and
shows up immediately -- a difference the wrong way round, a half of a ciphertext left
unrotated. The second is wrong *consistently*, and those are the ones worth the list: a
rotation direction reversed in both `monomial_rotate` and the loop is self-consistent, and
only separates from the reference once it is compared against a plaintext model that never
calls either. That is why `check_blind` builds its answer from the phase in the clear.

Nothing here is an equivalent mutant. Two candidates were considered and dropped, both for
the same reason -- the degenerate case where a CMUX's two branches coincide:

  * making `cmux` return `ct0` when `ct1 - ct0` is the zero ciphertext changes nothing,
    because the external product of zero digits **is** the zero ciphertext and the reference
    already returns `ct0` there, exactly.
  * skipping a blind-rotation step whose mask coefficient is zero changes nothing either,
    for the same reason: both candidates are the same ciphertext, so the CMUX is the
    identity on it.

Both are real properties of the construction rather than gaps in the tests, and an
unkillable entry in this list would teach that a SURVIVED line can be ignored.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden import check_cmux  # noqa: E402

REFERENCE = (ROOT / "reference" / "cmux.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: tuple[tuple[str, list[tuple[str, str]]], ...] = (
    (
        "adds only the b half, leaving the mask unaccounted for",
        [
            (
                '        "a": ring_add(params, left["a"], right["a"]),\n'
                '        "b": ring_add(params, left["b"], right["b"]),',
                '        "a": tuple(left["a"]),\n'
                '        "b": ring_add(params, left["b"], right["b"]),',
            )
        ],
    ),
    (
        "subtracts only the b half",
        [
            (
                '        "a": ring_sub(params, left["a"], right["a"]),\n'
                '        "b": ring_sub(params, left["b"], right["b"]),',
                '        "a": tuple(left["a"]),\n'
                '        "b": ring_sub(params, left["b"], right["b"]),',
            )
        ],
    ),
    (
        "takes the branch difference the wrong way round",
        [
            (
                "    return rlwe_add(params, ct0, external_product(params, rgsw, rlwe_sub(params, ct1, ct0)))",
                "    return rlwe_add(params, ct0, external_product(params, rgsw, rlwe_sub(params, ct0, ct1)))",
            )
        ],
    ),
    (
        "adds the product onto ct1 instead of ct0",
        [
            (
                "    return rlwe_add(params, ct0, external_product(params, rgsw, rlwe_sub(params, ct1, ct0)))",
                "    return rlwe_add(params, ct1, external_product(params, rgsw, rlwe_sub(params, ct1, ct0)))",
            )
        ],
    ),
    (
        "returns ct1, which is right for selector 1 and is not a CMUX",
        [
            (
                "    return rlwe_add(params, ct0, external_product(params, rgsw, rlwe_sub(params, ct1, ct0)))",
                "    return dict(ct1)",
            )
        ],
    ),
    (
        "returns ct0, ignoring the encrypted selector entirely",
        [
            (
                "    return rlwe_add(params, ct0, external_product(params, rgsw, rlwe_sub(params, ct1, ct0)))",
                "    return dict(ct0)",
            )
        ],
    ),
    (
        "rotates cyclically, dropping the negacyclic sign",
        [
            (
                "    return normalize(params, [0] * shift + padded)",
                "    rotated = [padded[(index - shift) % degree] for index in range(degree)]\n"
                "    return tuple(value % params['modulus'] for value in rotated)",
            )
        ],
    ),
    (
        "normalizes the exponent modulo N instead of 2N, which loses exactly the sign",
        [("    shift = exponent % (2 * degree)", "    shift = exponent % degree")],
    ),
    (
        "rotates the other way",
        [
            (
                "    shift = exponent % (2 * degree)",
                "    shift = (-exponent) % (2 * degree)",
            )
        ],
    ),
    (
        "leaves a negative exponent unnormalized",
        [("    shift = exponent % (2 * degree)", "    shift = exponent")],
    ),
    (
        "hardcodes a ring degree of four instead of reading the parameters",
        [('    degree = params["degree"]\n    shift =', "    degree = 4\n    shift =")],
    ),
    (
        "rotates only the b half of the ciphertext",
        [
            (
                '        "a": monomial_rotate(params, ciphertext["a"], exponent),\n'
                '        "b": monomial_rotate(params, ciphertext["b"], exponent),',
                '        "a": tuple(ciphertext["a"]),\n'
                '        "b": monomial_rotate(params, ciphertext["b"], exponent),',
            )
        ],
    ),
    (
        "puts the two conditional-rotation candidates the wrong way round",
        [
            (
                "    return cmux(params, rgsw, ciphertext, rotate_ciphertext(params, ciphertext, exponent))",
                "    return cmux(params, rgsw, rotate_ciphertext(params, ciphertext, exponent), ciphertext)",
            )
        ],
    ),
    (
        "offsets by +body instead of -body",
        [
            (
                '    current = rotate_ciphertext(params, accumulator, -sample["body"])\n'
                "    for index, mask in enumerate(sample[\"mask\"]):\n"
                "        current = conditional_rotate(params, key[index], current, mask)",
                '    current = rotate_ciphertext(params, accumulator, sample["body"])\n'
                "    for index, mask in enumerate(sample[\"mask\"]):\n"
                "        current = conditional_rotate(params, key[index], current, mask)",
            )
        ],
    ),
    (
        "skips the offset rotation, so the public part of the phase never lands",
        [
            (
                '    current = rotate_ciphertext(params, accumulator, -sample["body"])\n'
                "    for index, mask in enumerate(sample[\"mask\"]):\n"
                "        current = conditional_rotate(params, key[index], current, mask)",
                "    current = dict(accumulator)\n"
                "    for index, mask in enumerate(sample[\"mask\"]):\n"
                "        current = conditional_rotate(params, key[index], current, mask)",
            )
        ],
    ),
    (
        "conditionally rotates by -mask, undoing the mask instead of applying it",
        [
            (
                "        current = conditional_rotate(params, key[index], current, mask)\n"
                "    return current",
                "        current = conditional_rotate(params, key[index], current, -mask)\n"
                "    return current",
            )
        ],
    ),
    (
        "skips the first mask coefficient",
        [
            (
                '    for index, mask in enumerate(sample["mask"]):\n'
                "        current = conditional_rotate(params, key[index], current, mask)\n"
                "    return current",
                '    for index, mask in enumerate(sample["mask"]):\n'
                "        if index == 0:\n            continue\n"
                "        current = conditional_rotate(params, key[index], current, mask)\n"
                "    return current",
            )
        ],
    ),
    (
        "skips the last mask coefficient",
        [
            (
                '    for index, mask in enumerate(sample["mask"]):\n'
                "        current = conditional_rotate(params, key[index], current, mask)\n"
                "    return current",
                '    for index, mask in enumerate(sample["mask"][:-1]):\n'
                "        current = conditional_rotate(params, key[index], current, mask)\n"
                "    return current",
            )
        ],
    ),
    (
        "pairs each mask coefficient with the wrong bootstrapping-key row",
        [
            (
                '    for index, mask in enumerate(sample["mask"]):\n'
                "        current = conditional_rotate(params, key[index], current, mask)\n"
                "    return current",
                '    for index, mask in enumerate(sample["mask"]):\n'
                "        current = conditional_rotate(params, key[len(key) - 1 - index], current, mask)\n"
                "    return current",
            )
        ],
    ),
    (
        "uses the same key row for every step",
        [
            (
                '    for index, mask in enumerate(sample["mask"]):\n'
                "        current = conditional_rotate(params, key[index], current, mask)\n"
                "    return current",
                '    for index, mask in enumerate(sample["mask"]):\n'
                "        current = conditional_rotate(params, key[0], current, mask)\n"
                "    return current",
            )
        ],
    ),
    (
        "labels every trace step with the first key row",
        [('                "selector": f"bk[{index}]",', '                "selector": "bk[0]",')],
    ),
    (
        "reports the rotated candidate as the step's output, so the trace never accumulates",
        [
            (
                '                "output": digest(params, output),\n'
                "            }\n"
                "        )\n"
                "        current = output",
                '                "output": digest(params, candidate1),\n'
                "            }\n"
                "        )\n"
                "        current = output",
            )
        ],
    ),
    (
        "omits the public offset record, so the trace starts one step in",
        [
            (
                "    records = [\n        {\n            \"step\": 0,",
                "    records = []\n    _unused = [\n        {\n            \"step\": 0,",
            )
        ],
    ),
    (
        "leaves the trace's exponent unnormalized",
        [('                "exponent": mask % modulus,', '                "exponent": mask,')],
    ),
)


def _load(source: str):
    import types

    module = types.ModuleType("mutant")
    module.__dict__["__file__"] = str(ROOT / "reference" / "cmux.py")
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author tool
    return module


def main() -> int:
    baseline = check_cmux.run(_load(REFERENCE), SEED)
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
            failures = check_cmux.run(_load(mutated), SEED)
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
