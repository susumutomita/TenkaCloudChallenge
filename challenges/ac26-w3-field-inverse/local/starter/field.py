"""The only file you edit.

Before any curve, the field it lives in. You will build `F_p` from nothing:
normalization, addition, subtraction, multiplication, and — the one with real content —
the multiplicative inverse, from the extended Euclidean algorithm.

Two things this exercise insists on that a quick implementation skips:

  * An integer and a field element are not the same thing. `-5` and `p - 5` are the same
    element; `-5` is not a canonical representative of it.
  * `pow(a, p - 2, p)` returns an inverse when `p` is prime and returns *a number* when
    it is not. The extended Euclidean algorithm tells you which case you are in, because
    it hands you the gcd. Use it.

Run `make inspect A=<value> P=<modulus>` to see a worked trace of the algorithm.
"""

from __future__ import annotations


class NotInvertible(Exception):
    """Raised when an element has no multiplicative inverse in its ring."""


class FieldMismatch(Exception):
    """Raised when two elements of different moduli are combined."""


class FieldElement:
    def __init__(self, field: "Field", value: int) -> None:
        self.field = field
        # Not yet a canonical representative.
        self.value = value

    def __add__(self, other: "FieldElement") -> "FieldElement":
        return FieldElement(self.field, self.value + other.value)

    def __sub__(self, other: "FieldElement") -> "FieldElement":
        return FieldElement(self.field, self.value - other.value)

    def __mul__(self, other: "FieldElement") -> "FieldElement":
        return FieldElement(self.field, self.value * other.value)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, FieldElement) and other.value == self.value

    def __hash__(self) -> int:
        return hash((self.field.modulus, self.value))

    def inverse(self) -> "FieldElement":
        """The element x with self * x == 1.

        Zero has none. Neither does an element sharing a factor with a composite
        modulus. Both cases raise NotInvertible; everything else returns an element.
        """
        return FieldElement(self.field, 0)

    def __truediv__(self, other: "FieldElement") -> "FieldElement":
        """Field division. Note that this is not Python's `/`."""
        return FieldElement(self.field, 0)


class Field:
    def __init__(self, modulus: int) -> None:
        self.modulus = modulus

    def element(self, value: int) -> FieldElement:
        return FieldElement(self, value)


def egcd(a: int, b: int) -> tuple[int, int, int]:
    """(g, s, t) with a*s + b*t == g == gcd(a, b)."""
    return (0, 0, 0)


def egcd_trace(a: int, b: int) -> list[dict]:
    """One row per division step: {"q": ..., "r": ..., "s": ..., "t": ...}.

    The inverse falls out of the last row. Writing the trace first is how you find out
    which coefficient it is.
    """
    return []


def non_invertible_element(modulus: int) -> int:
    """The smallest non-zero element of Z_n with no inverse, or 0 if n is prime.

    For a prime modulus every non-zero element is invertible — that is what makes it a
    field. For a composite one, this is your counterexample.
    """
    return 0
