"""The only file you edit. Four functions, one exploit chain.

The policy in words:

    Access is granted exactly when the revocation counter is zero AND the issuer is
    recognised. `ok` is the flag meaning "the counter is zero".

`ok` cannot be computed with an if-statement. In a circuit, "is this signal zero?"
is a claim you constrain, using a helper signal `inv` the prover supplies:

    iszero_a:  value * inv + out - 1 = 0
    iszero_b:  value * out           = 0

Available constraint kinds: boolean, mul, add, const, iszero_a, iszero_b.
"""

from __future__ import annotations


def intended_circuit() -> list[dict]:
    """The complete circuit the policy intends.

    Return the constraint list. Ids are yours to choose except for the two is-zero
    constraints, which must be `c-iszero-a` and `c-iszero-b` so the audit and repair
    checkpoints can talk about them.

    The starter is missing the is-zero pair entirely, so `ok` is unconstrained.
    """
    return [
        {"id": "c-issuer-bool", "kind": "boolean", "signal": "issuer_ok"},
        {"id": "c-ok-bool", "kind": "boolean", "signal": "ok"},
        {"id": "c-grant", "kind": "mul", "left": "ok", "right": "issuer_ok", "out": "granted"},
    ]


def audit(circuit: list[dict]) -> list[str]:
    """Ids of the constraints the intended circuit has and this one does not.

    Return a sorted list. An empty list means "this circuit is complete".
    """
    return []


def forge_witness(circuit: list[dict], params: dict[str, int]) -> dict[str, int]:
    """A witness satisfying `circuit` while the statement it claims is false.

    False here means: `granted` is 1 even though `params["revoked"]` is not zero.

    `circuit` is missing one constraint, and which one changes with the seed — so
    derive the forgery from what is actually absent, not from a remembered answer.
    """
    return {}


def repair(circuit: list[dict]) -> list[dict]:
    """Return `circuit` with the minimum constraints added to close the hole.

    Adding every constraint you can think of is not a repair. The checkpoint checks
    that no forged witness survives AND that honest witnesses are still accepted.
    """
    return list(circuit)
