"""Seeded WebAuthn assertion fixtures for the passkey L1 lab.

The wire shape is WebAuthn's: authenticatorData is
rpIdHash || flags || signCount, and the signature covers authenticatorData ||
SHA-256(clientDataJSON).  The credential signature uses P-256 ECDSA so the
lab stays stdlib-only; production credentials may negotiate another WebAuthn
algorithm.

The fixture constructor deliberately creates exactly four cases:

* honest: every check passes;
* no-uv: the signature and all context checks pass, but UV is zero;
* bad-signature: only the signature is invalid;
* wrong-rp: its signature is valid, but only rpIdHash is wrong.

That construction is the solvability guarantee.  It does not sample random
assertions and hope that an interesting one appears.
"""

from __future__ import annotations

import base64
import hashlib
import json
import random
from dataclasses import dataclass

P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
A = P - 3
B = 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B
N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
GX = 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296
GY = 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5
G = (GX, GY)

FLAG_UP = 0x01
FLAG_UV = 0x04

ALIASES = (
    "amber",
    "cedar",
    "comet",
    "harbor",
    "indigo",
    "lilac",
    "mango",
    "orbit",
    "quartz",
    "sable",
    "tulip",
    "willow",
)

Point = tuple[int, int] | None


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _hash_int(*parts: str, modulus: int = N) -> int:
    digest = hashlib.sha256("\x00".join(parts).encode("utf-8")).digest()
    return int.from_bytes(digest, "big") % modulus


def _inverse(value: int, modulus: int) -> int:
    return pow(value % modulus, -1, modulus)


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
        slope = (3 * x1 * x1 + A) * _inverse(2 * y1, P) % P
    else:
        slope = (y2 - y1) * _inverse(x2 - x1, P) % P
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


def _sign(secret: int, message: bytes, nonce_label: str) -> dict[str, str]:
    digest = hashlib.sha256(message).digest()
    nonce = _hash_int(str(secret), nonce_label, digest.hex()) or 1
    point = _scalar_mul(nonce)
    if point is None:  # mathematically unreachable for 1 <= nonce < N
        raise AssertionError("nonce produced the point at infinity")
    r = point[0] % N
    s = (_inverse(nonce, N) * (int.from_bytes(digest, "big") + r * secret)) % N
    if r == 0 or s == 0:
        return _sign(secret, message, nonce_label + ":retry")
    return {"r": f"{r:064x}", "s": f"{s:064x}"}


def _verify(public_key: dict[str, str], message: bytes, signature: dict[str, str]) -> bool:
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
    z = int.from_bytes(hashlib.sha256(message).digest(), "big")
    w = _inverse(s, N)
    point = _point_add(_scalar_mul(z * w), _scalar_mul(r * w, public))
    return point is not None and point[0] % N == r


def signed_message(assertion: dict[str, object]) -> bytes:
    auth_data = b64url_decode(str(assertion["authenticatorData"]))
    client_data = b64url_decode(str(assertion["clientDataJSON"]))
    return auth_data + hashlib.sha256(client_data).digest()


def _authenticator_data(rp_id: str, flags: int, sign_count: int) -> bytes:
    return hashlib.sha256(rp_id.encode("utf-8")).digest() + bytes([flags]) + sign_count.to_bytes(4, "big")


def _client_data(challenge: str, origin: str) -> bytes:
    return json.dumps(
        {"type": "webauthn.get", "challenge": challenge, "origin": origin},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _make_assertion(
    alias: str,
    credential_id: str,
    secret: int,
    rp_id: str,
    flags: int,
    sign_count: int,
    client_data: bytes,
    nonce_label: str,
) -> dict[str, object]:
    auth_data = _authenticator_data(rp_id, flags, sign_count)
    assertion: dict[str, object] = {
        "id": credential_id,
        "caseId": alias,
        "authenticatorData": b64url(auth_data),
        "clientDataJSON": b64url(client_data),
    }
    assertion["signature"] = _sign(secret, signed_message(assertion), nonce_label)
    return assertion


@dataclass(frozen=True)
class Fixture:
    server_record: dict[str, object]
    assertions: tuple[dict[str, object], ...]
    aliases_by_kind: dict[str, str]

    def public_dict(self) -> dict[str, object]:
        """What the learner sees.  No credential private key is present."""
        return {
            "serverRecord": self.server_record,
            "assertions": list(self.assertions),
        }


def fixture(seed: str) -> Fixture:
    seed_tag = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:10]
    rp_id = f"login-{seed_tag}.example.test"
    origin = f"https://{rp_id}"
    challenge = b64url(hashlib.sha256(f"{seed}:challenge".encode()).digest())
    credential_id = b64url(hashlib.sha256(f"{seed}:credential".encode()).digest()[:18])

    secret = _hash_int(seed, "credential-private-key") or 1
    public_point = _scalar_mul(secret)
    if public_point is None:
        raise AssertionError("credential public key is the point at infinity")
    public_key = {"x": f"{public_point[0]:064x}", "y": f"{public_point[1]:064x}"}

    chooser = random.Random(_hash_int(seed, "aliases", modulus=2**63))
    aliases = chooser.sample(list(ALIASES), 4)
    kinds = ["honest", "no-uv", "bad-signature", "wrong-rp"]
    aliases_by_kind = dict(zip(kinds, aliases, strict=True))
    client_data = _client_data(challenge, origin)
    base_count = 1 + _hash_int(seed, "counter", modulus=10_000)

    honest = _make_assertion(
        aliases_by_kind["honest"], credential_id, secret, rp_id, FLAG_UP | FLAG_UV, base_count,
        client_data, f"{seed}:honest",
    )
    no_uv = _make_assertion(
        aliases_by_kind["no-uv"], credential_id, secret, rp_id, FLAG_UP, base_count + 1,
        client_data, f"{seed}:no-uv",
    )
    bad_signature = _make_assertion(
        aliases_by_kind["bad-signature"], credential_id, secret, rp_id, FLAG_UP | FLAG_UV,
        base_count + 2, client_data, f"{seed}:bad-signature",
    )
    signature = dict(bad_signature["signature"])
    signature["s"] = f"{(int(signature['s'], 16) % (N - 1)) + 1:064x}"
    bad_signature["signature"] = signature
    while _verify(public_key, signed_message(bad_signature), signature):
        signature["s"] = f"{(int(signature['s'], 16) % (N - 1)) + 1:064x}"

    wrong_rp = _make_assertion(
        aliases_by_kind["wrong-rp"], credential_id, secret, f"other-{rp_id}", FLAG_UP | FLAG_UV,
        base_count + 3, client_data, f"{seed}:wrong-rp",
    )

    assertions = [honest, no_uv, bad_signature, wrong_rp]
    chooser.shuffle(assertions)
    record: dict[str, object] = {
        "credentialId": credential_id,
        "publicKey": public_key,
        "rpId": rp_id,
        "expectedOrigin": origin,
        "expectedChallenge": challenge,
    }
    return Fixture(record, tuple(assertions), aliases_by_kind)


def reference_signature_valid(server_record: dict[str, object], assertion: dict[str, object]) -> bool:
    public_key = server_record.get("publicKey")
    signature = assertion.get("signature")
    return (
        isinstance(public_key, dict)
        and isinstance(signature, dict)
        and _verify(public_key, signed_message(assertion), signature)
    )
