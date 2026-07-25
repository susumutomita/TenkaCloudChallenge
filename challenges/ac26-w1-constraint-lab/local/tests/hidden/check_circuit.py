"""Hidden tests. Run by /verify against a copy of the learner's three files.

What they enforce beyond "the happy case works":
  - negative residuals normalize (a residual of -1 is p-1, and neither is zero)
  - several distinct prime fields
  - constraint order is shuffled, so nothing may depend on position
  - a missing signal is an error, not a silent zero
  - a boolean gadget rejects every non-{0,1} value in the field, not just 2
  - a membership gadget accepts exactly the allowed set, for sizes 1..5

Failure messages name the property, never the expected value.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    allowed_set,
    broken_witness,
    circuit,
    field_modulus,
    honest_witness,
)

LABELS = ("h0", "h1", "h2")


def _field(module, modulus: int):
    return module.Field(modulus)


def check_normalize(field_module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        p = field_modulus(seed, label)
        f = _field(field_module, p)
        if f.normalize(-1) != p - 1:
            failures.append("normalize does not map a negative value into [0, modulus)")
        if f.normalize(p) != 0:
            failures.append("normalize does not map the modulus itself to zero")
        if not f.is_zero(-p):
            failures.append("is_zero misses a value congruent to zero")
        if f.sub(0, 1) != p - 1:
            failures.append("sub leaves a negative result unnormalized")
    return failures


def check_residuals(circuit_module, field_module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        p = field_modulus(seed, label)
        f = _field(field_module, p)
        circ = circuit(seed, label)
        honest = honest_witness(seed, label)
        try:
            entries = circuit_module.trace(circ, honest, f)
        except Exception as error:  # noqa: BLE001
            failures.append(f"trace raised {type(error).__name__} on an honest witness")
            continue
        if len(entries) != len(circ):
            failures.append("trace does not return one entry per constraint")
            continue
        if [e["id"] for e in entries] != [c["id"] for c in circ]:
            failures.append("trace does not preserve circuit order")
        if any(f.normalize(int(e["residual"])) != 0 for e in entries):
            failures.append("an honest witness produced a non-zero residual")

        broken, expected = broken_witness(seed, label)
        try:
            actual = circuit_module.first_broken(circ, broken, f)
        except Exception as error:  # noqa: BLE001
            failures.append(f"first_broken raised {type(error).__name__}")
            continue
        if actual != expected:
            failures.append("first_broken names the wrong constraint")
        if circuit_module.first_broken(circ, honest, f) is not None:
            failures.append("first_broken reports a break on a satisfied circuit")
    return failures


def check_order_independence(circuit_module, field_module, seed: str) -> list[str]:
    """Reversing the circuit must reverse the trace, not change any residual."""
    p = field_modulus(seed, "h0")
    f = _field(field_module, p)
    circ = circuit(seed, "h0")
    honest = honest_witness(seed, "h0")
    try:
        forward = {e["id"]: f.normalize(int(e["residual"])) for e in circuit_module.trace(circ, honest, f)}
        backward = {
            e["id"]: f.normalize(int(e["residual"]))
            for e in circuit_module.trace(list(reversed(circ)), honest, f)
        }
    except Exception as error:  # noqa: BLE001
        return [f"trace raised {type(error).__name__} on a reordered circuit"]
    return [] if forward == backward else ["residuals depend on constraint order"]


def check_missing_signal(circuit_module, field_module, seed: str) -> list[str]:
    """A constraint over an unassigned signal must raise, not quietly return zero."""
    p = field_modulus(seed, "h0")
    f = _field(field_module, p)
    circ = circuit(seed, "h0")
    partial = dict(honest_witness(seed, "h0"))
    partial.pop("gated", None)
    try:
        circuit_module.trace(circ, partial, f)
    except Exception:  # noqa: BLE001 - raising is the expected behaviour
        return []
    return ["a missing signal was treated as satisfiable instead of raising"]


def check_boolean(gadgets_module, circuit_module, field_module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        p = field_modulus(seed, label)
        f = _field(field_module, p)
        try:
            constraint = gadgets_module.boolean_constraint("b")
        except Exception as error:  # noqa: BLE001
            return [f"boolean_constraint raised {type(error).__name__}"]
        for value in range(p):
            try:
                residual = f.normalize(int(circuit_module.evaluate(constraint, {"b": value}, f)))
            except Exception as error:  # noqa: BLE001
                failures.append(f"evaluating the boolean gadget raised {type(error).__name__}")
                break
            satisfied = residual == 0
            if satisfied != (value in (0, 1)):
                failures.append("the boolean gadget admits the wrong set of values")
                break
    return failures


def check_membership(gadgets_module, circuit_module, field_module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        p = field_modulus(seed, label)
        f = _field(field_module, p)
        allowed = allowed_set(seed, label)
        try:
            constraints = gadgets_module.membership_constraints("m", allowed)
        except Exception as error:  # noqa: BLE001
            return [f"membership_constraints raised {type(error).__name__}"]
        if not isinstance(constraints, list) or not constraints:
            failures.append("membership_constraints returned no constraints")
            continue
        for value in range(p):
            try:
                residuals = [
                    f.normalize(int(circuit_module.evaluate(c, {"m": value}, f)))
                    for c in constraints
                ]
            except Exception as error:  # noqa: BLE001
                failures.append(f"evaluating the membership gadget raised {type(error).__name__}")
                break
            satisfied = all(r == 0 for r in residuals)
            if satisfied != (value in allowed):
                failures.append("the membership gadget admits the wrong set of values")
                break
    return failures


def run(field_module, circuit_module, gadgets_module, seed: str) -> list[str]:
    return [
        *check_normalize(field_module, seed),
        *check_residuals(circuit_module, field_module, seed),
        *check_order_independence(circuit_module, field_module, seed),
        *check_missing_signal(circuit_module, field_module, seed),
        *check_boolean(gadgets_module, circuit_module, field_module, seed),
        *check_membership(gadgets_module, circuit_module, field_module, seed),
    ]
