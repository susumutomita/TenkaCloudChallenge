"""Author-side check: break the reference on purpose and confirm the hidden tests notice.

Every mutation here produces a scheme that runs. Most of them encrypt and decrypt their
own ciphertexts perfectly -- a cyclic ring is a ring, a sign-flipped phase cancels a
sign-flipped product, and a ciphertext that carries its own plaintext round-trips better
than the real one. They differ from the reference only when something else has to agree
with them, which is why every round-trip in the hidden suite is run crossed against the
fixtures rather than against the submission.

Nothing here is an equivalent mutant.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden import check_lwe  # noqa: E402

REFERENCE = (ROOT / "reference" / "lwe.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: tuple[tuple[str, list[tuple[str, str]]], ...] = (
    (
        "uses a cyclic ring, X^N = +1, instead of a negacyclic one",
        [('        sign = -1 if (index // n) % 2 else 1', "        sign = 1")],
    ),
    (
        "negates on every wrap instead of on odd wraps, so two wraps stay negative",
        [
            (
                "        sign = -1 if (index // n) % 2 else 1",
                "        sign = -1 if index >= n else 1",
            )
        ],
    ),
    (
        "skips the coefficient reduction, leaving values outside [0, q)",
        [
            (
                "        out[index % n] = (out[index % n] + sign * value) % q",
                "        out[index % n] = out[index % n] + sign * value",
            )
        ],
    ),
    (
        "truncates past degree N instead of folding",
        [
            (
                "    for index, value in enumerate(coefficients):\n"
                "        sign = -1 if (index // n) % 2 else 1\n"
                "        out[index % n] = (out[index % n] + sign * value) % q",
                "    for index, value in enumerate(coefficients):\n"
                "        if index >= n:\n"
                "            continue\n"
                "        out[index] = value % q",
            )
        ],
    ),
    (
        "hardcodes a degree of four instead of reading the parameters",
        [('    n, q = params["degree"], params["modulus"]\n    out = [0] * n', '    n, q = 4, params["modulus"]\n    out = [0] * n')],
    ),
    (
        "reverses the coefficient order in the ring product",
        [
            (
                "            raw[i + j] += x * y",
                "            raw[i + j] += x * right[len(right) - 1 - j]",
            )
        ],
    ),
    (
        "gets the inner product's sign wrong when encrypting",
        [
            (
                '    product = sum(a * s for a, s in zip(mask, secret)) % q\n'
                '    return {\n        "a": tuple(int(a) % q for a in mask),',
                '    product = -sum(a * s for a, s in zip(mask, secret)) % q\n'
                '    return {\n        "a": tuple(int(a) % q for a in mask),',
            )
        ],
    ),
    (
        "adds the secret product back instead of cancelling it",
        [('    phase = (ciphertext["b"] - product) % q', '    phase = (ciphertext["b"] + product) % q')],
    ),
    (
        "drops the noise term entirely",
        [
            (
                '        "b": (product + encode(params, message) + noise) % q,',
                '        "b": (product + encode(params, message)) % q,',
            )
        ],
    ),
    (
        "ignores the mask, so every ciphertext of a message is the same",
        [
            (
                "    product = sum(a * s for a, s in zip(mask, secret)) % q\n"
                '    return {\n        "a": tuple(int(a) % q for a in mask),',
                "    product = 0\n"
                '    return {\n        "a": tuple(int(a) % q for a in mask),',
            )
        ],
    ),
    (
        "keeps the plaintext inside the ciphertext object",
        [
            (
                '        "b": (product + encode(params, message) + noise) % q,\n    }',
                '        "b": (product + encode(params, message) + noise) % q,\n'
                '        "message": message,\n    }',
            )
        ],
    ),
    (
        "confuses the ciphertext modulus with the plaintext modulus when encoding",
        [
            (
                '    return (m % params["plaintext_modulus"]) * params["delta"] % params["modulus"]',
                '    return (m % params["plaintext_modulus"]) * params["delta"] % params["plaintext_modulus"]',
            )
        ],
    ),
    (
        "leaves the noise out of the RLWE body",
        [
            (
                "        params, [p + e + n for p, e, n in zip(product, encoded, _pad(params, noise))]",
                "        params, [p + e for p, e in zip(product, encoded)]",
            )
        ],
    ),
    (
        "adds the RLWE secret product back instead of subtracting it",
        [
            (
                '    phase = ring_sub(params, ciphertext["b"], ring_mul(params, ciphertext["a"], secret))',
                '    phase = ring_add(params, ciphertext["b"], ring_mul(params, ciphertext["a"], secret))',
            )
        ],
    ),
    (
        "decrypts only the constant coefficient and pads the rest with zero",
        [
            (
                "    messages = tuple(decode(params, value) for value in phase)",
                "    messages = (decode(params, phase[0]),) + (0,) * (params[\"degree\"] - 1)",
            )
        ],
    ),
    (
        "calls the RLWE operation an inner product",
        [('            "operation": "negacyclic-product",', '            "operation": "inner-product",')],
    ),
    (
        "reports one message per RLWE ciphertext, as if it were LWE",
        [('            "payload_size": params["degree"],', '            "payload_size": 1,')],
    ),
    (
        "uses a symmetric noise budget, ignoring the tie rule",
        [
            (
                "    return -(delta // 2) <= noise <= delta - delta // 2 - 1",
                "    return -(delta // 2) <= noise <= delta // 2",
            )
        ],
    ),
    (
        "sorts the samples by magnitude instead of scanning the given order",
        [
            (
                "    for sample in samples:\n"
                "        if not survives(params, sample[\"noise\"]):\n"
                "            return sample[\"index\"]\n"
                "    return -1",
                "    for sample in sorted(samples, key=lambda entry: abs(entry[\"noise\"])):\n"
                "        if not survives(params, sample[\"noise\"]):\n"
                "            return sample[\"index\"]\n"
                "    return -1",
            )
        ],
    ),
    (
        "validates every ciphertext against the LWE dimension",
        [
            (
                '    expected = params["dimension"] if kind == "lwe" else params["degree"]',
                '    expected = params["dimension"]',
            )
        ],
    ),
    (
        "accepts negative coefficients as canonical",
        [("        if not 0 <= value < q:", "        if not -q < value < q:")],
    ),
    (
        "lets an RLWE ciphertext hold two polynomials from different rings",
        [
            (
                "            if len(bodies) != expected:\n"
                '                failures.append(f"the body has {len(bodies)} coefficients, not {expected}")',
                "            pass",
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
    baseline = check_lwe.run(_load(REFERENCE), SEED)
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
            failures = check_lwe.run(_load(mutated), SEED)
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
