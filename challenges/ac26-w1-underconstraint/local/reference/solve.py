"""Reference solution: the two answers, derived from the seed rather than stored.

Author stage only -- the `participant` image does not carry this directory, and
nothing on the participant path imports it. See TEMPLATE.md "Assurance scope" for
what that does and does not buy.

Which of the two is-zero constraints was dropped decides both answers, and it flips
with the seed:

    c-iszero-b dropped -> only A survives (revoked*inv + ok - 1 = 0). With inv = 0
        that reads ok = 1 for *any* counter, so a revoked holder can claim access.
        The missing residual is revoked*ok.

    c-iszero-a dropped -> only B survives (revoked*ok = 0). With revoked != 0 it
        forces ok = 0, so "revoked but allowed" is unreachable; the lie that gets
        through runs the other way. A clean holder (revoked = 0) can claim ok = 0
        and be denied a right they hold. The missing residual is
        revoked*inv + ok - 1.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import SIGNALS, dropped_constraint, params


def forged_witness(seed: str) -> dict[str, int]:
    prm = params(seed)
    p = prm["p"]
    issuer_ok = prm["issuer_ok"] % p
    if dropped_constraint(seed) == "c-iszero-b":
        # A alone cannot stop ok = 1 on a revoked credential: pick inv = 0.
        return {
            "revoked": prm["revoked"] % p,
            "inv": 0,
            "ok": 1,
            "issuer_ok": issuer_ok,
            "granted": issuer_ok,
        }
    # B alone cannot stop ok = 0 on a clean credential: deny an honest holder.
    return {"revoked": 0, "inv": 0, "ok": 0, "issuer_ok": issuer_ok, "granted": 0}


def witness_arguments(seed: str) -> list[str]:
    """The forged witness as the argv `circuit check` takes."""
    witness = forged_witness(seed)
    return [f"{name}={witness[name]}" for name in SIGNALS]


def repair_expression(seed: str) -> str:
    if dropped_constraint(seed) == "c-iszero-b":
        return "revoked*ok"
    return "revoked*inv + ok - 1"


def repair_arguments(seed: str) -> list[str]:
    return [repair_expression(seed)]
