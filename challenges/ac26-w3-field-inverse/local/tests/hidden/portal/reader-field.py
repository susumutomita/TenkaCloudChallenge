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

Press "Inspect evidence" (証拠を確認) in the Portal editor to see a worked trace of the
algorithm for one a and one modulus.

Reading the classes below needs only this: `self.value` is the element's number and
`self.field.modulus` is the modulus. What you change is the `self.value = value` line
and the body of each `return`.
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
        self.value = value % field.modulus

    def __add__(self, other: "FieldElement") -> "FieldElement":
        if self.field.modulus != other.field.modulus:
            raise FieldMismatch("different moduli")
        return FieldElement(self.field, self.value + other.value)

    def __sub__(self, other: "FieldElement") -> "FieldElement":
        if self.field.modulus != other.field.modulus:
            raise FieldMismatch("different moduli")
        return FieldElement(self.field, self.value - other.value)

    def __mul__(self, other: "FieldElement") -> "FieldElement":
        if self.field.modulus != other.field.modulus:
            raise FieldMismatch("different moduli")
        return FieldElement(self.field, self.value * other.value)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, FieldElement) and other.field.modulus == self.field.modulus and other.value == self.value

    def __hash__(self) -> int:
        return hash((self.field.modulus, self.value))

    def inverse(self) -> "FieldElement":
        """The element x with self * x == 1.

        Zero has none. Neither does an element sharing a factor with a composite
        modulus. Both cases raise NotInvertible; everything else returns an element.
        """
        g, s, t = egcd(self.value, self.field.modulus)
        if g != 1:
            raise NotInvertible("no inverse")
        return FieldElement(self.field, s)

    def __truediv__(self, other: "FieldElement") -> "FieldElement":
        """Field division. Note that this is not Python's `/`.

        `a / b` multiplies by `b.inverse()`, so dividing by an element that has no
        inverse raises NotInvertible, over any modulus -- the same as inverting it.
        """
        if self.field.modulus != other.field.modulus:
            raise FieldMismatch("different moduli")
        return self * other.inverse()


class Field:
    def __init__(self, modulus: int) -> None:
        self.modulus = modulus

    def element(self, value: int) -> FieldElement:
        return FieldElement(self, value)


def egcd(a: int, b: int) -> tuple[int, int, int]:
    """(g, s, t) with a*s + b*t == g == gcd(a, b)."""
    upper, lower = (a, 1, 0), (b, 0, 1)
    while lower[0] != 0:
        q = upper[0] // lower[0]
        upper, lower = lower, tuple(u - q*l for u,l in zip(upper, lower))
    return upper


def egcd_trace(a: int, b: int) -> list[dict]:
    """One row per division step: {"q": ..., "r": ..., "s": ..., "t": ...}.

    The inverse falls out of the last row. Writing the trace first is how you find out
    which coefficient it is.
    """
    upper, lower = (a, 1, 0), (b, 0, 1)
    rows = []
    while lower[0] != 0:
        q = upper[0] // lower[0]
        rows.append(dict(q=q, r=lower[0], s=lower[1], t=lower[2]))
        upper, lower = lower, tuple(u - q*l for u,l in zip(upper, lower))
    return rows


def non_invertible_element(modulus: int) -> int:
    """The smallest non-zero element of Z_n with no inverse, or 0 if n is prime.

    For a prime modulus every non-zero element is invertible — that is what makes it a
    field. For a composite one, this is your counterexample.
    """
    for a in range(2, modulus):
        if egcd(a, modulus)[0] != 1:
            return a
    return 0
