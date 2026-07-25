"""The group, the keys, the messages, and the deliberately weak challenge.

The curve arithmetic is provided here rather than reimplemented by the learner: the
previous problem built it, and this one is about the protocol on top. What the learner
writes is the Sigma protocol, the serialization, and the Fiat-Shamir transform.

Two group choices:

  * a toy prime-order curve, small enough that a signature can be verified by hand;
  * secp256k1, so the same protocol code runs on a real parameter set unchanged.

`weak_challenge` is the point of the counterexample checkpoint. It hashes everything a
naive implementation hashes -- the commitment, the public key, the message -- and leaves
out the domain separator. It is defined here, not by the learner, so that "my attack
works against my own weakened code" cannot be the answer.

Toy parameters are for observability. Nothing here is constant-time, the nonces are
seeded rather than random, and none of it is a model for signing anything real.
"""

from __future__ import annotations

import hashlib

# (p, a, b, gx, gy, n): toy curves whose generator has the stated PRIME order, so every
# non-zero scalar mod n is usable and z = k + e*x mod n behaves like the real thing.
# Every entry is verified, not assumed: the discriminant is non-zero, the group order is
# prime, and the listed generator has exactly that order. A generator whose order is
# smaller than claimed would make z = k + e*x mod n silently wrong for some scalars, so
# a test recomputes all three properties from scratch.
TOY_GROUPS = (
    (23, 1, 4, 0, 2, 29),
    (23, 5, 1, 0, 1, 31),
    (29, 5, 7, 0, 6, 37),
    (31, 0, 3, 1, 2, 43),
    (31, 1, 3, 1, 6, 41),
)

SECP256K1 = (
    0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F,
    0,
    7,
    0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
    0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8,
    0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141,
)

DOMAINS = ("tenkacloud/ac26/schnorr/v1", "tenkacloud/ac26/other-protocol/v1")


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


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 128:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i % 120] * 256 + s[(i + 1) % 120]) % (high - low + 1))


def toy_group(seed: str, label: str = "public") -> Group:
    return Group(*TOY_GROUPS[_stream(seed, f"group:{label}")[0] % len(TOY_GROUPS)])


def secp_group() -> Group:
    return Group(*SECP256K1)


def secret_key(seed: str, label: str, group: Group) -> int:
    return _pick(_stream(seed, f"secret:{label}"), 0, 1, min(group.n - 1, 1 << 30))


def nonce(seed: str, label: str, group: Group) -> int:
    return _pick(_stream(seed, f"nonce:{label}"), 0, 1, min(group.n - 1, 1 << 30))


def messages(seed: str, label: str, count: int = 4) -> list[bytes]:
    s = _stream(seed, f"messages:{label}")
    return [bytes(s[4 * i : 4 * i + 1 + (s[i] % 20)]) for i in range(count)]


def weak_challenge(commitment: Point, public_key: Point, message: bytes, group: Group) -> int:
    """What a naive Fiat-Shamir looks like: everything except the domain separator.

    Defined here rather than by the submission, so that the cross-protocol counterexample
    has to work against a fixed weakness rather than against the learner's own code.
    """
    digest = hashlib.sha256(
        _encode_point(commitment, group) + _encode_point(public_key, group) + message
    ).digest()
    return int.from_bytes(digest, "big") % group.n


def _encode_point(point: Point, group: Group) -> bytes:
    width = (group.p.bit_length() + 7) // 8
    if point.is_infinity:
        return b"\x00" * (2 * width)
    return point.x.to_bytes(width, "big") + point.y.to_bytes(width, "big")


def health_token(seed: str) -> str:
    group = toy_group(seed)
    return hashlib.sha256(f"health:{seed}:{group.p}:{group.n}".encode()).hexdigest()[:16]
