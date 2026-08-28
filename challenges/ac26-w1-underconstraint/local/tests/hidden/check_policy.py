"""Hidden tests. Run by /verify against a copy of the learner's policy.py.

The exploit checkpoint's definition of success is deliberately structural rather than
textual: a forged witness must satisfy the *vulnerable* circuit and fail the
*intended* one. That is exactly what "the missing constraint was load-bearing" means,
and it holds for either constraint being dropped, which matters because which one is
dropped changes with the seed.

Nothing here imports the complete/intended circuit or "which constraint is missing"
as a ready-made value from `fixtures/generate.py` -- those are answers to the build
and audit checkpoints. `_missing_id` below derives the second one by reading the
deployed circuit's own ids, and `_passes_intended_gadget` checks the generic,
already-documented is-zero formulas directly, so neither needs an oracle.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from participant.evaluator import residual, satisfies  # noqa: E402
from fixtures.generate import (  # noqa: E402
    DROPPABLE,
    clean_witness,
    honest_witness,
    params,
    vulnerable_circuit,
)

LABELS = ("h0", "h1", "h2", "h3")

# The is-zero gadget's two halves, in the generic shape the README and every
# docstring in this problem already spell out. Not an answer: the tool.
_ISZERO_GADGET = (
    {"kind": "iszero_a", "value": "revoked", "inv": "inv", "out": "ok"},
    {"kind": "iszero_b", "value": "revoked", "out": "ok"},
)


def _normalized(circuit: object) -> list[dict] | None:
    if not isinstance(circuit, list) or not circuit:
        return None
    if any(not isinstance(c, dict) or "id" not in c or "kind" not in c for c in circuit):
        return None
    return circuit


def _missing_id(circuit: list[dict]) -> str | None:
    """Which of the two droppable ids is absent from `circuit`, read off its own
    ids -- not a second, independently seeded computation that could drift from
    what `vulnerable_circuit` actually built.
    """
    present = {str(c["id"]) for c in circuit}
    missing = [cid for cid in DROPPABLE if cid not in present]
    return missing[0] if len(missing) == 1 else None


def _passes_intended_gadget(witness: dict[str, int], p: int) -> bool:
    """True iff `witness` satisfies *both* halves of the is-zero gadget.

    Every deployed circuit in this problem keeps the other three constraints
    (issuer-bool, ok-bool, grant) no matter which half is dropped -- only the
    gadget itself is ever droppable. So for a witness that already satisfies the
    deployed circuit, this is exactly "also satisfies the intended circuit",
    without needing the intended circuit as an importable value.
    """
    return all(residual(c, witness, p) == 0 for c in _ISZERO_GADGET)


def check_build(module, seed: str) -> list[str]:
    """The learner's circuit must accept honest witnesses and reject every forgery."""
    failures: list[str] = []
    try:
        built = _normalized(module.intended_circuit())
    except Exception as error:  # noqa: BLE001
        return [f"intended_circuit raised {type(error).__name__}"]
    if built is None:
        return ["intended_circuit did not return a list of constraint dicts"]

    for label in LABELS:
        prm = params(seed, label)
        p = prm["p"]
        if not satisfies(built, honest_witness(prm), p):
            failures.append("the built circuit rejects an honest revoked credential")
        if not satisfies(built, clean_witness(prm), p):
            failures.append("the built circuit rejects an honest clean credential")
        # Every forgery that beats a one-constraint-short circuit must fail here.
        for dropped in DROPPABLE:
            for forged in _known_forgeries(prm, dropped):
                if satisfies(built, forged, p):
                    failures.append("the built circuit accepts a witness with a false claim")
    return failures


def _known_forgeries(prm: dict[str, int], dropped: str) -> list[dict[str, int]]:
    p, revoked, issuer = prm["p"], prm["revoked"] % prm["p"], prm["issuer_ok"] % prm["p"]
    if dropped == "c-iszero-b":
        return [{"revoked": revoked, "inv": 0, "ok": 1, "issuer_ok": issuer, "granted": issuer}]
    return [{"revoked": revoked, "inv": 0, "ok": 0, "issuer_ok": issuer, "granted": 0}]


