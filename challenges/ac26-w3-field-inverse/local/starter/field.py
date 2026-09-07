"""Edit field.py in the Portal. Start -> Inspect evidence -> edit -> Run public tests -> Submit.
All seven rows submit the current file; no separate JSON answer is needed.
Computational standard-library helpers available for import: collections, decimal,
fractions, functools, hashlib, hmac, itertools, json, math, operator, random,
statistics, time, typing. No extra packages, file access or network communication.

A modulus m is the divisor for remainders: -2 = 7*(-1)+5, so (-2)%7=5.
An element stores a modulus and a remainder: self.value and self.field.modulus.
Normalize every element on construction. Equal elements need the same modulus and
remainder; equal objects must have equal hashes. You may edit method/function bodies
and add branches/loops while keeping the supplied names and arguments.

An inverse x satisfies a*x % m == 1. The extended algorithm gives a*s+m*t=gcd(a,m).
If gcd is1, return an element from s; otherwise raise NotInvertible. Example:
3*(-2)+7*1=1 -> inverse of3 modulo7 is5; 4/3 becomes4*5%7=6.
Arithmetic between different moduli must raise FieldMismatch.
"""

from __future__ import annotations


class NotInvertible(Exception):
    """No integer partner makes the product leave remainder1."""


class FieldMismatch(Exception):
    """The two operands use different moduli."""


class FieldElement:
    def __init__(self, field: "Field", value: int) -> None:
        self.field = field
        # TODO: Store the remainder value % field.modulus here.
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
        """Return an element x with self.value*x.value % m ==1. If none exists, raise NotInvertible."""
        return FieldElement(self.field, 0)

    def __truediv__(self, other: "FieldElement") -> "FieldElement":
        """Return a/b as a*b.inverse(), preserving the modulus. Reject missing inverses and mixed moduli."""
        return FieldElement(self.field, 0)


class Field:
    def __init__(self, modulus: int) -> None:
        self.modulus = modulus

    def element(self, value: int) -> FieldElement:
        return FieldElement(self, value)


def egcd(a: int, b: int) -> tuple[int, int, int]:
    """Return (g,s,t), where g=gcd(a,b) and a*s+b*t=g. A list or tuple of integers is accepted.
    Start upper=(a,1,0), lower=(b,0,1). While lower_r !=0:
    q=upper_r//lower_r; new=upper-q*lower in all3 columns; upper,lower=lower,new.
    Return final upper. For3,7: (1,-2,1); for2,6: (2,1,0). Keep coefficient signs."""
    return (0, 0, 0)


def egcd_trace(a: int, b: int) -> list[dict]:
    """Return every current lower row with its quotient q BEFORE updating the two rows in egcd.
    Each row is a dict with integer q,r,s,t; the ordered rows may use a list or tuple.
    For3,7: (q,r,s,t)=(0,7,0,1),(2,3,1,0),(3,1,-2,1).
    Inputs to submitted trace tests have1<=a<b; each row satisfies a*s+b*t=r."""
    return []


def non_invertible_element(modulus: int) -> int:
    """Return the smallest nonzero a with gcd(a,modulus)>1, or0 if none exists.
    Search from2 to modulus-1. Modulus6 ->2;9 ->3;prime7 ->0.
    Zero is a no-such-nonzero-element marker, not a claimed inverse."""
    return 0
