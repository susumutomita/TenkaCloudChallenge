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

This module does not ship in the participant Docker stage (Issue 543 option B2).
#533 stopped it exporting the complete circuit, the missing id, a forgery or the
root-cause diagnosis as their own callable values, and that is still true -- but
`_ISZERO_HALVES` below is both halves of the gadget as dicts, under the exact ids
the checkpoints require, so `intended_circuit()` was a copy out of this file and
`audit` and `repair` fell out of it as a set difference. Measured on the shipped
image: transcription alone scored 3 of 6 checkpoints, and transcription plus a scan
over the supplied evaluator scored 5 of 6 -- every checkpoint a code submission can
reach. The participant image now reads this deployment's public half from the
verifier's `GET /public` (see `public_payload` at the end of this file,
participant/evidence.py and ../Dockerfile).

`vulnerable_circuit` still makes the same seed-derived choice internally to build
the deployed circuit; it just never returns that choice, or the circuit it was
chosen from, as a separate, directly reusable value. See
scripts/ac26-w1-underconstraint.test.ts for the regression tests pinning both.
"""

from __future__ import annotations

import hashlib

PRIMES = (97, 101, 103, 107, 109, 113, 127, 131, 137, 139)
# The two constraints that make up the is-zero gadget. Naming the two candidates
# is not an answer -- which one is actually missing for a given seed is (that is
# the audit checkpoint), and nothing here returns that choice on its own.
DROPPABLE = ("c-iszero-a", "c-iszero-b")

_ISZERO_HALVES: dict[str, dict[str, object]] = {
    "c-iszero-a": {"id": "c-iszero-a", "kind": "iszero_a", "value": "revoked", "inv": "inv", "out": "ok"},
    "c-iszero-b": {"id": "c-iszero-b", "kind": "iszero_b", "value": "revoked", "out": "ok"},
}


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


def vulnerable_circuit(seed: str, label: str = "public") -> list[dict[str, object]]:
    """The circuit actually deployed for this case.

    The full policy circuit with one of the two is-zero constraints missing.
    Which one is seed-dependent -- finding out which is the audit checkpoint, so
    this only ever returns the *result* of that choice (the four remaining
    constraints), never the choice, or the complete circuit it was chosen from,
    as a separate value someone could import instead of deriving it.
    """
    drop_index = _stream(seed, f"drop:{label}")[0] % len(DROPPABLE)
    kept = [cid for index, cid in enumerate(DROPPABLE) if index != drop_index]
    return [
        {"id": "c-issuer-bool", "kind": "boolean", "signal": "issuer_ok"},
        {"id": "c-ok-bool", "kind": "boolean", "signal": "ok"},
        *(_ISZERO_HALVES[cid] for cid in kept),
        {"id": "c-grant", "kind": "mul", "left": "ok", "right": "issuer_ok", "out": "granted"},
    ]


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


def public_payload(seed: str) -> dict[str, object]:
    """This deployment's public half, served by the verifier's `GET /public`.

    Exactly what `make inspect` has always printed, and nothing this module knows
    beyond it: the policy in words, the parameters, the circuit that was actually
    deployed, the two honest witnesses, the is-zero gadget's two formulas (which
    `starter/policy.py`'s own docstring already states) and the health token.

    What stays behind is `_ISZERO_HALVES` and `DROPPABLE`. Between them they are the
    two is-zero constraints as dicts, under the exact ids the checkpoints require --
    which is `intended_circuit()`'s answer, and with it `audit` and `repair` as a set
    difference. The deployed circuit below carries the surviving half, so a learner
    still sees one of the two in its concrete form; deriving the other from the
    formulas is the `build` checkpoint. See scripts/ac26-w1-underconstraint.test.ts.
    """
    prm = params(seed)
    return {
        "policy": "grant access iff the revocation counter is zero AND the issuer is recognised",
        "parameters": prm,
        "deployedCircuit": vulnerable_circuit(seed),
        "honestWitnesses": {
            "revokedCredential": honest_witness(prm),
            "cleanCredential": clean_witness(prm),
        },
        "iszeroGadget": {
            "iszero_a": "value * inv + out - 1 = 0",
            "iszero_b": "value * out = 0",
        },
        "healthToken": health_token(seed),
    }
