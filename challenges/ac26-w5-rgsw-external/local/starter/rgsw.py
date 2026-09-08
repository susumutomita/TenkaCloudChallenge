"""
Supported computation imports / 計算用に使える標準ライブラリ:
array, base64, binascii, bisect, collections, contextlib, copy, dataclasses, decimal, enum, fractions, functools, hashlib, heapq, hmac, itertools, json, math, operator, random, re, statistics, string, struct, time, typing.
This list covers optional standard-library helpers. Imports already supplied by the starter (including __future__ and problem APIs) are also supported. Other optional imports and file/network access are not supported in grading.
この一覧は追加できる標準ライブラリです。スターターに最初からあるimport（__future__や教材のAPIなど）も、そのまま使えます。それ以外の追加importとファイル・通信操作には採点時は対応しません。
The only file you edit.

Multiply a bit (0 or 1) supplied in encrypted form into a ciphertext, the data
representing a message. This is a small arithmetic model, not practical security.
Selector 0 gives an encryption of zero and selector 1 preserves the message when
noise remains within the decoding budget. This does not prove freedom from leakage.
A polynomial is an expression such as 1+2X, represented by coefficients [1,2].
A ring is the supplied addition/multiplication rule for these coefficient arrays.
RLWE has two arrays a,b; RGSW is a row structure for multiplying an encrypted bit.
A gadget is the descending list of place weights used to reconstruct digits.

You are not rebuilding the ring or RLWE — `participant.ring` supplies `ring_add`,
`ring_mul`, `rlwe_encrypt` and the rest, correct. `ac26-w5-lwe-rlwe` is where those come
from. This problem is the gadget and the product.

## The decomposition convention, fixed

```text
q = base ** levels           unsigned, most-significant weight first, exactly `levels` digits
gadget = (B^(L-1), ..., B, 1)       descending — (q/B, q/B^2, ..., q/B^L) under q = B^L
recompose(decompose(x)) == x        for every x in [0, q)
```

With `B = 4`, `L = 3`, `q = 64`: `decompose(47) = (2, 3, 3)`, because
`47 = 2*16 + 3*4 + 3*1` — lecture slide 30's worked example, digit for digit.

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

`external_product` is not given the secret. Do not decrypt the selector in this task; the two branches are the same arithmetic. If you find yourself wanting to know
which bit it is, the design is telling you something.

`params` carries `base`, `levels`, `degree`, `modulus`. They all change between
checkpoints. Anything hardcoded is wrong somewhere.

Use Inspect evidence in Participant Portal; implement gadget_vector and then decompose/recompose first and inspect decompose-round-trips.

These tiny key candidates can be enumerated. Unknown noise prevents treating
the samples as exact linear equations. This is a toy of the mechanism.
"""

from __future__ import annotations

from participant.ring import ring_add, ring_mul  # noqa: F401 - the supplied ring


# ---------------------------------------------------------------------------
# The gadget
# ---------------------------------------------------------------------------


def gadget_vector(params: dict) -> tuple[int, ...]:
    """`(B^(L-1), ..., B, 1)` — descending, most significant weight first.

    The order has to agree with `decompose`. Reversing both leaves the round trip working
    and every other thing in this file broken, so it is graded directly.
    """
    return ()


def decompose(params: dict, value: int) -> tuple[int, ...]:
    """Unsigned base-B digits of `value`, most significant first, exactly `levels` of them.

    The order matches lecture slide 30's worked example: with `B = 4`, `L = 3`, `q = 64`,
    `decompose(47) == (2, 3, 3)` — `47 = 2*16 + 3*4 + 3*1`, largest weight first.

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
    """`d . RGSW`, where `d` is `decompose_poly(a) ++ decompose_poly(b)` — length 2L.

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
