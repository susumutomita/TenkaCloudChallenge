"""Reference solution. Inside the image only; never mounted to the host."""

from __future__ import annotations

import hashlib


class InvalidKey(Exception):
    """Raised for a secret outside [1, n-1] or a public key not in the group."""


class InvalidEncoding(Exception):
    """Raised when a serialized value is not in canonical form."""


def public_key(secret: int, group) -> object:
    if not isinstance(secret, int) or isinstance(secret, bool) or not 1 <= secret <= group.n - 1:
        raise InvalidKey("the secret must be in [1, n-1]")
    return group.generator.scalar_mul(secret)


def validate_public_key(point, group) -> bool:
    # On the curve is not enough on its own: the identity is on the curve and is not a
    # usable public key, and a point from another curve is not this group's element.
    return group.contains(point) and not point.is_infinity


def commit(nonce: int, group) -> object:
    if not isinstance(nonce, int) or isinstance(nonce, bool) or not 1 <= nonce <= group.n - 1:
        raise InvalidKey("the nonce must be in [1, n-1]")
    return group.generator.scalar_mul(nonce)


def respond(nonce: int, challenge: int, secret: int, group) -> int:
    # Scalars live mod n, the generator's order -- not mod p, the field's modulus.
    return (nonce + challenge * secret) % group.n


def verify_transcript(public, commitment, challenge: int, response: int, group) -> bool:
    if not validate_public_key(public, group):
        return False
    if not group.contains(commitment) or commitment.is_infinity:
        return False
    if not isinstance(response, int) or not 0 <= response < group.n:
        return False
    left = group.generator.scalar_mul(response)
    right = commitment + public.scalar_mul(challenge % group.n)
    return left == right


def encode_point(point, group) -> bytes:
    width = group.as_public()["coordinate_bytes"]
    if point.is_infinity:
        return b"\x00" * (2 * width)
    return point.x.to_bytes(width, "big") + point.y.to_bytes(width, "big")


def decode_point(raw: bytes, group):
    width = group.as_public()["coordinate_bytes"]
    if len(raw) != 2 * width:
        raise InvalidEncoding("a point encoding has a fixed width")
    x = int.from_bytes(raw[:width], "big")
    y = int.from_bytes(raw[width:], "big")
    if raw == b"\x00" * (2 * width):
        return group.infinity()
    # Non-canonical: a coordinate at or above p is a different byte string for the same
    # field element, and accepting both would make the encoding ambiguous.
    if x >= group.p or y >= group.p:
        raise InvalidEncoding("a coordinate is not reduced")
    point = group.point(x, y)
    if not group.contains(point):
        raise InvalidEncoding("the encoded pair is not on the curve")
    return point


def challenge_preimage(domain: str, commitment, public, message: bytes, group) -> bytes:
    """Everything the challenge binds, in an unambiguous encoding.

    Every variable-length field is length-prefixed. Without that, ("ab", "cd") and
    ("a", "bcd") concatenate to the same bytes and therefore to the same challenge --
    two different statements with one proof between them.

    The two variable-length fields are adjacent on purpose. Separating them with the
    fixed-width point encodings would hide the ambiguity behind an accident of layout:
    the encoding would still be unsound in principle, but a collision would need the
    points to line up just so, and a reviewer could talk themselves into believing the
    length prefixes were decoration.
    """
    domain_bytes = domain.encode("utf-8")
    return b"".join(
        [
            len(domain_bytes).to_bytes(4, "big"),
            domain_bytes,
            len(message).to_bytes(4, "big"),
            message,
            encode_point(commitment, group),
            encode_point(public, group),
        ]
    )


def challenge(domain: str, commitment, public, message: bytes, group) -> int:
    digest = hashlib.sha256(challenge_preimage(domain, commitment, public, message, group))
    return int.from_bytes(digest.digest(), "big") % group.n


def sign(secret: int, nonce: int, message: bytes, domain: str, group):
    public = public_key(secret, group)
    commitment = commit(nonce, group)
    e = challenge(domain, commitment, public, message, group)
    return (commitment, respond(nonce, e, secret, group))


def verify(public, message: bytes, signature, domain: str, group) -> bool:
    commitment, response = signature
    e = challenge(domain, commitment, public, message, group)
    return verify_transcript(public, commitment, e, response, group)


def cross_protocol_witness(group) -> dict:
    """A signature that is valid under two different domains at once.

    Only possible because `weak_challenge` leaves the domain out: the same commitment,
    key and message hash to the same challenge whatever protocol claims to be running,
    so one signature satisfies both verifiers. Binding the domain is what stops it.
    """
    secret = 7 % group.n or 1
    nonce_value = 11 % group.n or 1
    return {
        "domain_a": "tenkacloud/ac26/schnorr/v1",
        "domain_b": "tenkacloud/ac26/other-protocol/v1",
        "message": b"transfer 10 to alice",
        "secret": secret,
        "nonce": nonce_value,
    }
