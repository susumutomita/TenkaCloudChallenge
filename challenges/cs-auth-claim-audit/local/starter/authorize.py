"""The only file you edit in this problem.

`authorize` decides whether one request may proceed. It is given the token the caller
presented, what the caller is trying to do, which document they are trying to do it to,
what time it is, and the gateway's signing keys.

Run `inspect` to see a real token from your own deployment, decoded, with its claims.

## The token

Three segments joined by dots:

    <header>.<payload>.<signature>

Each segment is base64url without padding. The header and payload are JSON once
decoded. The signature is HMAC-SHA256 over the exact text `"<header>.<payload>"`
-- the two segments as they appear in the token, still encoded, with the dot --
keyed by the gateway secret for the key id named in the header.

    header   {"alg": "hs256", "kid": "k-417"}
    payload  {"sub": "u-3391", "tenant": "t-208",
              "scope": ["read:doc"], "nbf": 1000042, "exp": 1000431}

`nbf` is the first instant the token is usable. `exp` is when it stops being usable.

The version below verifies the signature and returns the claims. It is not finished.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json


def decode_segment(segment: str) -> dict[str, object]:
    """Decode one base64url segment into the JSON object it holds.

    Raises on anything that is not a valid encoding of a JSON object. `authorize` has
    to turn that into a decision, not let it escape.
    """
    padded = segment + "=" * (-len(segment) % 4)
    value = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    if not isinstance(value, dict):
        raise ValueError("segment is not a JSON object")
    return value


def authorize(
    token: str,
    action: str,
    resource: dict[str, str],
    now: int,
    keys: dict[str, str],
) -> dict[str, object]:
    """Return `{"allowed": bool, "reason": str}` for one request.

    `reason` comes from this list and nothing else. The gateway's incident review reads
    these strings, so an accurate `allowed` with the wrong `reason` is still wrong.

      "ok"               allowed
      "malformed"        the token is not three base64url segments of JSON
      "unknown_key"      the header names a key id the gateway does not hold
      "bad_signature"    the signature does not match the one this gateway would make
      "not_yet_valid"    presented before the token became usable
      "expired"          presented after the token stopped being usable
      "scope_missing"    the token does not carry `action`
      "tenant_mismatch"  the resource belongs to a different tenant than the token

    When more than one applies, report them in the order listed above: a request that
    is both expired and out of scope is "expired". The order is not arbitrary -- it
    goes from "this token is not a token" outwards to "this token is fine, this request
    is not", and an incident review that reads them backwards learns the wrong thing.

    Never raise. A request the gateway cannot make sense of is a denied request.

    ## What the version below gets wrong

    It reads `alg` out of the header and does what the header says. It also never
    looks at `resource`. Both of those pass every test you have been given.
    """
    parts = token.split(".")
    if len(parts) != 3:
        return {"allowed": False, "reason": "malformed"}
    head_b64, body_b64, mac_b64 = parts

    try:
        header = decode_segment(head_b64)
        payload = decode_segment(body_b64)
    except Exception:
        return {"allowed": False, "reason": "malformed"}

    kid = header.get("kid")
    if not isinstance(kid, str) or kid not in keys:
        return {"allowed": False, "reason": "unknown_key"}

    signing_input = f"{head_b64}.{body_b64}".encode("ascii")
    if header.get("alg") == "none":
        expected = hashlib.sha256(signing_input).digest()
    else:
        expected = hmac.new(bytes.fromhex(keys[kid]), signing_input, hashlib.sha256).digest()
    padded = mac_b64 + "=" * (-len(mac_b64) % 4)
    try:
        presented = base64.urlsafe_b64decode(padded.encode("ascii"))
    except Exception:
        return {"allowed": False, "reason": "malformed"}
    if not hmac.compare_digest(expected, presented):
        return {"allowed": False, "reason": "bad_signature"}

    if now >= payload.get("exp", 0):
        return {"allowed": False, "reason": "expired"}

    scope = payload.get("scope")
    if not isinstance(scope, list) or action not in scope:
        return {"allowed": False, "reason": "scope_missing"}

    return {"allowed": True, "reason": "ok"}
