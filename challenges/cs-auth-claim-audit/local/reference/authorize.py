"""Reference solution. Never shipped in the participant image; see local/Dockerfile.

Two things separate this from the starter, and neither is visible from a passing
happy-path test.

1. **The algorithm is configuration, not input.** `header["alg"]` is read from the
   token, which is the thing being authenticated. Dispatching on it lets the caller
   choose how their own token gets checked. There is one algorithm; it is compiled in.

2. **A valid token is not an allowed request.** Everything up to the signature check
   answers "did this gateway issue this?". Nothing there answers "may this subject do
   this to *this* document?". The tenant on the resource has to be compared with the
   tenant in the claims, and a gateway that never looks at `resource` cannot do it.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json

#: The one algorithm this gateway issues. Compiled in, deliberately: see the module
#: docstring. A token that declares something else is not asking for a different
#: check, it is asking to skip this one.
ALGORITHM = "hs256"


def decode_segment(segment: str) -> dict[str, object]:
    """Decode one base64url segment into the JSON object it holds."""
    padded = segment + "=" * (-len(segment) % 4)
    value = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    if not isinstance(value, dict):
        raise ValueError("segment is not a JSON object")
    return value


def _decode_mac(segment: str) -> bytes:
    padded = segment + "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def _deny(reason: str) -> dict[str, object]:
    return {"allowed": False, "reason": reason}


def authorize(
    token: str,
    action: str,
    resource: dict[str, str],
    now: int,
    keys: dict[str, str],
) -> dict[str, object]:
    """Decide one request. See the starter docstring for the reason vocabulary."""
    if not isinstance(token, str):
        return _deny("malformed")
    parts = token.split(".")
    if len(parts) != 3 or not all(parts):
        return _deny("malformed")
    head_b64, body_b64, mac_b64 = parts

    try:
        header = decode_segment(head_b64)
        payload = decode_segment(body_b64)
        presented = _decode_mac(mac_b64)
    except (ValueError, binascii.Error, UnicodeDecodeError, json.JSONDecodeError):
        return _deny("malformed")

    kid = header.get("kid")
    if not isinstance(kid, str) or kid not in keys:
        return _deny("unknown_key")

    # `header["alg"]` is never consulted. It is recorded on the wire so a future
    # rotation can be staged, not so that this branch can be chosen by the caller.
    signing_input = f"{head_b64}.{body_b64}".encode("ascii")
    try:
        secret = bytes.fromhex(keys[kid])
    except ValueError:
        return _deny("unknown_key")
    expected = hmac.new(secret, signing_input, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, presented):
        return _deny("bad_signature")

    # From here the token is genuine. Everything that follows is about the request.
    not_before = payload.get("nbf")
    expires = payload.get("exp")
    if not isinstance(not_before, int) or not isinstance(expires, int):
        return _deny("malformed")
    if now < not_before:
        return _deny("not_yet_valid")
    # Half-open: `nbf` is the first accepted instant, `exp` the first rejected one.
    if now >= expires:
        return _deny("expired")

    scope = payload.get("scope")
    if not isinstance(scope, list) or action not in scope:
        return _deny("scope_missing")

    tenant = payload.get("tenant")
    if not isinstance(tenant, str) or not isinstance(resource, dict):
        return _deny("malformed")
    if resource.get("tenant") != tenant:
        return _deny("tenant_mismatch")

    return {"allowed": True, "reason": "ok"}
