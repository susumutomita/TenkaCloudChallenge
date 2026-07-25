"""The only file you edit.

An elliptic curve over F_p is a set of points plus one extra element, and the claim is
that they form a group. You will build it and check the claim.

    y^2 = x^3 + a*x + b   (mod p)

Four things this exercise will not let you skip:

  * **The point at infinity is not (0, 0).** On most of the curves here b = 0, which
    means (0, 0) satisfies the equation and is an ordinary point of order two. Use a
    representation that cannot be confused with a real point.
  * **Doubling does not use the chord's slope.** P + Q and P + P are different formulas,
    and the second is not a special case of the first — the chord's slope is 0/0 there.
  * **Some points have no tangent to speak of.** When y = 0 the tangent is vertical, and
    P + P is the identity.
  * **Field arithmetic, not integer arithmetic.** Division is multiplication by the
    modular inverse. You built that in the previous problem.

`make inspect K=13` traces double-and-add bit by bit.
"""

from __future__ import annotations


class NotOnCurve(Exception):
    """Raised when a coordinate pair does not satisfy the curve equation."""


class CurveMismatch(Exception):
    """Raised when points from two different curves are combined."""


class Point:
    __slots__ = ("curve", "x", "y")

    def __init__(self, curve: "Curve", x: int | None, y: int | None) -> None:
        self.curve = curve
        self.x = x
        self.y = y

    @property
    def is_infinity(self) -> bool:
        """True for the group's identity element and for nothing else."""
        return False

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Point) and other.x == self.x and other.y == self.y

    def __hash__(self) -> int:
        return hash((self.x, self.y))

    def __repr__(self) -> str:
        return "Point(infinity)" if self.is_infinity else f"Point({self.x}, {self.y})"

    def __neg__(self) -> "Point":
        """The point that adds with this one to give the identity."""
        return Point(self.curve, self.x, self.y)

    def __add__(self, other: "Point") -> "Point":
        """The group law. Identity, inverse, doubling and the generic case are four
        different situations, and only one of them is the textbook slope formula."""
        return Point(self.curve, self.x, self.y)

    def __mul__(self, scalar: int) -> "Point":
        return self.scalar_mul(scalar)

    def __rmul__(self, scalar: int) -> "Point":
        return self.scalar_mul(scalar)

    def scalar_mul(self, scalar: int) -> "Point":
        """k*P by double-and-add. Repeated addition works and is unusably slow; the
        point of this one is the bit decomposition. Decide what a negative k means."""
        return self.curve.infinity()


class Curve:
    """y^2 = x^3 + a*x + b over F_p."""

    def __init__(self, p: int, a: int, b: int) -> None:
        self.p = p
        self.a = a
        self.b = b

    @property
    def params(self) -> tuple[int, int, int]:
        return (self.p, self.a, self.b)

    def contains(self, point: Point) -> bool:
        """Whether the point satisfies the curve equation. The identity always does."""
        return True

    def point(self, x: int, y: int) -> Point:
        """An affine point, or NotOnCurve if the pair is not one."""
        return Point(self, x, y)

    def infinity(self) -> Point:
        """The group's identity element."""
        return Point(self, 0, 0)


def double_and_add_trace(point: Point, scalar: int) -> list[dict]:
    """One row per bit of the scalar, least significant bit first.

    Each row: {"index", "bit", "accumulator_before", "addend_before", "added",
               "accumulator_after", "addend_after", "on_curve"}

    Points are rendered as "O" for the identity and "(x, y)" otherwise.
    """
    return []
