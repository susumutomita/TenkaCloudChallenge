"""Reference solution. Inside the image only; never mounted to the host."""

from __future__ import annotations

INTENDED = [
    {"id": "c-issuer-bool", "kind": "boolean", "signal": "issuer_ok"},
    {"id": "c-ok-bool", "kind": "boolean", "signal": "ok"},
    {"id": "c-iszero-a", "kind": "iszero_a", "value": "revoked", "inv": "inv", "out": "ok"},
    {"id": "c-iszero-b", "kind": "iszero_b", "value": "revoked", "out": "ok"},
    {"id": "c-grant", "kind": "mul", "left": "ok", "right": "issuer_ok", "out": "granted"},
]


def intended_circuit() -> list[dict]:
    return [dict(c) for c in INTENDED]


def audit(circuit: list[dict]) -> list[str]:
    present = {str(c["id"]) for c in circuit}
    return sorted(str(c["id"]) for c in INTENDED if str(c["id"]) not in present)


def forge_witness(circuit: list[dict], params: dict[str, int]) -> dict[str, int]:
    """A witness satisfying `circuit` (deployed) while failing the intended one.

    That structural condition is the checkpoint's actual definition of "false
    claim" -- it is not always "ok = 1 despite revoked != 0" (see #527). Which
    shape the forgery takes depends on which constraint survives:

      iszero_b missing -> only A survives: revoked*inv + 1 - 1 = 0 is satisfied
        by inv = 0 once ok is claimed to be 1, so a revoked credential is
        granted access it should not have.
      iszero_a missing -> only B survives, and B never reads inv. The honest
        decision (ok = 0, access denied) does not have to change at all: the
        false claim here is that `inv` still means "the inverse of revoked",
        when the surviving circuit no longer checks that in any way.
    """
    p = params["p"]
    revoked = params["revoked"] % p
    missing = set(audit(circuit))
    issuer_ok = params["issuer_ok"] % p
    if "c-iszero-b" in missing:
        # A alone cannot stop ok = 1 on a revoked credential: pick inv = 0.
        return {"revoked": revoked, "inv": 0, "ok": 1, "issuer_ok": issuer_ok, "granted": issuer_ok}
    # B never reads inv. Keep the revoked credential's policy outcome honest but
    # replace its seeded inverse with zero; the surviving circuit accepts a value
    # that the missing A constraint rejects.
    return {"revoked": revoked, "inv": 0, "ok": 0, "issuer_ok": issuer_ok, "granted": 0}


def repair(circuit: list[dict]) -> list[dict]:
    present = {str(c["id"]) for c in circuit}
    return [dict(c) for c in circuit] + [
        dict(c) for c in INTENDED if str(c["id"]) not in present
    ]
