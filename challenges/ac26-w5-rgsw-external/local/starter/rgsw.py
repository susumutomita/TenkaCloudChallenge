"""The only file you edit.

The goal: multiply an **encrypted bit** into an RLWE ciphertext, without anyone learning
which way it went. Selector 0 turns the ciphertext into an encryption of zero; selector 1
leaves the message alone; and the arithmetic is identical either way, so nothing about the
result says which happened.

You are not rebuilding the ring or RLWE — `participant.ring` supplies `ring_add`,
`ring_mul`, `rlwe_encrypt` and the rest, correct. `ac26-w5-lwe-rlwe` is where those come
from. This problem is the gadget and the product.

## The decomposition convention, fixed

```text
q = base ** levels           unsigned, LSB-first, exactly `levels` digits
gadget = (1, B, B^2, ..., B^(L-1))
recompose(decompose(x)) == x        for every x in [0, q)
```

`q = base ** levels` is what makes that exact. It is a choice, and the `failure` checkpoint
is where you find out what it was buying.

## RGSW has 2L rows, and the split is the point

`RGSW(mu) = Z + mu * G`, with `Z` being 2L RLWE encryptions of zero and `G` the gadget
matrix:

```text
rows 0 .. L-1     gadget[j]     goes in the a slot
rows L .. 2L-1    gadget[j-L]   goes in the b slot
```

The external product decomposes **both** halves of the ciphertext, concatenates them into
one digit vector of length 2L, and multiplies it into that matrix. Work out why the rows
have to be split across the two slots before you write it — the answer is what makes
`d . G` come back as `(a, b)`, and an implementation that puts every gadget term in one
slot decrypts to something that looks almost right.

## No secret, deliberately

`external_product` is not given the secret. It cannot decrypt the selector, and it must not
need to: the two branches are the same arithmetic. If you find yourself wanting to know
which bit it is, the design is telling you something.

`params` carries `base`, `levels`, `degree`, `modulus`. They all change between
checkpoints. Anything hardcoded is wrong somewhere.

Run `make inspect` first.

None of this is secure — the parameters are small enough to enumerate and the secret falls
to linear algebra. It is a toy of the mechanism.
"""

from __future__ import annotations

from participant.ring import ring_add, ring_mul  # noqa: F401 - the supplied ring


# ---------------------------------------------------------------------------
# The gadget
# ---------------------------------------------------------------------------


def gadget_vector(params: dict) -> tuple[int, ...]:
    """`(1, B, B^2, ..., B^(L-1))`.

    The order has to agree with `decompose`. Reversing both leaves the round trip working
    and every other thing in this file broken, so it is graded directly.
    """
    return ()


def decompose(params: dict, value: int) -> tuple[int, ...]:
    """Unsigned base-B digits of `value`, least significant first, exactly `levels` of them.

    A value outside `[0, q)` is reduced first, not rejected.
    """
    return ()


def recompose(params: dict, digits) -> int:
    """The value those digits stand for, back in the ring."""
    return 0


def decompose_poly(params: dict, poly) -> tuple[tuple[int, ...], ...]:
    """`levels` polynomials; level i holds digit i of every coefficient.

    Watch the shape. This is a tuple of **ring elements** — each one `degree` coefficients
    long — not a tuple of per-coefficient digit tuples. The external product multiplies a
    level by a ring element, which only typechecks one way round.
    """
    return ()


def recompose_poly(params: dict, levels) -> tuple[int, ...]:
    """The polynomial those levels stand for."""
    return ()


# ---------------------------------------------------------------------------
# When the levels run out
# ---------------------------------------------------------------------------


def levels_needed(base: int, modulus: int) -> int:
    """How many base-B digits it takes to reach every value below `modulus`.

    A float logarithm gets some of these wrong by one. Consider counting instead.
    """
    return 0


def smallest_unrepresentable(base: int, levels: int, modulus: int) -> int | None:
    """The smallest value below `modulus` that L levels cannot round-trip, or None.

    "Cannot round-trip" is the operative phrase: `decompose` does not complain, it just
    drops what will not fit. Find the first value where that starts to matter.
    """
    return None


# ---------------------------------------------------------------------------
# RGSW
# ---------------------------------------------------------------------------


def rgsw_encrypt(params: dict, secret, selector: int, material: dict) -> tuple:
    """`Z + selector * G` — return a tuple of 2L rows, each a single `(a, b)` pair.

    `material` supplies the randomness: `material["masks"][j]` and `material["noises"][j]`
    for row j. Each row is an RLWE encryption of zero — mask `a`, body `a * s + e` — plus
    its gadget term.

    The gadget term is a **scalar added to the constant coefficient**, not a shift.

    Return the rows and nothing else. Anywhere you could keep the selector is somewhere
    `external_product` could branch on it, and the whole construction exists so that it
    cannot.

    Reject a selector that is not 0 or 1.
    """
    return ()


# ---------------------------------------------------------------------------
# The external product
# ---------------------------------------------------------------------------


def external_product(params: dict, rgsw, ciphertext: dict) -> dict:
    """`d . RGSW`, where `d` is `decompose(a) ++ decompose(b)` — length 2L.

    Return `{"a": ..., "b": ...}`. No secret, and none needed.
    """
    return {}


def external_trace(params: dict, rgsw, ciphertext: dict) -> tuple[dict, ...]:
    """One record per row, so the accumulation can be read rather than trusted.

    Each record:

    ```text
    row             the row index, 0 .. 2L-1
    slot            "a" for rows below L, "b" for the rest
    level           which gadget power this row carries
    digits          the digit polynomial multiplied in
    partial_a       digits * row's a
    partial_b       digits * row's b
    accumulated_a   the running sum after this row
    accumulated_b   the running sum after this row
    ```

    The last record's accumulators are the product itself.
    """
    return ()
