"""Field arithmetic. One of the three files you edit.

Every value in a circuit lives in F_p, the integers modulo a prime p. The one thing
that trips people up: a residual of -1 and a residual of p-1 are the same element,
and neither is zero.
"""

from __future__ import annotations


class Field:
    def __init__(self, modulus: int) -> None:
        self.modulus = modulus

    def normalize(self, value: int) -> int:
        """Map any integer into the canonical range [0, modulus).

        The starter forgets that Python integers can arrive negative.
        """
        return value

    def add(self, a: int, b: int) -> int:
        return self.normalize(a + b)

    def sub(self, a: int, b: int) -> int:
        return self.normalize(a - b)

    def mul(self, a: int, b: int) -> int:
        return self.normalize(a * b)

    def is_zero(self, value: int) -> bool:
        return self.normalize(value) == 0
