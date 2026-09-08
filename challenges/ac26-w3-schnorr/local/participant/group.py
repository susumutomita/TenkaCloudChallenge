"""Public curve arithmetic supplied to the learner; no fixtures or secrets."""
from __future__ import annotations

class Point:
    __slots__ = ("params", "x", "y")

    def __init__(self, params, x, y) -> None:
        self.params = params
        self.x = x
        self.y = y

    @property
    def is_infinity(self) -> bool:
        return self.x is None

    def __eq__(self, other) -> bool:
        return (
            isinstance(other, Point)
            and other.params == self.params
            and (other.x, other.y) == (self.x, self.y)
        )

    def __hash__(self) -> int:
        return hash((self.params, self.x, self.y))

    def __repr__(self) -> str:
        return "O" if self.is_infinity else f"({self.x}, {self.y})"

    def __neg__(self):
        return self if self.is_infinity else Point(self.params, self.x, (-self.y) % self.params[0])

    def __add__(self, other):
        p, a = self.params[0], self.params[1]
        if self.is_infinity:
            return other
        if other.is_infinity:
            return self
        if self.x == other.x and (self.y + other.y) % p == 0:
            return Point(self.params, None, None)
        if self == other:
            slope = (3 * self.x * self.x + a) * pow(2 * self.y, -1, p) % p
        else:
            slope = (other.y - self.y) * pow(other.x - self.x, -1, p) % p
        x = (slope * slope - self.x - other.x) % p
        return Point(self.params, x, (slope * (self.x - x) - self.y) % p)

    def __rmul__(self, scalar: int):
        return self.scalar_mul(scalar)

    def scalar_mul(self, scalar: int):
        if scalar < 0:
            return (-self).scalar_mul(-scalar)
        result = Point(self.params, None, None)
        addend = self
        while scalar:
            if scalar & 1:
                result = result + addend
            addend = addend + addend
            scalar >>= 1
        return result


class Group:
    """A curve, its generator, and the generator's order."""

    def __init__(self, p, a, b, gx, gy, n) -> None:
        self.p, self.a, self.b, self.n = p, a, b, n
        self.params = (p, a, b)
        self.generator = Point(self.params, gx, gy)

    def contains(self, point: Point) -> bool:
        if not isinstance(point, Point) or point.params != self.params:
            return False
        if point.is_infinity:
            return True
        left = (point.y * point.y) % self.p
        right = (point.x**3 + self.a * point.x + self.b) % self.p
        return left == right

    def point(self, x, y) -> Point:
        return Point(self.params, x % self.p, y % self.p)

    def infinity(self) -> Point:
        return Point(self.params, None, None)

    def as_public(self) -> dict:
        """What a submission is handed. Never a secret."""
        return {
            "p": self.p,
            "a": self.a,
            "b": self.b,
            "n": self.n,
            "gx": self.generator.x,
            "gy": self.generator.y,
            "coordinate_bytes": (self.p.bit_length() + 7) // 8,
            "scalar_bytes": (self.n.bit_length() + 7) // 8,
        }