def check_audit(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        circuit = vulnerable_circuit(seed, label)
        expected = [_missing_id(circuit)]
        try:
            actual = module.audit(circuit)
        except Exception as error:  # noqa: BLE001
            return [f"audit raised {type(error).__name__}"]
        if not isinstance(actual, list) or sorted(str(a) for a in actual) != sorted(
            str(e) for e in expected if e is not None
        ):
            failures.append("audit does not name exactly the absent constraint")
        # Self-consistency, not an oracle comparison: a submission's own audit()
        # must see no gap in that same submission's own intended_circuit(). This
        # cannot use a ground-truth "complete" circuit here, because handing one
        # over would be exactly the leak this problem must not ship (#525).
        try:
            if module.audit(module.intended_circuit()) != []:
                failures.append("audit reports a gap in the complete circuit")
        except Exception as error:  # noqa: BLE001
            failures.append(f"audit raised {type(error).__name__} on a complete circuit")
    return failures


def check_exploit(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        prm = params(seed, label)
        p = prm["p"]
        circuit = vulnerable_circuit(seed, label)
        try:
            forged = module.forge_witness(circuit, dict(prm))
        except Exception as error:  # noqa: BLE001
            return [f"forge_witness raised {type(error).__name__}"]
        if not isinstance(forged, dict):
            failures.append("forge_witness did not return a witness")
            continue
        if not satisfies(circuit, forged, p):
            failures.append("the forged witness does not satisfy the deployed circuit")
        try:
            claims_nothing_false = _passes_intended_gadget(forged, p)
        except Exception:  # noqa: BLE001 - a witness missing gadget signals used to crash the
            # whole run into a bare `correct: false`; keep the same failed verdict but let
            # /verify surface a property-level reason for it (AGENTS.md §15).
            failures.append("the forged witness is missing signals the is-zero gadget needs")
            continue
        if claims_nothing_false:
            failures.append("the forged witness also satisfies the intended circuit, so it claims nothing false")
    return failures


def check_repair(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        prm = params(seed, label)
        p = prm["p"]
        circuit = vulnerable_circuit(seed, label)
        try:
            repaired = _normalized(module.repair([dict(c) for c in circuit]))
        except Exception as error:  # noqa: BLE001
            return [f"repair raised {type(error).__name__}"]
        if repaired is None:
            failures.append("repair did not return a list of constraint dicts")
            continue
        if not satisfies(repaired, honest_witness(prm), p):
            failures.append("the repaired circuit rejects an honest revoked credential")
        if not satisfies(repaired, clean_witness(prm), p):
            failures.append("the repaired circuit rejects an honest clean credential")
        dropped = _missing_id(circuit)
        for forged in _known_forgeries(prm, dropped) if dropped is not None else []:
            if satisfies(repaired, forged, p):
                failures.append("the repaired circuit still accepts the forged witness")
        try:
            own = module.forge_witness(circuit, dict(prm))
            if isinstance(own, dict) and satisfies(repaired, own, p) and not _passes_intended_gadget(own, p):
                failures.append("the repaired circuit still accepts the learner's own forgery")
        except Exception:  # noqa: BLE001 - forge failures are the exploit checkpoint's problem
            pass
        if len(repaired) > len(circuit) + 1:
            # /verify surfaces this string (AGENTS.md §15): state the public "don't overload"
            # property (README scoring table), not the exact bound, which is hint material.
            failures.append("the repair adds too many constraints")
    return failures


def run(module, seed: str) -> list[str]:
    return [
        *check_build(module, seed),
        *check_audit(module, seed),
        *check_exploit(module, seed),
        *check_repair(module, seed),
    ]
