"""Reference solution. Inside the image only; never mounted to the host."""

from __future__ import annotations


class NotOnCurve(Exception):
    """Raised when a coordinate pair does not satisfy the curve equation."""


class CurveMismatch(Exception):
    """Raised when points from two different curves are combined."""


class Point:
    """An affine point, or the point at infinity.

    Infinity carries `x is None and y is None`, not `(0, 0)`. On any curve with b = 0 --
    which most of the toy curves here are -- `(0, 0)` is a perfectly ordinary point of
    order two, so using it as the identity would make the identity indistinguishable
    from a real element of the group.
    """

    __slots__ = ("curve", "x", "y")

    def __init__(self, curve: "Curve", x: int | None, y: int | None) -> None:
        self.curve = curve
        self.x = x
        self.y = y

    @property
    def is_infinity(self) -> bool:
        return self.x is None and self.y is None

    def __eq__(self, other: object) -> bool:
        return (
            isinstance(other, Point)
            and other.curve.params == self.curve.params
            and other.x == self.x
            and other.y == self.y
        )

    def __hash__(self) -> int:
        return hash((self.curve.params, self.x, self.y))

    def __repr__(self) -> str:
        return "Point(infinity)" if self.is_infinity else f"Point({self.x}, {self.y})"

    def _same_curve(self, other: "Point") -> "Point":
        if not isinstance(other, Point) or other.curve.params != self.curve.params:
            raise CurveMismatch("points come from different curves")
        return other

    def __neg__(self) -> "Point":
        if self.is_infinity:
            return self
        return Point(self.curve, self.x, (-self.y) % self.curve.p)

    def __add__(self, other: "Point") -> "Point":
        self._same_curve(other)
        if self.is_infinity:
            return Point(other.curve, other.x, other.y)
        if other.is_infinity:
            return Point(self.curve, self.x, self.y)
        p = self.curve.p
        if self.x == other.x and (self.y + other.y) % p == 0:
            # P + (-P), which includes P + P when y == 0.
            return self.curve.infinity()
        if self == other:
            # Tangent slope. The numerator is not the chord's.
            slope = (3 * self.x * self.x + self.curve.a) * pow(2 * self.y, -1, p) % p
        else:
            slope = (other.y - self.y) * pow(other.x - self.x, -1, p) % p
        x = (slope * slope - self.x - other.x) % p
        y = (slope * (self.x - x) - self.y) % p
        return Point(self.curve, x, y)

    def __mul__(self, scalar: int) -> "Point":
        return self.scalar_mul(scalar)

    def __rmul__(self, scalar: int) -> "Point":
        return self.scalar_mul(scalar)

    def scalar_mul(self, scalar: int) -> "Point":
        if scalar < 0:
            return (-self).scalar_mul(-scalar)
        result = self.curve.infinity()
        addend = Point(self.curve, self.x, self.y)
        while scalar:
            if scalar & 1:
                result = result + addend
            addend = addend + addend
            scalar >>= 1
        return result


class Curve:
    """y^2 = x^3 + a*x + b over F_p."""

    def __init__(self, p: int, a: int, b: int) -> None:
        self.p = p
        self.a = a % p
        self.b = b % p

    @property
    def params(self) -> tuple[int, int, int]:
        return (self.p, self.a, self.b)

    def contains(self, point: Point) -> bool:
        if point.is_infinity:
            return True
        left = (point.y * point.y) % self.p
        right = (point.x * point.x * point.x + self.a * point.x + self.b) % self.p
        return left == right

    def point(self, x: int, y: int) -> Point:
        candidate = Point(self, x % self.p, y % self.p)
        if not self.contains(candidate):
            raise NotOnCurve(f"({x}, {y}) does not satisfy the curve equation")
        return candidate

    def infinity(self) -> Point:
        return Point(self, None, None)


def double_and_add_trace(point: Point, scalar: int) -> list[dict]:
    """One row per bit of the scalar, least significant first.

    Recorded before the row's operations, so a reader can follow what each bit did.
    """
    rows: list[dict] = []
    result = point.curve.infinity()
    addend = Point(point.curve, point.x, point.y)
    index = 0
    remaining = scalar
    while remaining:
        bit = remaining & 1
        row = {
            "index": index,
            "bit": bit,
            "accumulator_before": _repr(result),
            "addend_before": _repr(addend),
        }
        if bit:
            result = result + addend
        addend = addend + addend
        row["added"] = bool(bit)
        row["accumulator_after"] = _repr(result)
        row["addend_after"] = _repr(addend)
        row["on_curve"] = point.curve.contains(result)
        rows.append(row)
        remaining >>= 1
        index += 1
    return rows


def _repr(point: Point) -> str:
    return "O" if point.is_infinity else f"({point.x}, {point.y})"
