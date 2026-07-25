"""Author-side check: break the reference on purpose and confirm the hidden tests notice.

Every mutation here is off by one sign, one index, one term, or one parameter -- never by a
whole algorithm. Most of them produce a file that round-trips an LWE ciphertext correctly,
which is the property a learner checks first and the reason it is not enough.

Two candidate mutations were **dropped rather than left to survive**, both verified rather
than argued:

- Reducing the fold index in `phase_coefficient_terms` -- writing `-coefficients[(k + n - j)
  % n]` instead of `-coefficients[k + n - j]` -- cannot change any output. That branch only
  runs when `j > k`, and then `k + n - j` lies in `[k + 1, n - 1]`, already below `n`. The
  modulo is a no-op on every input the function can be called with.
- Dropping `% q` from the same expression is likewise unobservable there, because `mask` is
  normalized on the line above and `-coefficients[...]` is the only branch that can leave
  the range -- which is exactly what the surviving `% q` in the expression handles. Removing
  it from the negated branch alone is not expressible as a one-line substitution, so it is
  covered by the sign mutation instead.

Leaving an unkillable mutant in the list teaches that a `SURVIVED` line can be ignored, so
neither is here.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden import check_lattice  # noqa: E402

REFERENCE = (ROOT / "reference" / "lattice.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: tuple[tuple[str, list[tuple[str, str]]], ...] = (
    (
        "folds with a one-way threshold instead of a periodic sign",
        [
            (
                "        sign = -1 if (index // n) % 2 else 1",
                "        sign = -1 if index >= n else 1",
            )
        ],
    ),
    (
        "folds without flipping the sign at all, which is the cyclic ring",
        [("        sign = -1 if (index // n) % 2 else 1", "        sign = 1")],
    ),
    (
        "folds the degree but never reduces the coefficients",
        [("    return tuple(value % q for value in folded)", "    return tuple(folded)")],
    ),
    (
        "hardcodes the ring degree instead of reading the parameters",
        [
            (
                '    n, q = params["degree"], params["q"]\n    folded = [0] * n',
                '    n, q = 4, params["q"]\n    folded = [0] * n',
            )
        ],
    ),
    (
        "subtracts the wrong way round",
        [
            (
                "    return normalize(params, [a - b for a, b in zip(left, right)])",
                "    return normalize(params, [b - a for a, b in zip(left, right)])",
            )
        ],
    ),
    (
        "multiplies with a cyclic convolution, so X^N is +1",
        [("            raw[i + j] += a * b", "            raw[(i + j) % len(left)] += a * b")],
    ),
    (
        "encrypts without the noise",
        [
            (
                "    body = (sum(a * s for a, s in zip(mask, secret)) + encode(params, message) + error) % q",
                "    body = (sum(a * s for a, s in zip(mask, secret)) + encode(params, message)) % q",
            )
        ],
    ),
    (
        "puts the raw message into the ciphertext instead of its encoding point",
        [
            (
                "    body = (sum(a * s for a, s in zip(mask, secret)) + encode(params, message) + error) % q",
                "    body = (sum(a * s for a, s in zip(mask, secret)) + message + error) % q",
            )
        ],
    ),
    (
        "adds the inner product back instead of cancelling it",
        [
            (
                '    return (body - sum(a * s for a, s in zip(mask, secret))) % params["q"]',
                '    return (body + sum(a * s for a, s in zip(mask, secret))) % params["q"]',
            )
        ],
    ),
    (
        "reduces the phase modulo p instead of decoding it",
        [
            (
                "    return decode(params, lwe_phase(params, secret, ciphertext))",
                '    return lwe_phase(params, secret, ciphertext) % params["p"]',
            )
        ],
    ),
    (
        "encodes only the constant term of an RLWE message",
        [
            (
                "    encoded = [encode(params, m) for m in message]",
                "    encoded = [encode(params, message[0])] + [0] * (len(message) - 1)",
            )
        ],
    ),
    (
        "leaves the noise out of an RLWE ciphertext",
        [
            (
                "    body = normalize(params, [x + y + z for x, y, z in zip(product, encoded, error)])",
                "    body = normalize(params, [x + y for x, y in zip(product, encoded)])",
            )
        ],
    ),
    (
        "adds a*s back into the RLWE phase instead of cancelling it",
        [
            (
                "    return ring_sub(params, body, ring_mul(params, mask, secret))",
                "    return ring_add(params, body, ring_mul(params, mask, secret))",
            )
        ],
    ),
    (
        "drops the sign on the terms that walked past degree N",
        [
            (
                "        (coefficients[k - j] if j <= k else -coefficients[k + n - j]) % q for j in range(n)",
                "        (coefficients[k - j] if j <= k else coefficients[k + n - j]) % q for j in range(n)",
            )
        ],
    ),
    (
        "negates the right entries but forgets that they arrive reversed",
        [
            (
                "        (coefficients[k - j] if j <= k else -coefficients[k + n - j]) % q for j in range(n)",
                "        (coefficients[j] if j <= k else -coefficients[j]) % q for j in range(n)",
            )
        ],
    ),
    (
        "scores a polynomial by its total noise instead of its worst coefficient",
        [
            (
                "    return all(low <= value <= high for value in values)",
                "    return low <= sum(values) <= high",
            )
        ],
    ),
    (
        "survives when any coefficient survives, rather than when every one does",
        [
            (
                "    return all(low <= value <= high for value in values)",
                "    return any(low <= value <= high for value in values)",
            )
        ],
    ),
    (
        "treats the noise budget as symmetric, ignoring the tie rule",
        [
            (
                "    return all(low <= value <= high for value in values)",
                "    return all(-high <= value <= high for value in values)",
            )
        ],
    ),
    (
        "reports the failing sample instead of its index",
        [("            return index", "            return error")],
    ),
    (
        "reports index 0 when nothing failed",
        [("    return -1", "    return 0")],
    ),
    (
        "accepts a boolean where a coefficient belongs",
        [
            (
                "            if not isinstance(value, int) or isinstance(value, bool):",
                "            if not isinstance(value, int):",
            )
        ],
    ),
    (
        "accepts q itself as a canonical coefficient",
        [("            if not 0 <= value < q:", "            if not 0 <= value <= q:")],
    ),
    (
        "accepts a ciphertext carrying more coefficients than the ring has",
        [("        if len(value) != expected:", "        if len(value) < expected:")],
    ),
    (
        "accepts a ciphertext kind this problem does not define",
        [
            (
                '    if mode not in ("lwe", "rlwe"):',
                '    if mode not in ("lwe", "rlwe", "rgsw"):',
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
    baseline = check_lattice.run(_load(REFERENCE), SEED)
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
            failures = check_lattice.run(_load(mutated), SEED)
        except Exception as error:  # noqa: BLE001 - a mutation that crashes is caught
            failures = [f"raised {type(error).__name__}"]
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            print(f"SURVIVED {name}")
            survivors += 1

    # The always-succeed verifier is the one defect that cannot be written as a broken
    # submission: it lives in the verifier. Assert end to end that a submission which
    # implements nothing is rejected, and that the reference is not.
    from verifier.server import evaluate  # noqa: PLC0415 - imported after sys.path is set

    # Each line below names the DEFECT, like every mutation above it: KILLED means the
    # verifier does not have it.
    nothing = (ROOT / "starter" / "lattice.py").read_text(encoding="utf-8")
    if evaluate("normalize", nothing):
        print("SURVIVED verifier credits the untouched starter")
        survivors += 1
    else:
        print("KILLED verifier credits the untouched starter")
    if evaluate("normalize", REFERENCE):
        print("KILLED verifier withholds credit from the reference")
    else:
        print("SURVIVED verifier withholds credit from the reference")
        survivors += 1

    if survivors:
        print(f"\n{survivors} mutation(s) survived. The hidden tests have a hole.")
        return 1
    print(f"\nAll {len(MUTATIONS)} mutations killed, and the verifier grades both ways.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
