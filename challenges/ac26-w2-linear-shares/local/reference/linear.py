"""Reference solution. Inside the image only; never mounted to the host."""

from __future__ import annotations

# Multiplying two *shared* values is the one that needs interaction: the product of
# the sums is not the sum of the products, so parties must exchange masked values.
_ROUNDS = {
    "add-shared": 0,
    "sub-shared": 0,
    "add-constant": 0,
    "mul-constant": 0,
    "negate-shared": 0,
    "mul-shared": 1,
    "square-shared": 1,
    "compare-shared": 1,
}


def add_shares(a: list[int], b: list[int], p: int) -> list[int]:
    return [(x + y) % p for x, y in zip(a, b)]


def add_constant(shares: list[int], c: int, p: int) -> list[int]:
    # Exactly one party folds the constant in. Adding c to every share would give a
    # sharing of x + n*c, which is only x + c when n happens to be 1.
    return [(shares[0] + c) % p, *shares[1:]]


def mul_constant(shares: list[int], c: int, p: int) -> list[int]:
    return [(s * c) % p for s in shares]


def communication_rounds(operation: str) -> int:
    return _ROUNDS[operation]
