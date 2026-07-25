"""Toy curves derived from FLAG_SEED, plus the one real curve, secp256k1.

A toy curve is chosen small enough that its whole group can be enumerated by hand, which
is what makes the exceptional cases reachable: a curve with a point of order 2 (some
`y = 0` point) lets the learner actually hit the vertical-tangent branch instead of
reading about it.

secp256k1 is here for one purpose: to show that the same abstraction, unchanged, works
over a 256-bit prime. Its parameters are the published standard ones. Nothing here is a
constant-time or side-channel-resistant implementation, and a toy curve is not a
security parameter set.
"""

from __future__ import annotations

import hashlib

# (p, a, b) triples: every one is a curve with a non-zero discriminant over F_p, and
# every one has at least one point with y = 0, so the doubling exception is reachable.
TOY_CURVES = (
    (23, 1, 0),
    (29, 4, 0),
    (31, 2, 0),
    (37, 5, 0),
    (41, 3, 0),
    (43, 6, 0),
    (47, 2, 0),
)

# secp256k1: y^2 = x^3 + 7 over F_p. Published domain parameters.
SECP256K1 = {
    "p": 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F,
    "a": 0,
    "b": 7,
    "gx": 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
    "gy": 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8,
    "n": 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141,
}


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 128:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i % 120] * 256 + s[(i + 1) % 120]) % (high - low + 1))


def curve_params(seed: str, label: str = "public") -> tuple[int, int, int]:
    return TOY_CURVES[_stream(seed, f"curve:{label}")[0] % len(TOY_CURVES)]


def points_on(p: int, a: int, b: int) -> list[tuple[int, int]]:
    """Every affine point, found by trial. The curves are small enough for that to be
    the honest thing to do, and it means the tests never assume a formula."""
    squares: dict[int, list[int]] = {}
    for y in range(p):
        squares.setdefault((y * y) % p, []).append(y)
    out: list[tuple[int, int]] = []
    for x in range(p):
        rhs = (x * x * x + a * x + b) % p
        for y in squares.get(rhs, []):
            out.append((x, y))
    return out


def order_two_points(p: int, a: int, b: int) -> list[tuple[int, int]]:
    """Points with y = 0: doubling one of these hits the vertical tangent."""
    return [point for point in points_on(p, a, b) if point[1] == 0]


def sample_points(seed: str, label: str, count: int = 6) -> list[tuple[int, int]]:
    p, a, b = curve_params(seed, label)
    every = points_on(p, a, b)
    s = _stream(seed, f"points:{label}")
    return [every[_pick(s, 2 * i, 0, len(every) - 1)] for i in range(count)]


def scalars(seed: str, label: str, count: int = 6) -> list[int]:
    s = _stream(seed, f"scalars:{label}")
    # 0 and 1 are in here on purpose: they are the two scalars an implementation is most
    # likely to get wrong, and the two a formula-only solution never tries.
    return [0, 1, 2, *[_pick(s, 2 * i, 2, 40) for i in range(count)]]


def health_token(seed: str) -> str:
    p, a, b = curve_params(seed)
    return hashlib.sha256(f"health:{seed}:{p}:{a}:{b}".encode()).hexdigest()[:16]
