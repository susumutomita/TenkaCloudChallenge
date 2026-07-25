"""Reference field arithmetic. Inside the image only; never mounted to the host."""

from __future__ import annotations


class Field:
    def __init__(self, modulus: int) -> None:
        self.modulus = modulus

    def normalize(self, value: int) -> int:
        return value % self.modulus

    def add(self, a: int, b: int) -> int:
        return self.normalize(a + b)

    def sub(self, a: int, b: int) -> int:
        return self.normalize(a - b)

    def mul(self, a: int, b: int) -> int:
        return self.normalize(a * b)

    def is_zero(self, value: int) -> bool:
        return self.normalize(value) == 0
