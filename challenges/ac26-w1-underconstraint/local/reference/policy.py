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
    """Claim ok = 1 (and so granted = 1) while revoked != 0.

    Which helper value makes that consistent depends on which constraint is gone:

      iszero_b missing -> only A survives: revoked*inv + 1 - 1 = 0, so inv = 0.
      iszero_a missing -> only B survives. B never reads inv, so replacing the
        honest revoked credential's seeded inverse with zero still satisfies the
        deployed circuit while A would reject it.
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
