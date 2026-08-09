"""Derive every fixture from the per-deploy FLAG_SEED.

Nothing here ships a committed constant a learner could memorize. Same seed, same
fixtures (so a session is reproducible and debuggable); different seed, different
tokens, different keys, different decision log.

The numbers stay small and the token count stays low on purpose: the audit checkpoint
asks the learner to work through a log by hand, and a log of two hundred rows would
be answered by writing a script that reimplements the exercise instead of by reading.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from dataclasses import dataclass

#: The gateway's clock in every fixture. A fixed epoch keeps the arithmetic on paper:
#: a learner reading `exp: 1000600` against `now: 1000000` sees "ten minutes" without
#: converting a Unix timestamp in their head.
EPOCH = 1_000_000

#: The only algorithm this gateway has ever issued. It is a *configuration* constant,
#: never read from the token -- which is the whole point of the `verify` checkpoint.
ALGORITHM = "hs256"

#: Every action the gateway knows. `scope` claims are drawn from this set.
ACTIONS = ("read:doc", "write:doc", "delete:doc", "read:billing", "write:billing")


@dataclass(frozen=True)
class Request:
    """One line of the gateway's request log: a token presented against a resource."""

    token: str
    action: str
    resource_id: str
    resource_tenant: str
    now: int

    def as_dict(self) -> dict[str, object]:
        return {
            "token": self.token,
            "action": self.action,
            "resource": {"id": self.resource_id, "tenant": self.resource_tenant},
            "now": self.now,
        }


def _stream(seed: str, label: str) -> list[int]:
    """A deterministic byte stream for (seed, label). Not a CSPRNG; it does not need to be."""
    out: list[int] = []
    counter = 0
    while len(out) < 96:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(stream: list[int], index: int, low: int, high: int) -> int:
    """Uniform-enough choice in [low, high]. The ranges are tiny, so modulo bias is irrelevant."""
    span = high - low + 1
    return low + ((stream[index] * 256 + stream[index + 1]) % span)


def _b64(raw: bytes) -> str:
    """base64url without padding, the way the gateway writes it on the wire."""
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def keyring(seed: str) -> dict[str, str]:
    """The gateway's signing keys, by key id.

    The learner is handed these. That is not a leak -- they are auditing the gateway,
    and an auditor who cannot recompute a MAC cannot tell a forged token from a real
    one. What is *not* handed over is which log entries are forged.
    """
    s = _stream(seed, "keys")
    primary = _pick(s, 0, 100, 999)
    # Two draws from 900 values collide about once every 900 seeds. When they did, the
    # dict collapsed to a single entry and every fixture that needs a second, genuine
    # key id raised IndexError -- on those seeds the problem did not deploy at all.
    # Stepping the collision away keeps both ids in range and both keys distinct.
    rotated = _pick(s, 2, 100, 999)
    if rotated == primary:
        rotated = 100 + (rotated - 100 + 1) % 900
    return {
        f"k-{primary}": hashlib.sha256(f"{seed}:key:primary".encode()).hexdigest(),
        f"k-{rotated}": hashlib.sha256(f"{seed}:key:rotated".encode()).hexdigest(),
    }


def primary_kid(seed: str) -> str:
    """The key id the gateway currently signs with."""
    return next(iter(keyring(seed)))


def sign(header: dict[str, object], payload: dict[str, object], secret_hex: str) -> str:
    """Mint a token the correct way: HMAC-SHA256 over the two encoded segments."""
    head = _b64(json.dumps(header, separators=(",", ":"), sort_keys=True).encode())
    body = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    mac = hmac.new(bytes.fromhex(secret_hex), f"{head}.{body}".encode(), hashlib.sha256).digest()
    return f"{head}.{body}.{_b64(mac)}"


def forge_unsigned(header: dict[str, object], payload: dict[str, object]) -> str:
    """Mint a token whose third segment is a plain digest -- no key involved.

    This is what an attacker sends when the gateway dispatches on `header["alg"]`.
    The segment is not empty and not obviously wrong: it is a real SHA-256 of the
    signing input, so an implementation that "checks that a signature is present"
    and then trusts the declared algorithm accepts it.
    """
    head = _b64(json.dumps(header, separators=(",", ":"), sort_keys=True).encode())
    body = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    return f"{head}.{body}.{_b64(hashlib.sha256(f'{head}.{body}'.encode()).digest())}"


