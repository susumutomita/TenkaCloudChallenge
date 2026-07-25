"""The only file you edit.

Some operations on additive shares need no communication at all: every party acts on
its own share and the result is a valid sharing of the right value. Which operations
those are -- and what "act on your own share" means for each -- is the point.

`add_constant` is the one worth slowing down on. Three of these four functions are
the obvious thing. One is not.
"""

from __future__ import annotations


def add_shares(a: list[int], b: list[int], p: int) -> list[int]:
    """Shares of x + y, from shares of x and shares of y."""
    return list(a)


def add_constant(shares: list[int], c: int, p: int) -> list[int]:
    """Shares of x + c, where c is public and known to everyone.

    Careful. The shares must still sum to x + c, not to something else.
    """
    return [(s + c) % p for s in shares]


def mul_constant(shares: list[int], c: int, p: int) -> list[int]:
    """Shares of x * c, where c is public."""
    return list(shares)


def communication_rounds(operation: str) -> int:
    """How many rounds of talking each operation needs.

    Operations: "add-shared", "add-constant", "mul-constant", "mul-shared".
    Return 0 when every party can act alone.
    """
    return 1
