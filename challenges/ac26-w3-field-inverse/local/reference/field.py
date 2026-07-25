"""Reference solution. Inside the image only; never mounted to the host."""

from __future__ import annotations


class NotInvertible(Exception):
    """Raised when an element has no multiplicative inverse in its ring."""


class FieldMismatch(Exception):
    """Raised when two elements of different moduli are combined."""


class FieldElement:
    def __init__(self, field: "Field", value: int) -> None:
        self.field = field
        # Python's % already returns a non-negative result for a positive modulus, so
        # this one operation covers negatives and values past the modulus alike.
        self.value = value % field.modulus

    def _same(self, other: "FieldElement") -> "FieldElement":
        if not isinstance(other, FieldElement) or other.field.modulus != self.field.modulus:
            raise FieldMismatch("elements come from different moduli")
        return other

    def __add__(self, other: "FieldElement") -> "FieldElement":
        return FieldElement(self.field, self.value + self._same(other).value)

    def __sub__(self, other: "FieldElement") -> "FieldElement":
        return FieldElement(self.field, self.value - self._same(other).value)

    def __mul__(self, other: "FieldElement") -> "FieldElement":
        return FieldElement(self.field, self.value * self._same(other).value)

    def __eq__(self, other: object) -> bool:
        return (
            isinstance(other, FieldElement)
            and other.field.modulus == self.field.modulus
            and other.value == self.value
        )

    def __hash__(self) -> int:
        return hash((self.field.modulus, self.value))

    def inverse(self) -> "FieldElement":
        if self.value == 0:
            raise NotInvertible("zero has no multiplicative inverse")
        g, s, _t = egcd(self.value, self.field.modulus)
        # gcd != 1 is the only honest answer for a composite modulus. Fermat's little
        # theorem would return a number here instead of raising.
        if g != 1:
            raise NotInvertible("element shares a factor with the modulus")
        return FieldElement(self.field, s)

    def __truediv__(self, other: "FieldElement") -> "FieldElement":
        return self * self._same(other).inverse()


class Field:
    def __init__(self, modulus: int) -> None:
        if modulus < 2:
            raise ValueError("modulus must be at least 2")
        self.modulus = modulus

    def element(self, value: int) -> FieldElement:
        return FieldElement(self, value)


def egcd(a: int, b: int) -> tuple[int, int, int]:
    """(g, s, t) with a*s + b*t == g == gcd(a, b)."""
    old_r, r = a, b
    old_s, s = 1, 0
    old_t, t = 0, 1
    while r:
        q = old_r // r
        old_r, r = r, old_r - q * r
        old_s, s = s, old_s - q * s
        old_t, t = t, old_t - q * t
    return old_r, old_s, old_t


def egcd_trace(a: int, b: int) -> list[dict]:
    """One row per division step: the quotient, the new remainder, and the coefficients.

    Written out because the inverse falls out of the last row's coefficients, and seeing
    that is the difference between running the algorithm and knowing what it does.
    """
    rows: list[dict] = []
    old_r, r = a, b
    old_s, s = 1, 0
    old_t, t = 0, 1
    while r:
        q = old_r // r
        old_r, r = r, old_r - q * r
        old_s, s = s, old_s - q * s
        old_t, t = t, old_t - q * t
        rows.append({"q": q, "r": old_r, "s": old_s, "t": old_t})
    return rows


def non_invertible_element(modulus: int) -> int:
    """The smallest non-zero element of Z_n with no inverse, or 0 if n is prime."""
    for candidate in range(2, modulus):
        g, _s, _t = egcd(candidate, modulus)
        if g != 1:
            return candidate
    return 0
