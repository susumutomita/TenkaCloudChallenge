"""The group and the signing scheme the learner is handed, and the weak generator.

This is the *supplied* half of this problem: the curve arithmetic and the Schnorr
signature were built in the previous two problems of this week, and nothing here is
graded. What the learner writes is the attack (`starter/recover.py`) and then the fix.

Issue 537/538 (Issue 543 option B2): all of this used to live in `fixtures/generate.py`,
in the single Docker stage a learner's own `make build` produced -- next to
`audit_log`, which returns `victim_secret`, and next to `deterministic_nonce`, which is
the repair the last checkpoint asks for, with a docstring explaining why it works. Those
stayed in `fixtures/generate.py`, which now ships only in the verifier and author images
(see ../Dockerfile). This module is what the participant image carries instead, and it
carries no answer: `challenge` and `sign_with` are the protocol the log records, and
`truncated_nonce` is the generator the `collision` checkpoint asks the learner to
*measure* -- it is participant surface by design, because measuring it is the task.

Toy parameters are for observability. Nothing here is constant-time, and none of it is a
model for signing anything real.
"""

from __future__ import annotations

import hashlib

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


def _encode_point(point: Point, group: Group) -> bytes:
    width = (group.p.bit_length() + 7) // 8
    if point.is_infinity:
        return b"\x00" * (2 * width)
    return point.x.to_bytes(width, "big") + point.y.to_bytes(width, "big")


def challenge(domain: str, commitment: Point, public: Point, message: bytes, group: Group) -> int:
    """The Fiat-Shamir challenge, with everything bound. Built in the previous problem."""
    domain_bytes = domain.encode("utf-8")
    preimage = b"".join(
        [
            len(domain_bytes).to_bytes(4, "big"),
            domain_bytes,
            len(message).to_bytes(4, "big"),
            message,
            _encode_point(commitment, group),
            _encode_point(public, group),
        ]
    )
    return int.from_bytes(hashlib.sha256(preimage).digest(), "big") % group.n


def sign_with(nonce_value: int, secret: int, message: bytes, group: Group) -> dict:
    """One audit-log record. Note what it does NOT contain."""
    public = group.generator.scalar_mul(secret)
    commitment = group.generator.scalar_mul(nonce_value)
    e = challenge(DOMAINS[0], commitment, public, message, group)
    return {
        "message": message,
        "public_key": (public.x, public.y),
        "commitment": (commitment.x, commitment.y),
        "response": (nonce_value + e * secret) % group.n,
    }


# Small enough that a collision turns up within a log a learner can actually read.
NONCE_SPACE = 64


def truncated_nonce(seed: str, secret: int, message: bytes, group: Group) -> int:
    """A genuine hash, then thrown away down to a few bits.

    This is the interesting failure: the log looks fine. Every k is different-looking,
    every signature verifies, and nothing is obviously wrong -- but the nonce space is
    small enough that two of them collide by the birthday bound long before anyone
    worries about it. "Looks random" is not entropy.

    This one ships in the participant image on purpose: the `collision` checkpoint asks
    for a measurement of *this* generator, so a learner who cannot run it cannot answer.
    The two generators it is contrasted with -- the fixed one and the repaired one --
    stay in `fixtures/generate.py`, because the repaired one is the last checkpoint's
    answer.
    """
    digest = hashlib.sha256(f"{seed}:{secret}:{message!r}".encode()).digest()
    return 1 + (int.from_bytes(digest, "big") % NONCE_SPACE)
