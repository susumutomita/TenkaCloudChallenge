"""The only file you edit.

You have shares of x and shares of y, and a preprocessed triple (a, b, c) with
c = a*b, also shared out. Nobody holds any of them in the clear.

    d = x - a      e = y - b        (each party, locally)
    open d, open e                  (one round of talking)
    x*y = c + d*b + e*a + d*e       (linear again, now that d and e are public)

Three of the four steps you already know how to do. The fourth has a term in it
that is not like the others.
"""

from __future__ import annotations


def mask(value_shares: list[int], mask_shares: list[int], p: int) -> list[int]:
    """Shares of (value - mask). Each party acts on its own share."""
    return list(value_shares)


def open_value(shares: list[int], p: int) -> int:
    """The value behind a sharing, once the parties agree to reveal it.

    Only ever called on d and e, which are safe to reveal: each is a secret masked
    by a fresh preprocessed value nobody knows.
    """
    return 0


def combine(
    c_shares: list[int],
    a_shares: list[int],
    b_shares: list[int],
    d: int,
    e: int,
    p: int,
) -> list[int]:
    """Shares of x*y, from the triple's shares and the two opened values.

    x*y = c + d*b + e*a + d*e

    Look carefully at the last term before you write this.
    """
    return list(c_shares)


def rounds() -> int:
    """How many openings a single Beaver multiplication needs."""
    return 0
