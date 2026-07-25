"""Reference solution. Inside the image only; never mounted to the host."""

from __future__ import annotations


def mask(value_shares: list[int], mask_shares: list[int], p: int) -> list[int]:
    return [(v - m) % p for v, m in zip(value_shares, mask_shares)]


def open_value(shares: list[int], p: int) -> int:
    return sum(shares) % p


def combine(
    c_shares: list[int],
    a_shares: list[int],
    b_shares: list[int],
    d: int,
    e: int,
    p: int,
) -> list[int]:
    # c + d*b + e*a is linear in the shares: every party can do its own row.
    out = [
        (c + d * b + e * a) % p
        for c, a, b in zip(c_shares, a_shares, b_shares)
    ]
    # d*e is a PUBLIC constant. Exactly one party folds it in -- adding it to every
    # share would give a sharing of x*y + (n-1)*d*e.
    out[0] = (out[0] + d * e) % p
    return out


def rounds() -> int:
    # d and e are opened together, so one round covers both.
    return 1
