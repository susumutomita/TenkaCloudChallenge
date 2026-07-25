"""Hidden tests. Run by /verify against a copy of the learner's curve.py.

The curves are small enough to enumerate completely, so the tests do not sample: every
point is checked for membership, every pair is added, and the group axioms are verified
over the whole group. A formula that works for the generic case and quietly breaks on
the identity, on P + (-P), or on a point with y = 0 has nowhere to hide.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    SECP256K1,
    TOY_CURVES,
    curve_params,
    order_two_points,
    points_on,
    sample_points,
    scalars,
)

LABELS = ("h0", "h1", "h2")


def _setup(module, seed: str, label: str):
    p, a, b = curve_params(seed, label)
    return module.Curve(p, a, b), points_on(p, a, b), (p, a, b)


def _valid_point(module, curve, point, p: int) -> bool:
    if not isinstance(point, module.Point):
        return False
    if point.is_infinity:
        return point.x is None and point.y is None
    return isinstance(point.x, int) and isinstance(point.y, int) and 0 <= point.x < p


def check_on_curve(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        curve, every, (p, a, b) = _setup(module, seed, label)
        on_curve = set(every)
        for x in range(p):
            for y in range(p):
                try:
                    accepted = curve.contains(module.Point(curve, x, y))
                except Exception as error:  # noqa: BLE001
                    return [f"contains raised {type(error).__name__}"]
                if accepted != ((x, y) in on_curve):
                    failures.append("a coordinate pair was classified on the wrong side of the curve")
                    return failures
        # Building an off-curve point must fail rather than produce something unusable.
        off = next((x, y) for x in range(p) for y in range(p) if (x, y) not in on_curve)
        try:
            curve.point(*off)
            failures.append("a pair that is not on the curve was accepted as a point")
        except module.NotOnCurve:
            pass
        except Exception as error:  # noqa: BLE001
            failures.append(f"rejecting an off-curve pair raised {type(error).__name__}")
        if not curve.contains(curve.infinity()):
            failures.append("the identity was reported as not being on the curve")
    return failures


def check_identity(module, seed: str) -> list[str]:
    """Including the trap: on a curve with b = 0, (0, 0) is a real point of order two."""
    failures: list[str] = []
    for label in LABELS:
        curve, every, (p, a, b) = _setup(module, seed, label)
        identity = curve.infinity()
        if not identity.is_infinity:
            failures.append("the identity does not report itself as the identity")
            continue
        if (0, 0) in every:
            zero = curve.point(0, 0)
            if zero.is_infinity:
                failures.append("(0, 0) is a point on this curve, but was treated as the identity")
                continue
            if zero == identity:
                failures.append("(0, 0) compares equal to the identity")
                continue
        for coords in every:
            point = curve.point(*coords)
            if not _valid_point(module, curve, identity + point, p):
                failures.append("adding the identity did not produce a valid point")
                break
            if (identity + point) != point or (point + identity) != point:
                failures.append("the identity does not act as an identity")
                break
            negated = -point
            if not curve.contains(negated):
                failures.append("the inverse of a point is not on the curve")
                break
            if not (point + negated).is_infinity:
                failures.append("a point plus its inverse is not the identity")
                break
        if not (identity + identity).is_infinity:
            failures.append("the identity plus itself is not the identity")
        if not (-identity).is_infinity:
            failures.append("the inverse of the identity is not the identity")
    return failures


def check_add(module, seed: str) -> list[str]:
    """Every ordered pair of distinct points on the curve."""
    failures: list[str] = []
    for label in LABELS:
        curve, every, (p, a, b) = _setup(module, seed, label)
        reference = _ReferenceCurve(p, a, b)
        for left in every:
            for right in every:
                if left == right:
                    continue
                try:
                    got = curve.point(*left) + curve.point(*right)
                except Exception as error:  # noqa: BLE001
                    return [f"adding two points raised {type(error).__name__}"]
                if not _valid_point(module, curve, got, p):
                    failures.append("an addition produced something that is not a point")
                    return failures
                want = reference.add(left, right)
                if _coords(got) != want:
                    failures.append("adding two distinct points gives the wrong result")
                    return failures
                if not curve.contains(got):
                    failures.append("the sum of two points is not on the curve")
                    return failures
    return failures


def check_double(module, seed: str) -> list[str]:
    """Doubling every point, which includes the vertical-tangent points where y = 0."""
    failures: list[str] = []
    for label in LABELS:
        curve, every, (p, a, b) = _setup(module, seed, label)
        reference = _ReferenceCurve(p, a, b)
        exceptional = set(order_two_points(p, a, b))
        if not exceptional:
            failures.append("fixture is degenerate: this curve has no vertical-tangent point")
            continue
        for coords in every:
            point = curve.point(*coords)
            try:
                got = point + point
            except Exception as error:  # noqa: BLE001
                return [f"doubling a point raised {type(error).__name__}"]
            if not _valid_point(module, curve, got, p):
                failures.append("doubling produced something that is not a point")
                return failures
            want = reference.add(coords, coords)
            if _coords(got) != want:
                if coords in exceptional:
                    failures.append("doubling a point whose tangent is vertical is wrong")
                else:
                    failures.append("doubling a point gives the wrong result")
                return failures
            # The input must not have been mutated on the way.
            if (point.x, point.y) != coords:
                failures.append("doubling modified the point it was given")
                return failures
    return failures


def check_scalar(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        curve, every, (p, a, b) = _setup(module, seed, label)
        reference = _ReferenceCurve(p, a, b)
        for coords in sample_points(seed, label):
            point = curve.point(*coords)
            for k in scalars(seed, label):
                try:
                    got = point.scalar_mul(k)
                except Exception as error:  # noqa: BLE001
                    return [f"scalar multiplication raised {type(error).__name__}"]
                if not _valid_point(module, curve, got, p):
                    failures.append("scalar multiplication produced something that is not a point")
                    return failures
                if _coords(got) != reference.mul(coords, k):
                    if k == 0:
                        failures.append("multiplying by zero does not give the identity")
                    elif k == 1:
                        failures.append("multiplying by one does not give the point back")
                    else:
                        failures.append("scalar multiplication gives the wrong point")
                    return failures
            # A negative scalar has to mean something, and there is only one sane choice.
            if _coords(point.scalar_mul(-3)) != reference.mul(coords, -3):
                failures.append("a negative scalar does not give the inverse of the positive one")
                return failures
    return failures


def check_trace(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        curve, _every, (p, a, b) = _setup(module, seed, label)
        reference = _ReferenceCurve(p, a, b)
        for coords in sample_points(seed, label)[:3]:
            point = curve.point(*coords)
            for k in (5, 13, 27):
                try:
                    rows = module.double_and_add_trace(point, k)
                except Exception as error:  # noqa: BLE001
                    return [f"the trace raised {type(error).__name__}"]
                if not isinstance(rows, list) or len(rows) != k.bit_length():
                    failures.append("the trace does not have one row per bit of the scalar")
                    return failures
                for index, row in enumerate(rows):
                    if not isinstance(row, dict):
                        failures.append("a trace row is not a row")
                        return failures
                    if row.get("bit") != ((k >> index) & 1):
                        failures.append("a trace row's bit does not match the scalar")
                        return failures
                    if bool(row.get("added")) != bool((k >> index) & 1):
                        failures.append("a trace row adds when its bit says otherwise")
                        return failures
                    # The accumulator after step i must be the low i+1 bits times P.
                    partial = k & ((1 << (index + 1)) - 1)
                    if row.get("accumulator_after") != _render(reference.mul(coords, partial)):
                        failures.append("the accumulator does not match the bits consumed so far")
                        return failures
                    if row.get("addend_after") != _render(reference.mul(coords, 1 << (index + 1))):
                        failures.append("the addend is not being doubled each step")
                        return failures
                    if row.get("on_curve") is not True:
                        failures.append("a trace row reports its accumulator off the curve")
                        return failures
    return failures


def check_properties(module, seed: str) -> list[str]:
    """The group axioms and the homomorphism, over the whole of a curve not yet seen."""
    failures: list[str] = []
    curve, every, (p, a, b) = _setup(module, seed, "properties")
    points = [curve.point(*coords) for coords in every] + [curve.infinity()]
    for left in points:
        for right in points:
            total = left + right
            if not curve.contains(total):
                failures.append("closure fails: a sum left the curve")
                return failures
            if total != (right + left):
                failures.append("addition is not commutative")
                return failures
    for left in points[:6]:
        for middle in points[:6]:
            for right in points[:6]:
                if ((left + middle) + right) != (left + (middle + right)):
                    failures.append("addition is not associative")
                    return failures
    base = points[0] if not points[0].is_infinity else points[1]
    for k in range(4):
        for m in range(4):
            if base.scalar_mul(k + m) != (base.scalar_mul(k) + base.scalar_mul(m)):
                failures.append("(k + m)P is not kP + mP")
                return failures
            if base.scalar_mul(k * m) != base.scalar_mul(k).scalar_mul(m):
                failures.append("(k*m)P is not k(mP)")
                return failures
    # Picked so it is always a different curve. Deriving it from the seed instead would
    # sometimes land on the same one, and the check would silently skip itself -- which
    # is how a "curves may be mixed" mutation survived this suite once.
    other_params = next(other for other in TOY_CURVES if other != (p, a, b))
    other_curve = module.Curve(*other_params)
    try:
        base + other_curve.infinity()
        failures.append("points from two different curves were added without complaint")
    except module.CurveMismatch:
        pass
    except Exception as error:  # noqa: BLE001
        failures.append(f"mixing curves raised {type(error).__name__}, not CurveMismatch")
    return failures


def check_secp256k1(module, _seed: str) -> list[str]:
    """The same abstraction, unchanged, over a 256-bit prime.

    The relations checked here are true by definition of the published parameters rather
    than by comparison with a value copied from somewhere: G is on the curve, n*G is the
    identity because n is the group's order, and (n-1)*G is -G because it follows.
    """
    failures: list[str] = []
    params = SECP256K1
    curve = module.Curve(params["p"], params["a"], params["b"])
    try:
        g = curve.point(params["gx"], params["gy"])
    except Exception as error:  # noqa: BLE001
        return [f"building the standard generator raised {type(error).__name__}"]
    if not curve.contains(g):
        return ["the standard generator was not accepted as being on the curve"]
    n = params["n"]
    if not g.scalar_mul(n).is_infinity:
        failures.append("multiplying the generator by the group order is not the identity")
    if g.scalar_mul(n - 1) != -g:
        failures.append("(n-1)G is not -G")
    if g.scalar_mul(n + 1) != g:
        failures.append("(n+1)G is not G")
    doubled = g + g
    if doubled != g.scalar_mul(2) or not curve.contains(doubled):
        failures.append("doubling the generator disagrees with multiplying it by two")
    if g.scalar_mul(7) + g.scalar_mul(11) != g.scalar_mul(18):
        failures.append("the homomorphism fails on the real curve")
    return failures


class _ReferenceCurve:
    """Ground truth, kept out of the graded module so a submission cannot satisfy the
    tests by being consistent with itself."""

    def __init__(self, p: int, a: int, b: int) -> None:
        self.p, self.a, self.b = p, a % p, b % p

    def add(self, left, right):
        p = self.p
        if left is None:
            return right
        if right is None:
            return left
        if left[0] == right[0] and (left[1] + right[1]) % p == 0:
            return None
        if left == right:
            slope = (3 * left[0] * left[0] + self.a) * pow(2 * left[1], -1, p) % p
        else:
            slope = (right[1] - left[1]) * pow(right[0] - left[0], -1, p) % p
        x = (slope * slope - left[0] - right[0]) % p
        return (x, (slope * (left[0] - x) - left[1]) % p)

    def neg(self, point):
        return None if point is None else (point[0], (-point[1]) % self.p)

    def mul(self, point, scalar: int):
        if scalar < 0:
            return self.mul(self.neg(point), -scalar)
        result = None
        addend = point
        while scalar:
            if scalar & 1:
                result = self.add(result, addend)
            addend = self.add(addend, addend)
            scalar >>= 1
        return result


def _coords(point):
    return None if point.is_infinity else (point.x, point.y)


def _render(coords) -> str:
    return "O" if coords is None else f"({coords[0]}, {coords[1]})"


def run(module, seed: str) -> list[str]:
    return [
        *check_on_curve(module, seed),
        *check_identity(module, seed),
        *check_add(module, seed),
        *check_double(module, seed),
        *check_scalar(module, seed),
        *check_trace(module, seed),
        *check_properties(module, seed),
        *check_secp256k1(module, seed),
    ]
