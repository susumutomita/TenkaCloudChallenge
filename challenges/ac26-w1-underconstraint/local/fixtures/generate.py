"""Circuits, policy parameters and the vulnerable variant, all from FLAG_SEED.

The policy: a credential is honoured only when its revocation counter is zero and
its issuer is recognised. Expressed as constraints, "is this signal zero?" is not a
comparison — it is a pair of constraints around a claimed inverse:

    A:  revoked * inv + ok - 1 = 0      (if revoked != 0, ok must be 0)
    B:  revoked * ok         = 0        (if revoked != 0, ok must be 0 -- again)

Both are needed. Each alone is satisfiable with a lie, which is the entire lesson:
a circuit that computes the right answer for honest inputs can still accept a false
statement, because a constraint system is not a program.

The vulnerable variant drops exactly one of them. Which one is seed-dependent, so a
memorised counterexample does not carry.
"""

from __future__ import annotations

import hashlib

PRIMES = (97, 101, 103, 107, 109, 113, 127, 131, 137, 139)
# The two constraints that make up the is-zero gadget. Dropping either is a real,
# exploitable underconstraint -- with a *different* forged witness for each.
DROPPABLE = ("c-iszero-a", "c-iszero-b")


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 64:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i] * 256 + s[i + 1]) % (high - low + 1))


def params(seed: str, label: str = "public") -> dict[str, int]:
    """Policy parameters. `revoked` is the true revocation counter for this case."""
    s = _stream(seed, f"params:{label}")
    p = PRIMES[s[0] % len(PRIMES)]
    return {"p": p, "revoked": _pick(s, 2, 1, p - 1), "issuer_ok": 1}


def dropped_constraint(seed: str, label: str = "public") -> str:
    return DROPPABLE[_stream(seed, f"drop:{label}")[0] % len(DROPPABLE)]


def intended_circuit() -> list[dict[str, object]]:
    """The circuit as the policy intends it. This is the answer to checkpoint 1."""
    return [
        {"id": "c-issuer-bool", "kind": "boolean", "signal": "issuer_ok"},
        {"id": "c-ok-bool", "kind": "boolean", "signal": "ok"},
        {"id": "c-iszero-a", "kind": "iszero_a", "value": "revoked", "inv": "inv", "out": "ok"},
        {"id": "c-iszero-b", "kind": "iszero_b", "value": "revoked", "out": "ok"},
        {"id": "c-grant", "kind": "mul", "left": "ok", "right": "issuer_ok", "out": "granted"},
    ]


def vulnerable_circuit(seed: str, label: str = "public") -> list[dict[str, object]]:
    dropped = dropped_constraint(seed, label)
    return [c for c in intended_circuit() if c["id"] != dropped]


def honest_witness(prm: dict[str, int]) -> dict[str, int]:
    """What an honest holder can produce: revoked != 0, so ok = 0 and access is denied."""
    p = prm["p"]
    revoked = prm["revoked"] % p
    ok = 1 if revoked == 0 else 0
    inv = pow(revoked, -1, p) if revoked != 0 else 0
    return {
        "revoked": revoked,
        "inv": inv,
        "ok": ok,
        "issuer_ok": prm["issuer_ok"] % p,
        "granted": (ok * prm["issuer_ok"]) % p,
    }


def clean_witness(prm: dict[str, int]) -> dict[str, int]:
    """A genuinely unrevoked holder: revoked = 0, so ok = 1 and access is granted."""
    p = prm["p"]
    return {
        "revoked": 0,
        "inv": 0,
        "ok": 1,
        "issuer_ok": prm["issuer_ok"] % p,
        "granted": prm["issuer_ok"] % p,
    }


def health_token(seed: str) -> str:
    return hashlib.sha256(f"health:{seed}:{params(seed)['p']}".encode()).hexdigest()[:16]
