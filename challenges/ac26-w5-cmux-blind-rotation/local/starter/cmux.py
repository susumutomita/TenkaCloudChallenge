"""The only file you edit.

The goal: rotate an encrypted polynomial by an amount **nobody in the computation knows**.
The rotation amount lives in an LWE phase; the bits that determine it are encrypted; and
the loop that applies it never branches on any of them.

You are not rebuilding the ring, RLWE, RGSW or the external product — `fixtures.generate`
supplies all of them, correct. `ac26-w5-lwe-rlwe` and `ac26-w5-rgsw-external` are where they
come from. This problem is CMUX, monomial rotation, and the loop.

## The encoding, fixed

```text
plaintext_modulus = 4        delta = q // 4        encode(m) = m * delta
```

Four, not two. Negacyclic rotation negates a coefficient every time it wraps past degree N,
and modulo 2 a negated message is the same message — the sign flip would be invisible and an
implementation that ignored it entirely would look correct. Modulo 4 it is not invisible.

## Rotation, fixed

```text
X^(2N) = 1        so an exponent is normalized modulo 2N, not modulo N
X^N   = -1        so one wrap flips the sign, two wraps restore it
```

`X^-1` is `X^(2N-1)`. A negative exponent is normalized, not rejected.

## Blind rotation, fixed

A toy LWE sample is `(mask, body)` over `Z_(2N)`, already in the exponent's modulus:

```text
phase = (body - sum(mask[i] * secret[i])) mod 2N
```

and `blind_rotate` has to land on `X^(-phase) * accumulator` while being handed no secret at
all. `body` is **public**; only the secret bits are not, and they arrive as
`key[i] = RGSW(secret[i])`. Work out what has to be multiplied in, and when, before writing
the loop — the shape of the answer is what makes the whole construction possible.

`params` carries `base`, `levels`, `degree`, `dimension`, `modulus`, `plaintext_modulus`,
`delta`. They all change between checkpoints. Anything hardcoded is wrong somewhere.

Run `make inspect` first.

None of this is secure — the parameters are small enough to enumerate and the secret falls
to linear algebra. It is a toy of the mechanism.
"""

from __future__ import annotations

from fixtures.generate import (  # noqa: F401 - the supplied ring, RLWE and RGSW layer
    external_product,
    normalize,
    ring_add,
    ring_sub,
)


# ---------------------------------------------------------------------------
# Adding and subtracting ciphertexts
# ---------------------------------------------------------------------------


def rlwe_add(params: dict, left: dict, right: dict) -> dict:
    """Return `{"a": ..., "b": ...}` — the sum of two ciphertexts.

    Watch which halves you touch. RLWE is additively homomorphic for a reason, and the
    reason involves both of them.
    """
    return {}


def rlwe_sub(params: dict, left: dict, right: dict) -> dict:
    """`left - right`. The order is not symmetric and CMUX cares which way round it is."""
    return {}


# ---------------------------------------------------------------------------
# CMUX
# ---------------------------------------------------------------------------


def cmux(params: dict, rgsw, ct0: dict, ct1: dict) -> dict:
    """Select between two ciphertexts with an encrypted bit.

    ```text
    CMUX(c, ct0, ct1) = ct0 + ExternalProduct(c, ct1 - ct0)
    ```

    `external_product(params, rgsw, ciphertext)` is supplied and returns
    `RLWE(0) + mu * ciphertext`. Substitute that into the line above and read what comes out
    for `mu = 0` and for `mu = 1`.

    No secret, and none needed. Selector 0 must give back `ct0`'s message and selector 1
    `ct1`'s, by the **same** arithmetic — if you find yourself wanting to know which bit it
    is, the design is telling you something. The output is a new ciphertext in both cases;
    returning one of the inputs is what a plaintext branch looks like from outside.
    """
    return {}


# ---------------------------------------------------------------------------
# Rotation
# ---------------------------------------------------------------------------


def monomial_rotate(params: dict, poly, exponent: int) -> tuple[int, ...]:
    """`X^exponent * poly` in `Z_q[X]/(X^N+1)`, for any integer exponent.

    Not a circular shift. A coefficient that wraps past the degree comes back **negated**,
    and the exponent's modulus is `2N` rather than `N` for exactly that reason.

    `normalize(params, coefficients)` is supplied and already applies the negacyclic rule to
    a raw coefficient list of any length. Once the exponent is normalized there is very
    little left to do.
    """
    return ()


def rotate_ciphertext(params: dict, ciphertext: dict, exponent: int) -> dict:
    """`X^exponent * ciphertext`, still an encryption — of the rotated message.

    The phase is `b - a*s`. Think about what has to happen to both halves for the phase to
    rotate with them.
    """
    return {}


def conditional_rotate(params: dict, rgsw, ciphertext: dict, exponent: int) -> dict:
    """Rotate by `X^exponent` when the encrypted bit is 1, hold when it is 0.

    Both candidates get computed regardless. Computing only the one you need would require
    knowing which one that is.
    """
    return {}


# ---------------------------------------------------------------------------
# Blind rotation
# ---------------------------------------------------------------------------


def blind_rotate(params: dict, key, sample: dict, accumulator: dict) -> dict:
    """Land on `X^(-phase) * accumulator` without ever computing phase.

    ```text
    sample["mask"]    the LWE mask, `dimension` coefficients over Z_(2N)
    sample["body"]    public
    key[i]            RGSW(secret[i]) — the bootstrapping key
    ```

    You get no secret. `phase = body - <mask, secret>` is not computable here, and the
    result still has to be `X^(-phase) * accumulator`. Start from what is public.
    """
    return {}


def blind_rotate_trace(params: dict, key, sample: dict, accumulator: dict) -> tuple[dict, ...]:
    """One record per step, so the rotation can be read rather than trusted.

    `dimension + 1` records. Step 0 is the public offset rotation — `body` is not a secret,
    so there is no encrypted choice there and both of its candidates are the same
    ciphertext. Steps 1 onward are the real CMUXes.

    Each record:

    ```text
    step          0 for the offset, then 1 .. dimension
    mask          the coefficient this step consumed: body at step 0, mask[i-1] after
    exponent      that coefficient normalized into [0, 2N) — negated at step 0
    selector      "phase-offset" at step 0, then "bk[0]", "bk[1]", ...
    candidate0    digest of the accumulator going in
    candidate1    digest of the rotated candidate
    output        digest of this step's result
    ```

    `digest(params, ciphertext)` is supplied by `fixtures.generate`, so the format is not
    yours to guess. Note what a digest can show: for a real CMUX the output matches neither
    candidate. No plaintext bit appears anywhere, and none can — the trace never sees the
    secret.

    The last record's `output` is the digest of `blind_rotate`'s result.
    """
    return ()
