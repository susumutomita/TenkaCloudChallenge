"""Reference implementation. Lives inside the image only; not bind-mounted.

Used by two things: the mutation suite (which breaks copies of this file and asserts the
hidden tests catch each break), and the `reference-test` CI target.

The ring, RLWE, RGSW and the external product are supplied by `fixtures.generate` -- this
problem is CMUX, monomial rotation, and the loop that chains them, not a re-derivation of
Week 5's second and third problems. Nothing here hardcodes a degree, a base, a level count
or an LWE dimension, because `transfer` runs the whole file under parameters derived from a
different seed.
"""

from __future__ import annotations

from fixtures.generate import external_product, normalize, ring_add, ring_sub


# ---------------------------------------------------------------------------
# Adding and subtracting ciphertexts
# ---------------------------------------------------------------------------


def rlwe_add(params: dict, left: dict, right: dict) -> dict:
    """Component-wise, on **both** halves.

    RLWE is additively homomorphic because `(a0+a1, b0+b1)` has phase `phase0 + phase1`, and
    that only holds if the masks are added too. Adding `b` alone leaves a ciphertext whose
    mask no longer accounts for the sum, and it decrypts to noise.
    """
    return {
        "a": ring_add(params, left["a"], right["a"]),
        "b": ring_add(params, left["b"], right["b"]),
    }


def rlwe_sub(params: dict, left: dict, right: dict) -> dict:
    """`left - right`, component-wise. The order matters: CMUX wants `ct1 - ct0`."""
    return {
        "a": ring_sub(params, left["a"], right["a"]),
        "b": ring_sub(params, left["b"], right["b"]),
    }


# ---------------------------------------------------------------------------
# CMUX
# ---------------------------------------------------------------------------


def cmux(params: dict, rgsw, ct0: dict, ct1: dict) -> dict:
    """`ct0 + RGSW(mu) * (ct1 - ct0)`.

    Read it as arithmetic rather than as a choice: the external product returns
    `RLWE(0) + mu * (ct1 - ct0)`, so the sum is `ct0` when mu is 0 and `ct1` when mu is 1 --
    plus fresh noise in both cases, which is why the output is a new ciphertext either way
    and never one of the inputs handed back.

    There is no secret here and there must not be. `mu` stays encrypted; the two branches
    are one expression, and that is the entire reason an encrypted bit can steer anything.
    """
    return rlwe_add(params, ct0, external_product(params, rgsw, rlwe_sub(params, ct1, ct0)))


# ---------------------------------------------------------------------------
# Rotation
# ---------------------------------------------------------------------------


def monomial_rotate(params: dict, poly, exponent: int) -> tuple[int, ...]:
    """`X^exponent * poly` in `Z_q[X]/(X^N+1)`.

    Two facts do all the work. `X^N = -1`, so a coefficient that wraps past the degree comes
    back negated; and `X^(2N) = 1`, so the exponent is normalized modulo **2N**, not N.
    Reducing modulo N instead loses exactly the sign, which is the difference between this
    and an ordinary circular shift.

    `normalize` already applies `(-1)^(index // N)` to every index, so shifting the
    coefficient list right by the exponent and handing it over is the whole implementation.
    A negative exponent is normalized first: `X^-1` is `X^(2N-1)`, not an error.
    """
    degree = params["degree"]
    shift = exponent % (2 * degree)
    padded = list(poly)[:degree] + [0] * (degree - len(list(poly)[:degree]))
    return normalize(params, [0] * shift + padded)


def rotate_ciphertext(params: dict, ciphertext: dict, exponent: int) -> dict:
    """Both halves rotate by the same monomial.

    `X^k * (a, b)` decrypts to `X^k * m`: the phase is `b - a*s`, and multiplying both by
    `X^k` multiplies the phase by `X^k` too. Rotating only `b` breaks that relation and the
    result decrypts to noise.
    """
    return {
        "a": monomial_rotate(params, ciphertext["a"], exponent),
        "b": monomial_rotate(params, ciphertext["b"], exponent),
    }


def conditional_rotate(params: dict, rgsw, ciphertext: dict, exponent: int) -> dict:
    """Rotate when the encrypted bit is 1, hold when it is 0.

    Both candidates are computed every time. That is not waste -- it is the mechanism. A
    version that computed only the needed one would have to know which one that was.
    """
    return cmux(params, rgsw, ciphertext, rotate_ciphertext(params, ciphertext, exponent))


# ---------------------------------------------------------------------------
# Blind rotation
# ---------------------------------------------------------------------------


def blind_rotate(params: dict, key, sample: dict, accumulator: dict) -> dict:
    """`X^(-phase) * accumulator`, without anyone learning phase.

    `body` is public, so the offset rotation by `-body` needs no CMUX. Each loop step then
    multiplies in `X^(mask[i])` exactly when `secret[i]` is 1, so the accumulated exponent
    is `-body + <mask, secret>`, which is `-phase`. The secret never appears; the key does
    the choosing while staying encrypted.
    """
    current = rotate_ciphertext(params, accumulator, -sample["body"])
    for index, mask in enumerate(sample["mask"]):
        current = conditional_rotate(params, key[index], current, mask)
    return current


def blind_rotate_trace(params: dict, key, sample: dict, accumulator: dict) -> tuple[dict, ...]:
    """One record per step, so the accumulation can be read rather than trusted.

    Step 0 is the public offset. It has no encrypted choice -- `body` is not a secret -- so
    both its candidates are the same ciphertext, and saying so is the point rather than an
    inelegance: it marks where the public part of the phase ends and the encrypted part
    begins.

    Nothing here reports a plaintext bit, and nothing could: the trace never sees the secret.
    What it does report is the digest of each candidate and of the output, and for a real
    CMUX those three are always different -- an output equal to one of its candidates is a
    branch that was taken in the clear.
    """
    from fixtures.generate import digest

    modulus = 2 * params["degree"]
    rotated = rotate_ciphertext(params, accumulator, -sample["body"])
    records = [
        {
            "step": 0,
            "mask": sample["body"],
            "exponent": (-sample["body"]) % modulus,
            "selector": "phase-offset",
            "candidate0": digest(params, rotated),
            "candidate1": digest(params, rotated),
            "output": digest(params, rotated),
        }
    ]
    current = rotated
    for index, mask in enumerate(sample["mask"]):
        candidate1 = rotate_ciphertext(params, current, mask)
        output = cmux(params, key[index], current, candidate1)
        records.append(
            {
                "step": index + 1,
                "mask": mask,
                "exponent": mask % modulus,
                "selector": f"bk[{index}]",
                "candidate0": digest(params, current),
                "candidate1": digest(params, candidate1),
                "output": digest(params, output),
            }
        )
        current = output
    return tuple(records)
