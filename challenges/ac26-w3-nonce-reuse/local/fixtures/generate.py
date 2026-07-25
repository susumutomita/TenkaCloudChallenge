"""The group, the signing service, and the audit log the learner is handed.

The curve arithmetic and the signature scheme are provided here: the previous two
problems built them. What the learner writes is the attack, and then the fix.

The scenario is an audit log. It holds what such a log usually holds -- message, public
key, commitment R, response z -- and not the secret key. Somewhere in it, one signer
reused a commitment. Two accepting transcripts under the same R are two equations in two
unknowns, and the unknown you do not already have is the secret key.

Three nonce generators are shipped, and the difference between them is the whole of the
last two checkpoints:

  * `fixed_nonce`      -- the same k every time. Fails immediately.
  * `truncated_nonce`  -- a real hash, then thrown away down to a handful of bits. Looks
                          random in a log and collides by the birthday bound.
  * `deterministic_nonce` -- a hash of the secret key AND the message. Deterministic,
                          which sounds alarming, and is the one that does not collide.

Toy parameters are for observability. Nothing here is constant-time, and none of it is a
model for signing anything real.
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


def fixed_nonce(secret: int, message: bytes, group: Group) -> int:
    """The same k every time. The bug this problem exists to punish."""
    return 1 + (secret % 1)  # always 1


def truncated_nonce(seed: str, secret: int, message: bytes, group: Group) -> int:
    """A genuine hash, then thrown away down to a few bits.

    This is the interesting failure: the log looks fine. Every k is different-looking,
    every signature verifies, and nothing is obviously wrong -- but the nonce space is
    small enough that two of them collide by the birthday bound long before anyone
    worries about it. "Looks random" is not entropy.
    """
    digest = hashlib.sha256(f"{seed}:{secret}:{message!r}".encode()).digest()
    return 1 + (int.from_bytes(digest, "big") % NONCE_SPACE)


def deterministic_nonce(secret: int, message: bytes, group: Group) -> int:
    """A hash of the secret AND the message.

    Deterministic, which sounds like the opposite of what a nonce should be, and is
    nonetheless the safe one: the same message under the same key gives the same nonce
    and the same signature, and two DIFFERENT messages cannot collide without a hash
    collision. Binding the key matters too -- hashing the message alone would give two
    signers the same nonce for the same message.
    """
    digest = hashlib.sha256(
        b"nonce/v1" + secret.to_bytes(32, "big") + len(message).to_bytes(4, "big") + message
    ).digest()
    return 1 + (int.from_bytes(digest, "big") % (group.n - 1))


# Small enough that a collision turns up within a log a learner can actually read.
NONCE_SPACE = 64


def audit_log(seed: str, label: str, group: Group) -> dict:
    """A log with one reused commitment in it, plus noise.

    The noise is the point: several signers, several messages, and a few malformed
    records, so that "find the two records that matter" is a real step rather than
    "attack records 0 and 1".
    """
    s = _stream(seed, f"log:{label}")
    victim = secret_key(seed, f"{label}-victim", group)
    others = [secret_key(seed, f"{label}-other{i}", group) for i in range(3)]
    note_list = messages(seed, f"{label}-msg", 10)

    # The victim signs two different messages under one commitment. Chosen first, so the
    # honest records can be built to avoid it.
    reused = 1 + (_pick(s, 0, 1, group.n - 2))

    # The honest records get pairwise distinct nonces, chosen rather than hashed. On a
    # group this small a hash-derived nonce collides with another by birthday often
    # enough to matter, and a second, accidental reuse would make "find the reuse"
    # ambiguous -- the attack would recover *a* key, just not reliably the victim's.
    # Realism is not worth a fixture that grades differently run to run.
    available = [value for value in range(1, group.n) if value != reused]
    records = []
    for index, note in enumerate(note_list[:6]):
        signer = others[index % len(others)]
        records.append(sign_with(available[index % len(available)], signer, note, group))
    first, second = note_list[6], note_list[7]
    if first == second:
        second = second + b"!"
    records.append(sign_with(reused, victim, first, group))
    records.append(sign_with(reused, victim, second, group))

    # A record that parses perfectly, shares the reused commitment and the victim's key,
    # and does NOT verify. A detector that skips the acceptance check pairs it with a
    # real transcript and solves for a scalar that is not anybody's key. Reuse in a
    # rejected transcript proves nothing.
    forged = sign_with(reused, victim, note_list[8], group)
    forged["response"] = (forged["response"] + 1) % group.n
    records.append(forged)

    # A DIFFERENT signer who happens to have used the same commitment. Two transcripts
    # under one commitment but two keys are not two equations in one unknown -- there is
    # nothing to solve for, and an attacker who pairs them recovers a scalar belonging to
    # nobody. Sharing R is necessary and is not sufficient.
    records.append(sign_with(reused, others[0], note_list[9], group))

    # Malformed records, so a parser that trusts its input falls over.
    records.append({"message": b"broken", "public_key": (None, None), "commitment": (0, 0)})
    records.append({"message": b"broken", "commitment": (1, 1), "response": 0})

    order = [(_pick(s, 2 * i + 2, 0, 10_000), record) for i, record in enumerate(records)]
    order.sort(key=lambda pair: pair[0])
    return {
        "records": [record for _key, record in order],
        "victim_secret": victim,
        "victim_public": group.generator.scalar_mul(victim),
    }



def _encode_point(point: Point, group: Group) -> bytes:
    width = (group.p.bit_length() + 7) // 8
    if point.is_infinity:
        return b"\x00" * (2 * width)
    return point.x.to_bytes(width, "big") + point.y.to_bytes(width, "big")


def health_token(seed: str) -> str:
    group = toy_group(seed)
    return hashlib.sha256(f"health:{seed}:{group.p}:{group.n}".encode()).hexdigest()[:16]
