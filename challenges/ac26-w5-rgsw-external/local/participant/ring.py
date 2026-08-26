"""The supplied ring, encoding and toy RLWE — the parts this problem does not ask you to write.

`ac26-w5-lwe-rlwe` is where the negacyclic ring and the LWE/RLWE round trip are the
exercise. Here they are given, correct, so the gadget and the external product are the
only things left to build.

Issue 543 option B2: these definitions used to live in `fixtures/generate.py`, which also
implements the ten functions `starter/rgsw.py` asks the learner to write. That module is
no longer in the participant Docker image (see ../Dockerfile), so the supplied half moved
here, where the starter and the public tests can still import it. `fixtures/generate.py`
imports these same functions from this file rather than restating them, so the ring a
learner builds on and the ring they are graded against cannot drift apart.

Conventions, the same ones `ac26-w5-lwe-rlwe` uses:

    R_q = Z_q[X] / (X^N + 1)      a coefficient wrapping past degree N comes back negated
    encode(m) = m * delta         delta = q // plaintext_modulus
    decode(c)                     nearest multiple of delta, ties rounding up

None of this is secure. The parameters are small enough to enumerate and the secret falls
to linear algebra. It is a toy of the mechanism.
"""

from __future__ import annotations


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


def rlwe_encrypt(par: dict, secret, messages, mask, noise) -> dict:
    product = ring_mul(par, mask, secret)
    encoded = [encode(par, m) for m in pad(par, messages)]
    return {
        "a": normalize(par, mask),
        "b": normalize(
            par, [p + e + n for p, e, n in zip(product, encoded, pad(par, noise))]
        ),
    }


def rlwe_phase(par: dict, secret, ciphertext: dict) -> tuple[int, ...]:
    return ring_sub(par, ciphertext["b"], ring_mul(par, ciphertext["a"], secret))


def rlwe_decrypt(par: dict, secret, ciphertext: dict) -> tuple[int, ...]:
    return tuple(decode(par, value) for value in rlwe_phase(par, secret, ciphertext))
