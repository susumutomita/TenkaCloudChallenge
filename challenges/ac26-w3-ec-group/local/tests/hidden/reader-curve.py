"""Author's participant-role answer from the stated formulas, 2026-09-07.

This is author-only evidence, not a starter or an independent human reading.
"""

class NotOnCurve(Exception):
    pass


class CurveMismatch(Exception):
    pass


class Curve:
    def __init__(self, p, a, b):
        self.p, self.a, self.b = p, a, b

    @property
    def params(self):
        return (self.p, self.a, self.b)

    def contains(self, point):
        if point.curve.params != self.params:
            return False
        if point.is_infinity:
            return True
        if point.x is None or point.y is None:
            return False
        return (point.y**2 - point.x**3 - self.a*point.x - self.b) % self.p == 0

    def point(self, x, y):
        point = Point(self, x % self.p, y % self.p)
        if not self.contains(point):
            raise NotOnCurve('coordinates do not satisfy the equation')
        return point

    def infinity(self):
        return Point(self, None, None)


class Point:
    __slots__ = ('curve', 'x', 'y')

    def __init__(self, curve, x, y):
        self.curve, self.x, self.y = curve, x, y

    @property
    def is_infinity(self):
        return self.x is None and self.y is None

    def __eq__(self, other):
        return isinstance(other, Point) and (self.curve.params, self.x, self.y) == (other.curve.params, other.x, other.y)

    def __hash__(self):
        return hash((self.curve.params, self.x, self.y))

    def __neg__(self):
        if self.is_infinity:
            return self.curve.infinity()
        return self.curve.point(self.x, (-self.y) % self.curve.p)

    def __add__(self, other):
        if self.curve.params != other.curve.params:
            raise CurveMismatch('points belong to different curves')
        if self.is_infinity:
            return other
        if other.is_infinity:
            return self
        p = self.curve.p
        if self.x == other.x and (self.y + other.y) % p == 0:
            return self.curve.infinity()
        if self == other:
            numerator, denominator = 3*self.x**2 + self.curve.a, 2*self.y
        else:
            numerator, denominator = other.y-self.y, other.x-self.x
        slope = numerator * pow(denominator % p, -1, p) % p
        x = (slope*slope - self.x - other.x) % p
        y = (slope*(self.x-x) - self.y) % p
        return self.curve.point(x, y)

    def scalar_mul(self, scalar):
        if scalar < 0:
            return (-self).scalar_mul(-scalar)
        result, addend = self.curve.infinity(), self
        while scalar:
            scalar, bit = divmod(scalar, 2)
            if bit:
                result = result + addend
            addend = addend + addend
        return result

    def __mul__(self, scalar):
        return self.scalar_mul(scalar)

    __rmul__ = __mul__


def double_and_add_trace(point, scalar):
    if scalar < 0:
        raise ValueError('trace accepts nonnegative scalars')
    def show(value):
        return 'O' if value.is_infinity else f'({value.x}, {value.y})'
    rows = []
    result, addend = point.curve.infinity(), point
    while scalar:
        scalar, bit = divmod(scalar, 2)
        row = dict(index=len(rows), bit=bit, accumulator_before=show(result),
                   addend_before=show(addend), added=bool(bit))
        if bit:
            result = result + addend
        addend = addend + addend
        row.update(accumulator_after=show(result), addend_after=show(addend),
                   on_curve=point.curve.contains(result) and point.curve.contains(addend))
        rows.append(row)
    return rows