def _claims(
    subject: str,
    tenant: str,
    scope: list[str],
    not_before: int,
    expires: int,
) -> dict[str, object]:
    return {
        "sub": subject,
        "tenant": tenant,
        "scope": sorted(scope),
        "nbf": not_before,
        "exp": expires,
    }


def public_request(seed: str) -> dict[str, object]:
    """The one request the learner can see in full, with its claims spelled out.

    The `window` checkpoint is answered from this: the token is valid for
    `nbf <= now < exp`, so the last acceptable integer is `exp - 1`. Both ends are
    deliberately not round numbers, so "I guessed the boundary convention" and
    "I worked out the boundary convention" produce different answers.
    """
    s = _stream(seed, "public")
    kid = primary_kid(seed)
    secret = keyring(seed)[kid]
    tenant = f"t-{_pick(s, 0, 100, 999)}"
    not_before = EPOCH + _pick(s, 2, 11, 89)
    expires = not_before + _pick(s, 4, 211, 899)
    action = ACTIONS[_pick(s, 6, 0, len(ACTIONS) - 1)]
    payload = _claims(
        subject=f"u-{_pick(s, 8, 1000, 9999)}",
        tenant=tenant,
        scope=[action],
        not_before=not_before,
        expires=expires,
    )
    return {
        "token": sign({"alg": ALGORITHM, "kid": kid}, payload, secret),
        "claims": payload,
        "action": action,
        "resource": {"id": f"doc-{_pick(s, 10, 100, 999)}", "tenant": tenant},
        "now": not_before + 1,
    }


def validity_window(seed: str) -> list[int]:
    """The answer to the `window` checkpoint: the first and last integer `now` that pass.

    `nbf` is inclusive and `exp` is exclusive. A token is not a promise that expires
    "around" a moment; it is a half-open interval, and the two ends do not use the
    same comparison. Kept next to `public_request` so the two can never drift.
    """
    claims = public_request(seed)["claims"]
    assert isinstance(claims, dict)
    return [int(claims["nbf"]), int(claims["exp"]) - 1]


def _log_entry(
    seed: str,
    index: int,
    kind: str,
) -> tuple[Request, bool]:
    """Build one decision-log row of the given kind, and say whether it should be allowed."""
    s = _stream(seed, f"log:{index}")
    ring = keyring(seed)
    kid = primary_kid(seed)
    rotated_kid = [key for key in ring if key != kid][0]
    secret = ring[kid]

    tenant = f"t-{_pick(s, 0, 100, 999)}"
    other_tenant = f"t-{(_pick(s, 0, 100, 999) % 900) + 1000}"
    action = ACTIONS[_pick(s, 2, 0, len(ACTIONS) - 1)]
    other_action = ACTIONS[(_pick(s, 2, 0, len(ACTIONS) - 1) + 1) % len(ACTIONS)]
    not_before = EPOCH + _pick(s, 4, 10, 90)
    expires = not_before + _pick(s, 6, 200, 900)
    now = not_before + _pick(s, 8, 1, 150)
    resource_id = f"doc-{_pick(s, 10, 100, 999)}"

    payload = _claims(subject_for(s), tenant, [action], not_before, expires)
    header = {"alg": ALGORITHM, "kid": kid}

    if kind == "ok":
        token = sign(header, payload, secret)
        return Request(token, action, resource_id, tenant, now), True
    if kind == "rotated-key":
        # Signed with the *other* key in the ring. Still a real gateway key, so this
        # one is legitimate -- it is here so "unknown kid" cannot be answered by
        # "anything not signed with the primary key".
        token = sign({"alg": ALGORITHM, "kid": rotated_kid}, payload, ring[rotated_kid])
        return Request(token, action, resource_id, tenant, now), True
    if kind == "unsigned":
        token = forge_unsigned({"alg": "none", "kid": kid}, payload)
        return Request(token, action, resource_id, tenant, now), False
    if kind == "cross-tenant":
        # Correctly signed, unexpired, in scope -- and pointed at somebody else's
        # document. Nothing about the token is wrong. The request is.
        token = sign(header, payload, secret)
        return Request(token, action, resource_id, other_tenant, now), False
    if kind == "expired":
        token = sign(header, payload, secret)
        return Request(token, action, resource_id, tenant, expires), False
    if kind == "out-of-scope":
        token = sign(header, payload, secret)
        return Request(token, other_action, resource_id, tenant, now), False
    if kind == "tampered":
        # A real token with one character of the payload segment changed.
        original = sign(header, payload, secret)
        head, body, mac = original.split(".")
        flipped = "A" if body[5] != "A" else "B"
        token = f"{head}.{body[:5]}{flipped}{body[6:]}.{mac}"
        return Request(token, action, resource_id, tenant, now), False
    raise ValueError(f"unknown log entry kind: {kind}")


