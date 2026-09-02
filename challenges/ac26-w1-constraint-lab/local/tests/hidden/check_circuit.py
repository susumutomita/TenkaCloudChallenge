"""Hidden tests. Run by /verify against a copy of the learner's three files.

What they enforce beyond "the happy case works":
  - negative residuals normalize (a residual of -1 is p-1, and neither is zero)
  - several distinct prime fields, and a hidden circuit that uses all five kinds
  - the constraints arrive in a seed-derived order, so nothing may depend on position
    and `first_broken` counts "first" in the order it was handed
  - a missing signal is an error, not a silent zero
  - the gadgets are judged by the reference evaluator below, which knows exactly the
    five documented kinds: a gadget cannot pass by inventing a kind that only the
    submission's own `evaluate` understands
  - a boolean gadget rejects every non-{0,1} value in the field, not just 2
  - a membership gadget accepts exactly the allowed set, for sizes 1..5
  - a range gadget admits 0 .. 2**bits - 1 with the submission's own witness and, for
    values outside, admits nothing -- no assignment of its auxiliary signals satisfies
    it (checked by an exact search, not by trusting the witness function)

Failure messages name the property or the documented rule, never the expected value.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    allowed_set,
    field_modulus,
    hidden_broken_witness,
    hidden_circuit,
    hidden_honest_witness,
    hidden_shuffled_circuit,
    range_bits,
    range_probe_values,
)

LABELS = ("h0", "h1", "h2")

#: The five documented constraint kinds. The reference evaluator knows these and
#: nothing else -- a submission's `evaluate` is never consulted when a gadget is graded.
KINDS = ("mul", "add", "const", "boolean", "member")
#: Kinds the range gadget may use. `member` is excluded by the statement's rule: a
#: range must be built by decomposition, not by listing 2**bits factors.
RANGE_KINDS = ("boolean", "add", "mul", "const")
#: Constraint budget of the range gadget, per bit (the statement's "5 x bits").
RANGE_CONSTRAINTS_PER_BIT = 5
#: Assignments the auxiliary-signal search may try for one probe value before it gives
#: up. Decomposition gadgets need a few thousand at most; a gadget that leaves many
#: signals free is reported against this budget rather than against a wall clock, so
#: the verdict is deterministic.
SEARCH_BUDGET = 200_000
#: The signal the range gadget is asked to bind. Auxiliary names are the learner's.
RANGE_SIGNAL = "amount"

_SIGNAL_KEYS = {
    "mul": ("left", "right", "out"),
    "add": ("left", "right", "out"),
    "const": ("signal",),
    "boolean": ("signal",),
    "member": ("signal",),
}


class ConstraintError(ValueError):
    """A constraint the reference evaluator cannot read. The message names the rule."""


class SearchBudgetExceeded(Exception):
    """The auxiliary-signal search ran out of budget before deciding."""


def _number(value: object, what: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ConstraintError(f"{what} is not an integer")
    return value


def constraint_signals(constraint: object) -> list[str]:
    """The signal names one constraint reads, validated against its kind."""
    if not isinstance(constraint, dict):
        raise ConstraintError("a constraint is not a dict")
    kind = constraint.get("kind")
    if kind not in KINDS:
        raise ConstraintError("a constraint uses a kind that is not one of the five documented kinds")
    names: list[str] = []
    for key in _SIGNAL_KEYS[kind]:
        name = constraint.get(key)
        if not isinstance(name, str):
            raise ConstraintError("a constraint is missing a signal field its kind needs")
        names.append(name)
    return names


def reference_evaluate(constraint: dict, witness: dict, p: int) -> int:
    """The residual of one constraint, by the five documented expressions, in [0, p)."""
    names = constraint_signals(constraint)
    values: list[int] = []
    for name in names:
        if name not in witness:
            raise ConstraintError("a constraint names a signal the witness does not assign")
        values.append(_number(witness[name], "a witness value") % p)
    kind = constraint["kind"]
    if kind == "mul":
        left, right, out = values
        return (left * right - out) % p
    if kind == "add":
        left, right, out = values
        return (left + right - out) % p
    if kind == "const":
        return (values[0] - _number(constraint.get("value"), "a const constraint's value")) % p
    if kind == "boolean":
        return (values[0] * (values[0] - 1)) % p
    allowed = constraint.get("allowed")
    if not isinstance(allowed, (list, tuple)):
        raise ConstraintError("a member constraint's allowed is not a list")
    product = 1
    for item in allowed:
        product = (product * (values[0] - _number(item, "a member constraint's allowed value"))) % p
    return product


def reference_first_broken(circuit: list[dict], witness: dict, p: int) -> str | None:
    for constraint in circuit:
        if reference_evaluate(constraint, witness, p) != 0:
            return str(constraint["id"])
    return None


def _field(module, modulus: int):
    return module.Field(modulus)


# --- residuals -----------------------------------------------------------------------


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


def _rows(entries: object, f) -> tuple[list[str], list[int]] | None:
    """Ids and normalized residuals of a trace, or None when the shape is wrong."""
    if not isinstance(entries, list):
        return None
    try:
        ids = [str(entry["id"]) for entry in entries]
        residuals = [f.normalize(int(entry["residual"])) for entry in entries]
    except Exception:  # noqa: BLE001 - any shape problem is the same failure
        return None
    return ids, residuals


def check_residuals(circuit_module, field_module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        p = field_modulus(seed, label)
        f = _field(field_module, p)
        circ = hidden_shuffled_circuit(seed, label)
        honest = hidden_honest_witness(seed, label)
        try:
            entries = circuit_module.trace(circ, honest, f)
        except Exception as error:  # noqa: BLE001
            failures.append(
                f"trace raised {type(error).__name__} on an honest witness"
                " (the hidden circuit uses all five constraint kinds)"
            )
            continue
        rows = _rows(entries, f)
        if rows is None or len(rows[0]) != len(circ):
            failures.append("trace does not return one {id, residual} entry per constraint")
            continue
        ids, residuals = rows
        if ids != [str(c["id"]) for c in circ]:
            failures.append("trace does not preserve the order the circuit was given in")
        if any(residual != 0 for residual in residuals):
            failures.append("an honest witness produced a non-zero residual")

        broken = hidden_broken_witness(seed, label)
        expected = reference_first_broken(circ, broken, p)
        try:
            actual = circuit_module.first_broken(circ, broken, f)
            broken_rows = _rows(circuit_module.trace(circ, broken, f), f)
            satisfied = circuit_module.first_broken(circ, honest, f)
        except Exception as error:  # noqa: BLE001
            failures.append(f"first_broken raised {type(error).__name__}")
            continue
        if actual != expected:
            failures.append("first_broken names the wrong constraint")
        if broken_rows is None or broken_rows[1] != [reference_evaluate(c, broken, p) for c in circ]:
            failures.append("a residual on the broken witness does not match the constraint's expression")
        if satisfied is not None:
            failures.append("first_broken reports a break on a satisfied circuit")
    return failures


def check_order_independence(circuit_module, field_module, seed: str) -> list[str]:
    """Reordering the circuit must reorder the trace, not change any residual."""
    p = field_modulus(seed, "h0")
    f = _field(field_module, p)
    circ = hidden_circuit(seed, "h0")
    honest = hidden_honest_witness(seed, "h0")
    try:
        forward = {e["id"]: f.normalize(int(e["residual"])) for e in circuit_module.trace(circ, honest, f)}
        backward = {
            e["id"]: f.normalize(int(e["residual"]))
            for e in circuit_module.trace(list(reversed(circ)), honest, f)
        }
        shuffled = {
            e["id"]: f.normalize(int(e["residual"]))
            for e in circuit_module.trace(hidden_shuffled_circuit(seed, "h0"), honest, f)
        }
    except Exception as error:  # noqa: BLE001
        return [f"trace raised {type(error).__name__} on a reordered circuit"]
    return [] if forward == backward == shuffled else ["residuals depend on constraint order"]


def check_missing_signal(circuit_module, field_module, seed: str) -> list[str]:
    """A constraint over an unassigned signal must raise, not quietly return zero."""
    p = field_modulus(seed, "h0")
    f = _field(field_module, p)
    circ = hidden_circuit(seed, "h0")
    partial = dict(hidden_honest_witness(seed, "h0"))
    partial.pop("gated", None)
    try:
        circuit_module.trace(circ, partial, f)
    except Exception:  # noqa: BLE001 - raising is the expected behaviour
        return []
    return ["a missing signal was treated as satisfiable instead of raising"]


# --- gadgets, judged by the reference evaluator ---------------------------------------


def _admitted_values(constraints: list, signal: str, p: int) -> set[int]:
    """Every field element the constraints let `signal` take, by the reference evaluator."""
    admitted: set[int] = set()
    for value in range(p):
        if all(reference_evaluate(c, {signal: value}, p) == 0 for c in constraints):
            admitted.add(value)
    return admitted


def check_boolean(gadgets_module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        p = field_modulus(seed, label)
        try:
            constraint = gadgets_module.boolean_constraint("b")
        except Exception as error:  # noqa: BLE001
            return [f"boolean_constraint raised {type(error).__name__}"]
        if not isinstance(constraint, dict):
            return ["boolean_constraint did not return a constraint dict"]
        try:
            admitted = _admitted_values([constraint], "b", p)
        except ConstraintError as error:
            return [f"boolean gadget: {error}"]
        if admitted != {0, 1}:
            failures.append("the boolean gadget admits the wrong set of values")
            break
    return failures


def check_membership(gadgets_module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        p = field_modulus(seed, label)
        allowed = allowed_set(seed, label)
        try:
            constraints = gadgets_module.membership_constraints("m", allowed)
        except Exception as error:  # noqa: BLE001
            return [f"membership_constraints raised {type(error).__name__}"]
        if not isinstance(constraints, list) or not constraints:
            failures.append("membership_constraints returned no constraints")
            continue
        try:
            admitted = _admitted_values(constraints, "m", p)
        except ConstraintError as error:
            return [f"membership gadget: {error}"]
        if admitted != set(allowed):
            failures.append("the membership gadget admits the wrong set of values")
            break
    return failures


# --- range gadget ---------------------------------------------------------------------


def _range_shape_problem(constraints: object, bits: int) -> str | None:
    """The documented rule a range gadget breaks by its shape alone, if any."""
    if not isinstance(constraints, list) or not constraints:
        return "range_constraints returned no constraints"
    for constraint in constraints:
        if not isinstance(constraint, dict):
            return "range_constraints returned something that is not a constraint dict"
        if constraint.get("kind") not in RANGE_KINDS:
            return "range_constraints uses a constraint kind other than boolean, add, mul, const"
    if len(constraints) > RANGE_CONSTRAINTS_PER_BIT * bits:
        return "range_constraints returned more than 5 x bits constraints"
    return None


def _candidates(constraint: dict, assignment: dict, unknown: str, p: int) -> list[int]:
    """Values of `unknown` -- the one unassigned signal of `constraint` -- that satisfy it.

    Solved in closed form for the common single-occurrence case (an `add` or `mul`
    pins its third signal, a `const` its only one, a `boolean` to {0, 1}); otherwise
    by trying every field element, which is exact and merely slower.
    """
    kind = constraint["kind"]
    if kind == "boolean":
        return [0, 1]
    if kind == "const":
        return [_number(constraint.get("value"), "a const constraint's value") % p]
    roles = [key for key in ("left", "right", "out") if constraint.get(key) == unknown]
    if kind in ("add", "mul") and len(roles) == 1:
        role = roles[0]
        left = assignment.get(constraint["left"])
        right = assignment.get(constraint["right"])
        out = assignment.get(constraint["out"])
        if kind == "add":
            if role == "out":
                return [(left + right) % p]
            return [(out - (right if role == "left" else left)) % p]
        if role == "out":
            return [(left * right) % p]
        other = (right if role == "left" else left) % p
        if other == 0:
            return list(range(p)) if out % p == 0 else []
        return [(out * pow(other, -1, p)) % p]
    probe = dict(assignment)
    matching: list[int] = []
    for value in range(p):
        probe[unknown] = value
        if reference_evaluate(constraint, probe, p) == 0:
            matching.append(value)
    return matching


def has_assignment(constraints: list[dict], fixed: dict[str, int], p: int, budget: int = SEARCH_BUDGET) -> bool:
    """Whether some assignment of the unfixed signals satisfies every constraint.

    Exact backtracking search: at each step the constraint with the fewest unassigned
    signals is chosen, its next signal is tried over the candidates that constraint
    allows, and every constraint that becomes fully assigned is checked at once.
    Raises SearchBudgetExceeded instead of running past `budget` assignments.
    """
    names = [constraint_signals(c) for c in constraints]
    assignment = dict(fixed)
    tried = 0

    def fully_assigned_ok(target: str | None) -> bool:
        for index, signals in enumerate(names):
            if target is not None and target not in signals:
                continue
            if all(name in assignment for name in signals):
                if reference_evaluate(constraints[index], assignment, p) != 0:
                    return False
        return True

    def search() -> bool:
        nonlocal tried
        best: int | None = None
        best_free: list[str] = []
        for index, signals in enumerate(names):
            free = [name for name in signals if name not in assignment]
            if not free:
                continue
            if best is None or len(free) < len(best_free):
                best, best_free = index, free
            if len(free) == 1:
                break
        if best is None:
            return True
        target = best_free[0]
        candidates = _candidates(constraints[best], assignment, target, p) if len(best_free) == 1 else range(p)
        for value in candidates:
            tried += 1
            if tried > budget:
                raise SearchBudgetExceeded
            assignment[target] = value
            if fully_assigned_ok(target) and search():
                return True
            del assignment[target]
        return False

    if not fully_assigned_ok(None):
        return False
    return search()


def check_range(gadgets_module, seed: str) -> list[str]:
    """The range gadget, by the documented rules, on three widths.

    (1) shape: only boolean / add / mul / const, at most 5 x bits constraints;
    (2) every value in 0 .. 2**bits - 1 satisfies the gadget with the witness the
        submission's own `range_witness` returns for it;
    (3) values outside the range satisfy it under no assignment of the auxiliary
        signals at all.
    """
    failures: list[str] = []
    for label in LABELS:
        p = field_modulus(seed, label)
        bits = range_bits(seed, label)
        try:
            constraints = gadgets_module.range_constraints(RANGE_SIGNAL, bits)
        except Exception as error:  # noqa: BLE001
            return [f"range_constraints raised {type(error).__name__}"]
        problem = _range_shape_problem(constraints, bits)
        if problem is not None:
            failures.append(problem)
            continue

        inside_ok = True
        for value in range(2**bits):
            try:
                witness = gadgets_module.range_witness(RANGE_SIGNAL, value, bits)
            except Exception as error:  # noqa: BLE001
                failures.append(f"range_witness raised {type(error).__name__}")
                inside_ok = False
                break
            assigned = witness.get(RANGE_SIGNAL) if isinstance(witness, dict) else None
            if isinstance(assigned, bool) or assigned != value:
                failures.append("range_witness does not assign `value` to the signal")
                inside_ok = False
                break
            try:
                residuals = [reference_evaluate(c, witness, p) for c in constraints]
            except ConstraintError as error:
                failures.append(f"range gadget: {error}")
                inside_ok = False
                break
            if any(residuals):
                failures.append(
                    "for a value inside the range, the witness from range_witness"
                    " leaves a constraint non-zero"
                )
                inside_ok = False
                break
        if not inside_ok:
            continue

        for probe in range_probe_values(seed, label):
            try:
                admitted = has_assignment(constraints, {RANGE_SIGNAL: probe}, p)
            except SearchBudgetExceeded:
                failures.append(
                    "the search over auxiliary signals exceeded its budget;"
                    " use fewer free auxiliary signals"
                )
                break
            except ConstraintError as error:
                failures.append(f"range gadget: {error}")
                break
            if admitted:
                failures.append("the range gadget admits a value outside 0 .. 2^bits - 1")
                break
    return failures


def run(field_module, circuit_module, gadgets_module, seed: str) -> list[str]:
    return [
        *check_normalize(field_module, seed),
        *check_residuals(circuit_module, field_module, seed),
        *check_order_independence(circuit_module, field_module, seed),
        *check_missing_signal(circuit_module, field_module, seed),
        *check_boolean(gadgets_module, seed),
        *check_membership(gadgets_module, seed),
        *check_range(gadgets_module, seed),
    ]
