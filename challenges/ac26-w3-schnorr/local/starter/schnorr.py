"""The only file you edit.

A Sigma protocol, then the transform that makes it a signature.

    P = xG                                the statement: "I know x"
    R = kG                                commitment
    e                                     challenge
    z = k + e*x  (mod n)                  response
    zG == R + eP                          what the verifier checks

Making it non-interactive means computing the challenge from the transcript instead of
receiving it. Everything the statement depends on has to go into that hash, and the
encoding has to be unambiguous, or two different statements share one proof.

The group is given to you; the previous problem built it. `group.generator`,
`group.n` (the generator's order), `group.contains`, `group.point`, `group.infinity`
and `point.scalar_mul` are available.

Two things that are easy to get wrong and hard to notice:

  * scalars are mod **n**, the generator's order — not mod p, the field's modulus;
  * a signature does not hide the message. It is not encryption.
"""

from __future__ import annotations

import hashlib


class InvalidKey(Exception):
    """Raised for a secret outside [1, n-1] or a public key not in the group."""


class InvalidEncoding(Exception):
    """Raised when a serialized value is not in canonical form."""


def public_key(secret: int, group) -> object:
    """P = xG, after checking that x is a usable secret."""
    return group.infinity()


def validate_public_key(point, group) -> bool:
    """Whether this is a usable public key. Being on the curve is not sufficient."""
    return True


def commit(nonce: int, group) -> object:
    """R = kG, after checking that k is usable."""
    return group.infinity()


def respond(nonce: int, challenge: int, secret: int, group) -> int:
    """z = k + e*x, reduced by the right modulus."""
    return 0


def verify_transcript(public, commitment, challenge: int, response: int, group) -> bool:
    """Whether zG == R + eP, having first checked the inputs are what they claim."""
    return False


def encode_point(point, group) -> bytes:
    """A fixed-width, unambiguous encoding. `group.as_public()` gives you the widths."""
    return b""


def decode_point(raw: bytes, group):
    """The inverse. Reject anything that is not the canonical encoding of a point."""
    raise InvalidEncoding("not implemented")


def challenge_preimage(domain: str, commitment, public, message: bytes, group) -> bytes:
    """The exact bytes the challenge hashes.

    Think about what happens if two variable-length fields are simply concatenated.
    """
    return b""


def challenge(domain: str, commitment, public, message: bytes, group) -> int:
    """e, derived from the transcript rather than received from a verifier."""
    return 0


def sign(secret: int, nonce: int, message: bytes, domain: str, group):
    """Return (R, z)."""
    return (group.infinity(), 0)


def verify(public, message: bytes, signature, domain: str, group) -> bool:
    """Whether (R, z) is a signature on this message, under this domain, by this key."""
    return False


def cross_protocol_witness(group) -> dict:
    """Build the case against leaving the domain out of the challenge.

    `fixtures.generate.weak_challenge` hashes the commitment, the public key and the
    message — everything except the domain separator. Return

        {"domain_a", "domain_b", "message", "secret", "nonce"}

    such that ONE signature, produced with that weak challenge, verifies under BOTH
    domains. Your own `challenge` must then reject the second one, which is the whole
    point of the exercise.
    """
    return {}