def subject_for(stream: list[int]) -> str:
    return f"u-{_pick(stream, 12, 1000, 9999)}"


#: How many rows of each kind the log may hold, as (kind, low, high).
#:
#: Both the counts and the order are drawn from the seed. An earlier version fixed the
#: sequence, and the audit answer came out as the same list of indices for every seed --
#: which makes the checkpoint answerable by copying somebody else's run, the one thing
#: the seed-derived design exists to prevent. Varying only the order would leave the
#: *count* of wrongly-allowed rows constant, which is most of the answer.
#:
#: The lower bounds keep every kind present: the log has to contain rows the gateway
#: allowed correctly, or "which of the allowed rows are wrong" degenerates into "list
#: every allowed row".
_LOG_SHAPE = (
    ("ok", 2, 4),
    ("rotated-key", 1, 2),
    ("cross-tenant", 1, 3),
    ("unsigned", 1, 2),
    ("expired", 1, 2),
    ("out-of-scope", 1, 2),
    ("tampered", 1, 2),
)


def _log_kinds(seed: str) -> list[str]:
    """The kinds making up this deployment's log, in this deployment's order."""
    s = _stream(seed, "log-shape")
    pool: list[str] = []
    for index, (kind, low, high) in enumerate(_LOG_SHAPE):
        pool.extend([kind] * _pick(s, index * 2, low, high))
    # Fisher-Yates with a seed-derived stream. `random` is deliberately not used: the
    # module-level generator is global state, and a fixture that depends on whatever
    # else called `random` first is not reproducible.
    order = _stream(seed, "log-order")
    for i in range(len(pool) - 1, 0, -1):
        j = _pick(order, (len(pool) - 1 - i) * 2 % (len(order) - 1), 0, i)
        pool[i], pool[j] = pool[j], pool[i]
    return pool


def _gateway_allowed(kind: str) -> bool:
    """What the deployed (broken) gateway decided.

    The gateway trusts `header["alg"]` and never compares tenants. Everything else it
    gets right, which is exactly why nobody noticed: expiry, scope and tampering are
    all refused, so the log looks like a gateway that is working.
    """
    return kind not in ("expired", "out-of-scope", "tampered")


def decision_log(seed: str) -> tuple[list[dict[str, object]], list[int]]:
    """The gateway's log, and the indices it allowed that a correct gateway would refuse.

    The second element is the answer to the `audit` checkpoint and is never put on the
    wire by `inspect_payload`.
    """
    entries: list[dict[str, object]] = []
    wrong: list[int] = []
    for index, kind in enumerate(_log_kinds(seed)):
        request, should_allow = _log_entry(seed, index, kind)
        allowed = _gateway_allowed(kind)
        row = dict(request.as_dict())
        row["gatewayDecision"] = "allow" if allowed else "deny"
        entries.append(row)
        if allowed and not should_allow:
            wrong.append(index)
    return entries, wrong


@dataclass(frozen=True)
class HiddenCase:
    """One unseen authorize call, with the decision and the reason it must produce."""

    request: Request
    allowed: bool
    reason: str


