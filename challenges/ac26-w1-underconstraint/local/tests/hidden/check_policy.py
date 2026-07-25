"""Hidden tests. Run by /verify against a copy of the learner's policy.py.

The exploit checkpoint's definition of success is deliberately structural rather than
textual: a forged witness must satisfy the *vulnerable* circuit and fail the
*intended* one. That is exactly what "the missing constraint was load-bearing" means,
and it holds for either constraint being dropped, which matters because which one is
dropped changes with the seed.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.evaluator import satisfies  # noqa: E402
from fixtures.generate import (  # noqa: E402
    DROPPABLE,
    clean_witness,
    dropped_constraint,
    honest_witness,
    intended_circuit,
    params,
    vulnerable_circuit,
)

LABELS = ("h0", "h1", "h2", "h3")


def _normalized(circuit: object) -> list[dict] | None:
    if not isinstance(circuit, list) or not circuit:
        return None
    if any(not isinstance(c, dict) or "id" not in c or "kind" not in c for c in circuit):
        return None
    return circuit


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
            short = [c for c in intended_circuit() if c["id"] != dropped]
            for forged in _known_forgeries(prm, dropped):
                if satisfies(short, forged, p) and satisfies(built, forged, p):
                    failures.append("the built circuit accepts a witness with a false claim")
    return failures


def _known_forgeries(prm: dict[str, int], dropped: str) -> list[dict[str, int]]:
    p, revoked, issuer = prm["p"], prm["revoked"] % prm["p"], prm["issuer_ok"] % prm["p"]
    if dropped == "c-iszero-b":
        return [{"revoked": revoked, "inv": 0, "ok": 1, "issuer_ok": issuer, "granted": issuer}]
    return [{"revoked": 0, "inv": 0, "ok": 0, "issuer_ok": issuer, "granted": 0}]


def check_audit(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        circuit = vulnerable_circuit(seed, label)
        expected = [dropped_constraint(seed, label)]
        try:
            actual = module.audit(circuit)
        except Exception as error:  # noqa: BLE001
            return [f"audit raised {type(error).__name__}"]
        if not isinstance(actual, list) or sorted(str(a) for a in actual) != sorted(expected):
            failures.append("audit does not name exactly the absent constraint")
        try:
            if module.audit(intended_circuit()) != []:
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
        if satisfies(intended_circuit(), forged, p):
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
        for forged in _known_forgeries(prm, dropped_constraint(seed, label)):
            if satisfies(repaired, forged, p):
                failures.append("the repaired circuit still accepts the forged witness")
        try:
            own = module.forge_witness(circuit, dict(prm))
            if isinstance(own, dict) and satisfies(repaired, own, p) and not satisfies(
                intended_circuit(), own, p
            ):
                failures.append("the repaired circuit still accepts the learner's own forgery")
        except Exception:  # noqa: BLE001 - forge failures are the exploit checkpoint's problem
            pass
        if len(repaired) > len(intended_circuit()):
            failures.append("the repair adds more constraints than the intended circuit has")
    return failures


def run(module, seed: str) -> list[str]:
    return [
        *check_build(module, seed),
        *check_audit(module, seed),
        *check_exploit(module, seed),
        *check_repair(module, seed),
    ]
