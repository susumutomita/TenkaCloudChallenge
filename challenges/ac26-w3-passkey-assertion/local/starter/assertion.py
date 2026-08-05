"""Complete the relying party's passkey assertion checks.

Prerequisites: ordinary Python, bytes, dictionaries, and booleans.
Not prerequisites: public-key cryptography or WebAuthn.  The elliptic-curve
arithmetic is supplied below.  Your work is to connect the bytes the standard
says are signed, then enforce the policy bit the signature protects.
"""

from __future__ import annotations

import base64
import hashlib
import json

P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
A = P - 3
B = 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B
N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
GX = 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296
GY = 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5
G = (GX, GY)

FLAG_UP = 0x01  # user present: somebody interacted with the authenticator
FLAG_UV = 0x04  # user verified: the authenticator performed PIN/biometric verification

Point = tuple[int, int] | None


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _point_add(left: Point, right: Point) -> Point:
    if left is None:
        return right
    if right is None:
        return left
    x1, y1 = left
    x2, y2 = right
    if x1 == x2 and (y1 + y2) % P == 0:
        return None
    if left == right:
        slope = (3 * x1 * x1 + A) * pow(2 * y1, -1, P) % P
    else:
        slope = (y2 - y1) * pow(x2 - x1, -1, P) % P
    x3 = (slope * slope - x1 - x2) % P
    return x3, (slope * (x1 - x3) - y1) % P


def _scalar_mul(scalar: int, point: Point = G) -> Point:
    result: Point = None
    addend = point
    value = scalar % N
    while value:
        if value & 1:
            result = _point_add(result, addend)
        addend = _point_add(addend, addend)
        value >>= 1
    return result


def _ecdsa_verify(public_key: dict[str, str], message: bytes, signature: dict[str, str]) -> bool:
    """Supplied P-256 ECDSA verifier.  You do not need to edit it."""
    try:
        public = (int(public_key["x"], 16), int(public_key["y"], 16))
        r = int(signature["r"], 16)
        s = int(signature["s"], 16)
    except (KeyError, TypeError, ValueError):
        return False
    if not (1 <= r < N and 1 <= s < N):
        return False
    if not (0 <= public[0] < P and 0 <= public[1] < P):
        return False
    if (public[1] * public[1] - (public[0] ** 3 + A * public[0] + B)) % P != 0:
        return False
    digest = hashlib.sha256(message).digest()
    z = int.from_bytes(digest, "big")
    w = pow(s, -1, N)
    point = _point_add(_scalar_mul(z * w), _scalar_mul(r * w, public))
    return point is not None and point[0] % N == r


def signed_message(assertion: dict[str, object]) -> bytes:
    """Return the bytes protected by a WebAuthn assertion signature.

    Decode assertion["authenticatorData"] and assertion["clientDataJSON"] from
    base64url.  The result is authenticatorData followed by the SHA-256 digest
    of clientDataJSON -- not the JSON bytes themselves.
    """
    raise NotImplementedError


def verify_signature(public_key: dict[str, str], assertion: dict[str, object]) -> bool:
    """Verify one assertion with the public key stored by the server."""
    raise NotImplementedError


def user_verified(assertion: dict[str, object]) -> bool:
    """Whether the signed authenticatorData has its UV (0x04) bit set.

    authenticatorData starts with a 32-byte RP ID hash.  The next byte is the
    flags byte.  A bit is set when `flags & FLAG_UV` is non-zero.
    """
    raise NotImplementedError


def find_signed_without_user_verification(
    server_record: dict[str, object], assertions: list[dict[str, object]]
) -> str:
    """Return the one lab caseId whose signature is valid but UV is zero."""
    raise NotImplementedError


def _context_failure(server_record: dict[str, object], assertion: dict[str, object]) -> str | None:
    """Supplied WebAuthn context checks.  Return the first failed binding."""
    try:
        auth_data = _decode(str(assertion["authenticatorData"]))
        client_data_raw = _decode(str(assertion["clientDataJSON"]))
        client_data = json.loads(client_data_raw)
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return "malformed-assertion"
    if len(auth_data) < 37:
        return "malformed-assertion"
    if assertion.get("id") != server_record.get("credentialId"):
        return "credential-id-mismatch"
    expected_rp_hash = hashlib.sha256(str(server_record.get("rpId", "")).encode()).digest()
    if auth_data[:32] != expected_rp_hash:
        return "rp-id-mismatch"
    if client_data.get("type") != "webauthn.get":
        return "type-mismatch"
    if client_data.get("challenge") != server_record.get("expectedChallenge"):
        return "challenge-mismatch"
    if client_data.get("origin") != server_record.get("expectedOrigin"):
        return "origin-mismatch"
    if auth_data[32] & FLAG_UP == 0:
        return "user-presence-required"
    return None


def verify_assertion(
    server_record: dict[str, object],
    assertion: dict[str, object],
    require_user_verification: bool = True,
) -> dict[str, object]:
    """Return {"ok": bool, "reason": str} for one login assertion.

    Run the supplied context checks, enforce UV when the server requires it,
    and verify the signature with server_record["publicKey"].  Successful
    assertions return reason "ok".  Use one specific reason for each failure.
    """
    return {"ok": False, "reason": "not-implemented"}
