"""The supplied ring, encoding, gadget and LWE phase — the parts this problem does not grade.

`ac26-w5-lwe-rlwe` is where the negacyclic ring and the LWE/RLWE round trip are the
exercise, `ac26-w5-rgsw-external` is where the gadget and the external product are, and
`ac26-w5-cmux-blind-rotation` is where the rotation loop is. Here they are given, correct,
so sample extraction and key switching are the only things left to build.

Issue 543 option B2: these definitions used to live in `fixtures/generate.py`, which also
implements the six functions `starter/extract.py` asks the learner to write — it cannot
derive this deployment's extraction trace, switched sample or domain report without them.
That module is no longer in the participant Docker image (see ../Dockerfile), so the
supplied half moved here, where the starter, the reference and the public tests can still
import it. `fixtures/generate.py` imports these same functions from this file rather than
restating them, so the arithmetic a learner builds on and the arithmetic they are graded
against cannot drift apart.

Conventions, all fixed and all written out in `starter/extract.py` as well:

    R_q = Z_q[X] / (X^N + 1)      a coefficient wrapping past degree N comes back negated
    q = B^L                       so the gadget decomposition is exact
    encode(m) = m * delta         delta = q // plaintext_modulus
    decode(c)                     nearest multiple of delta, ties rounding up
    phase(mask, body) = body - <mask, secret>        the same shape at either dimension

None of this is secure. The parameters are small enough to enumerate and the secret falls
to linear algebra. It is a toy of the mechanism.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Supplied: the ring and the encoding
# ---------------------------------------------------------------------------


def normalize(par: dict, coefficients) -> tuple[int, ...]:
    n, q = par["degree"], par["modulus"]
    out = [0] * n
    for index, value in enumerate(coefficients):
        sign = -1 if (index // n) % 2 else 1
        out[index % n] = (out[index % n] + sign * value) % q
    return tuple(out)


def pad(par: dict, coefficients) -> list[int]:
    values = list(coefficients)[: par["degree"]]
    return values + [0] * (par["degree"] - len(values))


def ring_add(par: dict, a, b) -> tuple[int, ...]:
    return normalize(par, [x + y for x, y in zip(pad(par, a), pad(par, b))])


def ring_sub(par: dict, a, b) -> tuple[int, ...]:
    return normalize(par, [x - y for x, y in zip(pad(par, a), pad(par, b))])


def ring_mul(par: dict, a, b) -> tuple[int, ...]:
    left, right = pad(par, a), pad(par, b)
    raw = [0] * (2 * par["degree"] - 1)
    for i, x in enumerate(left):
        for j, y in enumerate(right):
            raw[i + j] += x * y
    return normalize(par, raw)


def encode(par: dict, m: int) -> int:
    return (m % par["plaintext_modulus"]) * par["delta"] % par["modulus"]


def decode(par: dict, c: int) -> int:
    delta = par["delta"]
    return ((c % par["modulus"]) + delta // 2) // delta % par["plaintext_modulus"]


def centered(par: dict, x: int) -> int:
    q = par["modulus"]
    value = x % q
    return value - q if value >= (q + 1) // 2 else value


# ---------------------------------------------------------------------------
# Supplied: the gadget (ac26-w5-rgsw-external's output)
# ---------------------------------------------------------------------------


def gadget_vector(par: dict) -> tuple[int, ...]:
    return tuple(par["base"] ** i for i in range(par["levels"]))


def decompose(par: dict, value: int) -> tuple[int, ...]:
    """Unsigned base-B digits of `value mod q`, least significant first, exactly L of them."""
    base, remaining = par["base"], value % par["modulus"]
    digits = []
    for _ in range(par["levels"]):
        digits.append(remaining % base)
        remaining //= base
    return tuple(digits)


def decompose_poly(par: dict, poly) -> tuple[tuple[int, ...], ...]:
    per_coefficient = [decompose(par, c) for c in pad(par, poly)]
    return tuple(
        tuple(per_coefficient[k][i] for k in range(par["degree"]))
        for i in range(par["levels"])
    )


# ---------------------------------------------------------------------------
# Supplied: the RLWE and LWE phases
# ---------------------------------------------------------------------------


def rlwe_encrypt(par: dict, secret, messages, mask, noise) -> dict:
    product = ring_mul(par, mask, secret)
    encoded = [encode(par, m) for m in pad(par, messages)]
    return {
        "a": normalize(par, mask),
        "b": normalize(par, [p + e + n for p, e, n in zip(product, encoded, pad(par, noise))]),
    }


def rlwe_trivial(par: dict, messages) -> dict:
    return {
        "a": tuple([0] * par["degree"]),
        "b": normalize(par, [encode(par, m) for m in pad(par, messages)]),
    }


def rlwe_phase(par: dict, secret, ciphertext: dict) -> tuple[int, ...]:
    """`b - a * s` in the ring. Coefficient `i` of this is what extraction has to preserve."""
    return ring_sub(par, ciphertext["b"], ring_mul(par, ciphertext["a"], secret))


def rlwe_decrypt(par: dict, secret, ciphertext: dict) -> tuple[int, ...]:
    return tuple(decode(par, value) for value in rlwe_phase(par, secret, ciphertext))


def lwe_phase_of(par: dict, secret, sample: dict) -> int:
    """`body - <mask, secret>` in `Z_q`. The same shape at either dimension."""
    inner = sum(m * s for m, s in zip(sample["mask"], secret))
    return (sample["body"] - inner) % par["modulus"]


def lwe_decrypt(par: dict, secret, sample: dict) -> int:
    return decode(par, lwe_phase_of(par, secret, sample))
