"""The supplied ring, encoding, RGSW and external product — the parts this problem gives you.

`ac26-w5-lwe-rlwe` is where the negacyclic ring and the RLWE round trip are the exercise,
and `ac26-w5-rgsw-external` is where the gadget and the external product are. Here they are
given, correct, so CMUX, monomial rotation and the blind-rotation loop are the only things
left to build.

Issue 543 option B2: these definitions used to live in `fixtures/generate.py`, which also
implements the eight functions `starter/cmux.py` asks the learner to write — it cannot
derive a deployment's CMUX demonstration or its blind-rotation trace without them. That
module is no longer in the participant Docker image (see ../Dockerfile), so the supplied
half moved here, where the starter, the reference and the public tests can still import it.
`fixtures/generate.py` imports these same functions from this file rather than restating
them, so the ring a learner builds on and the ring they are graded against cannot drift
apart.

Conventions, all fixed and all written out in `starter/cmux.py` as well:

    R_q = Z_q[X] / (X^N + 1)      a coefficient wrapping past degree N comes back negated
    q = B^L                       so the gadget decomposition is exact
    encode(m) = m * delta         delta = q // plaintext_modulus, plaintext_modulus = 4
    decode(c)                     nearest multiple of delta, ties rounding up

None of this is secure. The parameters are small enough to enumerate and the secret falls
to linear algebra. It is a toy of the mechanism.
"""

from __future__ import annotations

import hashlib

# ---------------------------------------------------------------------------
# Supplied: the ring and the encoding
# ---------------------------------------------------------------------------


def normalize(par: dict, coefficients) -> tuple[int, ...]:
    """Fold a raw coefficient list into `Z_q[X]/(X^N+1)`.

    Index `i` beyond the degree wraps to `i % N` with the sign `(-1)^(i // N)`. That is the
    whole negacyclic rule, and monomial rotation is nothing more than this applied to a list
    that has been shifted right by the exponent.
    """
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
# Supplied: the gadget and RGSW (ac26-w5-rgsw-external's output)
# ---------------------------------------------------------------------------


def gadget_vector(par: dict) -> tuple[int, ...]:
    return tuple(par["base"] ** i for i in range(par["levels"]))


def decompose(par: dict, value: int) -> tuple[int, ...]:
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


def rlwe_encrypt(par: dict, secret, messages, mask, noise) -> dict:
    product = ring_mul(par, mask, secret)
    encoded = [encode(par, m) for m in pad(par, messages)]
    return {
        "a": normalize(par, mask),
        "b": normalize(
            par, [p + e + n for p, e, n in zip(product, encoded, pad(par, noise))]
        ),
    }


def rlwe_trivial(par: dict, messages) -> dict:
    """A ciphertext of `messages` with no mask and no noise: `a = 0`, `b = encoded`.

    It decrypts under every secret, which is exactly why the accumulator starts here -- the
    test vector is public, and starting it noiseless is what leaves the whole noise budget
    to the CMUXes.
    """
    return {
        "a": tuple([0] * par["degree"]),
        "b": normalize(par, [encode(par, m) for m in pad(par, messages)]),
    }


def rlwe_phase(par: dict, secret, ciphertext: dict) -> tuple[int, ...]:
    return ring_sub(par, ciphertext["b"], ring_mul(par, ciphertext["a"], secret))


def rlwe_decrypt(par: dict, secret, ciphertext: dict) -> tuple[int, ...]:
    return tuple(decode(par, value) for value in rlwe_phase(par, secret, ciphertext))


def rgsw_encrypt(par: dict, secret, selector: int, material: dict) -> tuple:
    """2L rows of (a, b). Rows below L carry the gadget in `a`, rows above it in `b`."""
    levels, gadget = par["levels"], gadget_vector(par)
    rows = []
    for j in range(2 * levels):
        mask, noise = material["masks"][j], material["noises"][j]
        body = normalize(
            par, [x + y for x, y in zip(ring_mul(par, mask, secret), pad(par, noise))]
        )
        if j < levels:
            rows.append(
                (normalize(par, [mask[0] + selector * gadget[j], *mask[1:]]), body)
            )
        else:
            rows.append(
                (
                    normalize(par, mask),
                    normalize(par, [body[0] + selector * gadget[j - levels], *body[1:]]),
                )
            )
    return tuple(rows)


def external_product(par: dict, rgsw, ciphertext: dict) -> dict:
    """`d . RGSW`, with `d` the two decomposed halves concatenated. No secret, by design."""
    digits = list(decompose_poly(par, ciphertext["a"])) + list(
        decompose_poly(par, ciphertext["b"])
    )
    left = right = tuple([0] * par["degree"])
    for j in range(2 * par["levels"]):
        left = ring_add(par, left, ring_mul(par, digits[j], rgsw[j][0]))
        right = ring_add(par, right, ring_mul(par, digits[j], rgsw[j][1]))
    return {"a": left, "b": right}


# ---------------------------------------------------------------------------
# Supplied: the ciphertext digest the trace reports
# ---------------------------------------------------------------------------


def digest(par: dict, ciphertext: dict) -> str:
    """A short, stable fingerprint of a ciphertext. Supplied so the format is not guesswork.

    It is a hash of the ciphertext, so two ciphertexts that decrypt to the same plaintext
    still have different digests. That is the point: a CMUX output that shares a digest with
    one of its candidates is that candidate, which is the shape of a plaintext branch.
    """
    payload = ":".join(
        str(value) for value in (*pad(par, ciphertext["a"]), *pad(par, ciphertext["b"]))
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:12]
