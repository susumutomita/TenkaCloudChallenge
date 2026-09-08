"""
Supported computation imports / 計算用に使える標準ライブラリ:
array, base64, binascii, bisect, collections, contextlib, copy, dataclasses, decimal, enum, fractions, functools, hashlib, heapq, hmac, itertools, json, math, operator, random, re, statistics, string, struct, time, typing.
Other imports and file/network access are not supported in grading.
採点時は、この一覧以外のimportとファイル・通信操作には対応しません。
The only file you edit.

This public encoding model studies how far a position can shift before decoding
changes. There is no secret key: anyone can decode, so this is not encryption.

The model, in full — nothing is hidden from you here:

```text
message      m   in [0, p)
scaling      D   spreads p messages across the ring
ring         q = p * D
encode       encode(m) = (m * D) mod q
noisy value  c = (encode(m) + e) mod q
decode       the message whose encoding point c is nearest to
```

`p`, `D`, and `q` come from `params`, and they change between checkpoints. Anything you
hardcode is wrong somewhere.

Three things are easy to get wrong and all three are graded:

  * **The tie.** A value exactly halfway between two encoding points rounds **up**. That
    makes the interval asymmetric for even delta. Odd delta has no integer tie
    and its interval is symmetric.

  * **Negative noise.** `e` can be negative. Python's `%` already returns a non-negative
    result for a positive modulus, so this needs no special case; taking the absolute
    value of `e` is a different function.

  * **The wrap.** The point past the last message is message 0, not message p.

Use Inspect evidence in Participant Portal first — it prints the ring, every encoding point, and where the
boundaries fall.

The boundary follows the public rounding rule, independent of any secret.
This model is not a security or noise-growth assessment for real encryption.
"""

from __future__ import annotations


def validate_params(params: dict) -> list[str]:
    """Reasons this parameter set cannot be used, empty when it can.

    Three of the rules are ranges. The fourth is the relation between p, delta and q, and
    it is the one worth thinking about: what breaks if the encoding points do not tile
    the ring evenly?
    """
    return []


def encode(params: dict, m: int) -> int:
    """The encoding point for message m, as a ring element in [0, q).

    A message outside [0, p) is normalized rather than rejected.
    """
    return 0


def centered(params: dict, x: int) -> int:
    """The representative of x in [-(q // 2), (q - 1) // 2].

    Reduce x by q, then move positions above the specified upper endpoint back by q.
    For even q the midpoint is represented as -q//2; odd q has no integer midpoint.
    """
    return 0


def add_noise(params: dict, c: int, e: int) -> int:
    """c + e as a ring element. `e` may be negative, and may exceed q."""
    return 0


def decode(params: dict, c: int) -> int:
    """The message whose encoding point c is nearest to. Ties round up."""
    return 0


def success_interval(params: dict) -> tuple[int, int]:
    """The largest consecutive safe interval containing zero, including both ends.

    Full turns can decode correctly again outside this interval.

    Compute it from the parameters. Do not measure it by trying every noise value and
    seeing what your own `decode` does — if the decoder is wrong, a measured interval
    agrees with it and both are wrong together.
    """
    return (0, 0)


def first_failure(params: dict, m: int, direction: int) -> tuple[int, int]:
    """The first noise in `direction` (+1 or -1) that decodes to something other than m % params["p"].

    Return `(noise, decoded)`. Two of the p messages have a different `decoded` from the
    rest; find out which two and why.
    """
    return (0, 0)


def counterexample(params: dict, bug: str) -> tuple[int, int] | None:
    """Return (m,e) showing the requested broken calculation differs from decode.

    Valid params have delta>=2. Require 0<=m<p and -delta<=e<=delta.
    bug is floor, no-wrap, or abs-noise. Their formulas are in the free statement.
    Return inputs, not the calculated answers; return None if no separating pair exists.
    Each bug is checked separately.
    """
    return (0, 0)
