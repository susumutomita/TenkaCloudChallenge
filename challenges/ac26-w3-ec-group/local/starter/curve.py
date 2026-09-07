"""編集するのはこのファイルだけ / Edit only this file.

曲線は y²=x³+a*x+b を p で割った余りで満たす座標の集まりです。
The curve contains coordinate pairs satisfying that remainder equation.
p is the divisor (modulus); `% p` gives the remainder between 0 and p-1.

O は足しても相手を変えない点。座標は両方Noneで、(0,0)とは別です。
O changes nothing when added: use (None,None), not the ordinary point (0,0).
Point addition uses the four cases and formulas in the problem statement.
Division means multiplying by an inverse: pow(d % p, -1, p), after handling d=0.

まず「証拠を確認」で自分の設定を見る → 1つ直す →「公開テストを実行」。
Inspect your settings, repair one method, then run public tests.
The starter intentionally has incorrect methods; the statement defines the API.
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
        """OだけTrue / True only when x and y are both None."""
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
        """O・逆の点・同じ点・違う点を分ける / Follow the four addition cases.
        Different curve settings raise CurveMismatch; keep input points unchanged."""
        return Point(self.curve, self.x, self.y)

    def __mul__(self, scalar: int) -> "Point":
        return self.scalar_mul(scalar)

    def __rmul__(self, scalar: int) -> "Point":
        return self.scalar_mul(scalar)

    def scalar_mul(self, scalar: int) -> "Point":
        """2で割った余りを見て足し、相手を2倍 / Double-and-add from low bits.
        k=0 gives O. For negative k, multiply -P by the positive count."""
        return self.curve.infinity()


class Curve:
    """同じ(p,a,b)なら同じ曲線 / Same (p,a,b) means the same curve."""

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
        """座標を余りに直して点を作る / Normalize; raise NotOnCurve off the curve."""
        return Point(self, x, y)

    def infinity(self) -> Point:
        """The group's identity element."""
        return Point(self, 0, 0)


def double_and_add_trace(point: Point, scalar: int) -> list[dict]:
    """0以上のscalarを記録 / Nonnegative scalar, low binary digit first.
    Zero gives no rows. Each row records the values before and after a step.

    Each row: {"index", "bit", "accumulator_before", "addend_before", "added",
               "accumulator_after", "addend_after", "on_curve"}

    Points are rendered as "O" for the identity and "(x, y)" otherwise.
    """
    return []