def hidden_cases(seed: str) -> list[HiddenCase]:
    """Cases the learner never sees, covering each reason and both time boundaries."""
    s = _stream(seed, "hidden")
    ring = keyring(seed)
    kid = primary_kid(seed)
    secret = ring[kid]

    tenant = f"t-{_pick(s, 0, 100, 999)}"
    action = ACTIONS[_pick(s, 2, 0, len(ACTIONS) - 1)]
    spare = ACTIONS[(_pick(s, 2, 0, len(ACTIONS) - 1) + 2) % len(ACTIONS)]
    not_before = EPOCH + _pick(s, 4, 10, 90)
    expires = not_before + _pick(s, 6, 200, 900)
    resource = f"doc-{_pick(s, 8, 100, 999)}"
    payload = _claims(subject_for(s), tenant, [action, spare], not_before, expires)
    good = sign({"alg": ALGORITHM, "kid": kid}, payload, secret)

    def at(token: str, when: int, act: str = action, res_tenant: str | None = None) -> Request:
        return Request(token, act, resource, res_tenant or tenant, when)

    cases = [
        HiddenCase(at(good, not_before), True, "ok"),
        # `exp` is exclusive: the last accepted instant is one before it. These two are
        # the pair no happy-path test contains, because a happy-path test never asks
        # about the edge.
        HiddenCase(at(good, expires - 1), True, "ok"),
        HiddenCase(at(good, expires), False, "expired"),
        HiddenCase(at(good, not_before - 1), False, "not_yet_valid"),
        HiddenCase(at(good, not_before + 5, act=_absent_action(payload)), False, "scope_missing"),
        HiddenCase(at(good, not_before + 5, res_tenant=f"{tenant}-other"), False, "tenant_mismatch"),
        HiddenCase(
            at(forge_unsigned({"alg": "none", "kid": kid}, payload), not_before + 5),
            False,
            "bad_signature",
        ),
        HiddenCase(
            at(sign({"alg": ALGORITHM, "kid": "k-000"}, payload, secret), not_before + 5),
            False,
            "unknown_key",
        ),
        HiddenCase(at(_tamper(good), not_before + 5), False, "bad_signature"),
        HiddenCase(at("not.a.token", not_before + 5), False, "malformed"),
        HiddenCase(at("only-one-segment", not_before + 5), False, "malformed"),
        HiddenCase(at(f"{good}.extra", not_before + 5), False, "malformed"),
        HiddenCase(at("", not_before + 5), False, "malformed"),
        # Three dots in the right places is not three segments. An empty signature
        # segment decodes to zero bytes without raising, so an implementation that only
        # counts the dots reaches the comparison and calls this a forged signature --
        # which reads, during an incident, as an attacker rather than a broken client.
        HiddenCase(at(_blank_segment(good, 2), not_before + 5), False, "malformed"),
        HiddenCase(at(_blank_segment(good, 0), not_before + 5), False, "malformed"),
        HiddenCase(at(_blank_segment(good, 1), not_before + 5), False, "malformed"),
    ]
    return cases


def _absent_action(payload: dict[str, object]) -> str:
    """An action the payload's scope does not carry."""
    scope = payload["scope"]
    assert isinstance(scope, list)
    for candidate in ACTIONS:
        if candidate not in scope:
            return candidate
    raise AssertionError("every action is in scope; the scope fixture is wrong")


def _blank_segment(token: str, index: int) -> str:
    """The same token with one of its three segments emptied, dots intact."""
    parts = token.split(".")
    parts[index] = ""
    return ".".join(parts)


def truncated_mac(token: str, keep_bytes: int) -> str:
    """The same token with its signature cut short.

    A comparison written as `expected[:8] == presented[:8]` accepts this: the prefix
    it looks at is genuine, and the bytes it never looks at are the ones that are
    missing. `hmac.compare_digest` on the whole value does not.
    """
    head, body, mac = token.split(".")
    raw = base64.urlsafe_b64decode((mac + "=" * (-len(mac) % 4)).encode("ascii"))
    return f"{head}.{body}.{_b64(raw[:keep_bytes])}"


def extended_mac(token: str, extra_bytes: int) -> str:
    """The same token with bytes appended to its signature."""
    head, body, mac = token.split(".")
    raw = base64.urlsafe_b64decode((mac + "=" * (-len(mac) % 4)).encode("ascii"))
    return f"{head}.{body}.{_b64(raw + bytes(extra_bytes))}"


def _tamper(token: str) -> str:
    head, body, mac = token.split(".")
    flipped = "A" if body[3] != "A" else "B"
    return f"{head}.{body[:3]}{flipped}{body[4:]}.{mac}"


def health_token(seed: str) -> str:
    """Proof that the learner actually started the container, rather than reading the README."""
    request = public_request(seed)
    claims = request["claims"]
    assert isinstance(claims, dict)
    payload = f"{claims['tenant']}:{claims['nbf']}:{claims['exp']}"
    return hashlib.sha256(f"health:{seed}:{payload}".encode()).hexdigest()[:16]
