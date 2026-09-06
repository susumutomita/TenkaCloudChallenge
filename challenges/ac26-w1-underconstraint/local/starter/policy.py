"""Edit only these four functions. Submit this source for the five code checkpoints.

First action: Inspect evidence -> deployedCircuit, then compare it with A and B.
A signal is a variable; a witness maps every signal name to an integer value.
A constraint checks remainder zero, and a circuit is a list of constraint dicts.
The evaluator is supplied: `from participant.evaluator import residual, satisfies`.
`residual(c, w, p)` evaluates one check; `satisfies(circuit, w, p)` checks them all.
Python if/loops are allowed for constructing data; return the expression dicts,
not a precomputed True/False. This is constraint inspection, not a ZK proof.

Policy: grant entry exactly when revoked=0 AND issuer_ok=1. issuer_ok and ok
must each be 0 or 1. revoked is the revocation count, ok marks revoked=0,
inv is a helper value, and granted is the entry decision.

A: value * inv + out - 1 = 0       B: value * out = 0
Every '=0' means remainder zero after division by prime p, not integer equality.
`a % p` computes that remainder. Use integer values from 0 through p-1.
For nonzero `a % p`, `pow(a, -1, p)` computes the inverse: multiplying by a
leaves remainder 1. Zero has no inverse. Example: p=7, 3*5=15 leaves 1.

Generic constraint formats (x, y, z, helper are example signal names):
  {"id":"check-id", "kind":"boolean", "signal":"z"}             z*(z-1)
  {"id":"check-id", "kind":"mul", "left":"x", "right":"y", "out":"z"}  x*y-z
  {"id":"check-id", "kind":"add", "left":"x", "right":"y", "out":"z"}  x+y-z
  {"id":"check-id", "kind":"const", "signal":"x", "value":3}  x-3
  {"id":"check-id", "kind":"iszero_a", "value":"x", "inv":"helper", "out":"z"}
  {"id":"check-id", "kind":"iszero_b", "value":"x", "out":"z"}
For the policy, map x to revoked, helper to inv, and z to ok. The two zero-check
ids must be c-iszero-a and c-iszero-b. An id is the name identifying a check.

Small check: p=7, value=3, inv=5, out=0 makes A=14->0 and B=0.
With B missing, inv=0,out=1 makes A=0 but B=3.
With A missing, inv=0,out=0 makes B=0 but A=-1->6: an invalid helper, not a
wrong entry decision. An invalid assignment is not automatically a false ZK claim.

root-cause is a direct JSON answer, not another Python function. Format example
with unrelated names, not the current answer:
  {"missingConstraintId":"c-example",
   "manipulatedSignals":[{"signal":"helper","before":3,"after":0}]}
Read before from Inspect evidence -> honestWitnesses.revokedCredential; after
comes from your counterexample. Include each changed signal once, omit unchanged
ones. Values are integers from 0 through p-1. For a missing A, any changed inverse
that violates the intended rule is valid; no particular wrong number is required.
"""

from __future__ import annotations


def intended_circuit() -> list[dict]:
    """Return the five intended checks, independent of the input values.

    Keep the two 0/1 checks and entry multiplication below, then supply A and B
    using the generic dict formats above. The starter lacks both zero checks;
    even so, its honest-input public tests pass. Those tests try no counterexample.
    """
    return [
        {"id": "c-issuer-bool", "kind": "boolean", "signal": "issuer_ok"},
        {"id": "c-ok-bool", "kind": "boolean", "signal": "ok"},
        {"id": "c-grant", "kind": "mul", "left": "ok", "right": "issuer_ok", "out": "granted"},
    ]


def audit(circuit: list[dict]) -> list[str]:
    """Return sorted ids present in intended_circuit() but absent from circuit.

    A complete list has no missing id: return []. Compare names, not only counts.
    """
    return []


def forge_witness(circuit: list[dict], params: dict[str, int]) -> dict[str, int]:
    """Return all five signals: pass circuit, fail at least one intended check.

    Preserve params['revoked'] and params['issuer_ok']; choose inv, ok and granted.
    Use params['p'] for remainders. circuit is missing A or B; inspect it each time.
    With the fixed nonzero revoked input, B still forces ok=0 when A is missing;
    inv is then not checked. A missing B can instead allow an incorrect ok.
    Set granted consistently with ok*issuer_ok. An incorrect helper is sufficient;
    the entry decision need not change. Do not hard-code today's displayed numbers.
    """
    return {}


def repair(circuit: list[dict]) -> list[dict]:
    """Preserve every supplied dict and append only the missing intended check.

    The result must reject counterexamples while accepting both honest credential
    cases. Do not change/delete existing checks or append the whole intended list.
    The same implementation also runs with another missing check and other numbers.
    """
    return list(circuit)
