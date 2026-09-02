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
  - a range gadget admits 0 .. 2**bits - 1 with the submission's own witness, and the
    set of values it admits under *any* assignment of its auxiliary signals -- computed
    exactly by enumerating every solution of its constraints, never by sampling a few
    values outside the range -- is that range and nothing more

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
#: Assignments the auxiliary-signal search may try for one width -- the enumeration of
#: every solution and, if that has to fall back, the value-by-value decisions together
#: -- before it gives up. Decomposition gadgets need a few thousand at most (2**bits
#: leaves); a gadget that leaves many signals free is reported against this budget
#: rather than against a wall clock, so the verdict is deterministic.
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

    # The crux the statement names: a residual is a number of the remainder world, so
    # evaluate must return it normalized. trace rows are compared after normalizing (a
    # trace that rounds them is still a trace), but evaluate itself is probed on three
    # constraints whose raw subtraction is negative.
    p = field_modulus(seed, "h0")
    f = _field(field_module, p)
    probes = [
        ({"id": "n1", "kind": "const", "signal": "x", "value": 5}, {"x": 2}),
        ({"id": "n2", "kind": "add", "left": "a", "right": "b", "out": "c"}, {"a": 1, "b": 1, "c": 5}),
        ({"id": "n3", "kind": "mul", "left": "a", "right": "b", "out": "c"}, {"a": 2, "b": 3, "c": p - 1}),
    ]
    for constraint, witness in probes:
        try:
            got = circuit_module.evaluate(constraint, witness, f)
        except Exception as error:  # noqa: BLE001
            failures.append(f"evaluate raised {type(error).__name__}")
            break
        if isinstance(got, bool) or not isinstance(got, int) or got != reference_evaluate(constraint, witness, p):
            failures.append("a residual is not an integer in 0 .. p-1")
            break
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


class _Undetermined(Exception):
    """Every remaining constraint has two or more unassigned signals, so no value can be
    read off in closed form; the admitted set has to be decided value by value."""


class _SignalSearch:
    """Exact backtracking over a gadget's signals, driven by its single-unknown constraints.

    At each step the constraint with the fewest unassigned signals is chosen (ties go to
    list order). When it has exactly one, the values to try come from `_candidates`:
    {0, 1} for a boolean, one value for a const or a single-occurrence add / mul, every
    field element for a mul whose known factor is zero. A decomposition gadget therefore
    branches only at its digits and propagates everything else. Every constraint is
    checked the moment its last signal is assigned, so a leaf is a genuine solution.

    One instance serves one width: the assignments it tries -- across `admitted_values`
    and every `has_assignment` call -- are counted against a single budget, and
    `SearchBudgetExceeded` is raised instead of running past it. A gadget that leaves
    many signals free is reported against that budget rather than against a wall clock,
    so the verdict is deterministic.
    """

    def __init__(self, constraints: list[dict], p: int, budget: int) -> None:
        self.constraints = constraints
        self.p = p
        self.budget = budget
        self.tried = 0
        self.signals = [list(dict.fromkeys(constraint_signals(c))) for c in constraints]
        self.by_signal: dict[str, list[int]] = {}
        for index, names in enumerate(self.signals):
            for name in names:
                self.by_signal.setdefault(name, []).append(index)
        self.assignment: dict[str, int] = {}
        self.unknown = [len(names) for names in self.signals]

    def _reset(self, fixed: dict[str, int]) -> bool:
        """Start over from `fixed`; False when `fixed` alone already breaks a constraint."""
        self.assignment = {}
        self.unknown = [len(names) for names in self.signals]
        for name, value in fixed.items():
            self._assign(name, value % self.p)
        return all(self._holds(name) for name in fixed)

    def _assign(self, name: str, value: int) -> None:
        self.assignment[name] = value
        for index in self.by_signal.get(name, ()):
            self.unknown[index] -= 1

    def _unassign(self, name: str) -> None:
        del self.assignment[name]
        for index in self.by_signal.get(name, ()):
            self.unknown[index] += 1

    def _holds(self, name: str) -> bool:
        """Every constraint on `name` whose signals are all assigned has residual zero."""
        for index in self.by_signal.get(name, ()):
            if self.unknown[index] == 0 and reference_evaluate(self.constraints[index], self.assignment, self.p) != 0:
                return False
        return True

    def _pick(self) -> int | None:
        """The constraint with the fewest -- but some -- unassigned signals, or None."""
        best: int | None = None
        for index, count in enumerate(self.unknown):
            if count and (best is None or count < self.unknown[best]):
                best = index
                if count == 1:
                    break
        return best

    def _free(self, index: int) -> list[str]:
        return [name for name in self.signals[index] if name not in self.assignment]

    def _try(self, name: str, value: int) -> bool:
        """Assign one value, counting it against the budget; False when it breaks something."""
        self.tried += 1
        if self.tried > self.budget:
            raise SearchBudgetExceeded
        self._assign(name, value)
        return self._holds(name)

    def has_assignment(self, fixed: dict[str, int]) -> bool:
        """Whether some assignment of the unfixed signals satisfies every constraint.

        A constraint with two or more unassigned signals is branched over every field
        element of one of them, which is exact and bounded only by the budget.
        """
        return self._reset(fixed) and self._any()

    def _any(self) -> bool:
        index = self._pick()
        if index is None:
            return True
        free = self._free(index)
        target = free[0]
        candidates = (
            _candidates(self.constraints[index], self.assignment, target, self.p)
            if len(free) == 1
            else range(self.p)
        )
        for value in candidates:
            if self._try(target, value) and self._any():
                return True
            self._unassign(target)
        return False

    def admitted_values(self, signal: str, expected: set[int]) -> set[int]:
        """Every value `signal` takes in some solution, by enumerating all of them.

        Stops as soon as a value outside `expected` turns up (the result then contains
        it, and is otherwise partial). A signal no constraint mentions is free, so it
        admits the whole field. Raises `_Undetermined` when a branch runs out of
        single-unknown constraints before every signal is assigned.
        """
        self._reset({})
        admitted: set[int] = set()
        self._all(signal, expected, admitted)
        return admitted

    def _all(self, signal: str, expected: set[int], admitted: set[int]) -> bool:
        """Collect into `admitted`; False means stop, an unexpected value was found."""
        index = self._pick()
        if index is None:
            if signal not in self.assignment:
                admitted.update(range(self.p))
                return False
            admitted.add(self.assignment[signal])
            return self.assignment[signal] in expected
        free = self._free(index)
        if len(free) > 1:
            raise _Undetermined
        target = free[0]
        for value in _candidates(self.constraints[index], self.assignment, target, self.p):
            keep_going = True
            if self._try(target, value):
                keep_going = self._all(signal, expected, admitted)
            self._unassign(target)
            if not keep_going:
                return False
        return True


def admitted_range_values(constraints: list[dict], bits: int, p: int, budget: int = SEARCH_BUDGET) -> set[int]:
    """The set of values the gadget lets RANGE_SIGNAL take, exactly, or a set that
    contains one value outside 0 .. 2**bits - 1 as soon as one is found.

    First the set is read off the constraints themselves: every solution of the gadget
    is enumerated by branching at the boolean-pinned signals and propagating the add /
    mul / const constraints in closed form, and the signal's value at each leaf is
    collected. That is the whole answer for a decomposition gadget (2**bits leaves).
    When some branch leaves a signal that no single constraint pins, the same search
    instead decides each value of the field on its own -- every value in 2**bits ..
    p - 1 first, then the in-range ones -- with the signal fixed to it. Both paths
    share one budget; `SearchBudgetExceeded` propagates when it runs out.
    """
    inside = set(range(2**bits))
    search = _SignalSearch(constraints, p, budget)
    try:
        return search.admitted_values(RANGE_SIGNAL, inside)
    except _Undetermined:
        pass
    admitted: set[int] = set()
    for value in [*range(2**bits, p), *range(2**bits)]:
        if search.has_assignment({RANGE_SIGNAL: value}):
            admitted.add(value)
            if value not in inside:
                break
    return admitted


def check_range(gadgets_module, seed: str) -> list[str]:
    """The range gadget, by the documented rules, on three widths.

    (1) shape: only boolean / add / mul / const, at most 5 x bits constraints;
    (2) every value in 0 .. 2**bits - 1 satisfies the gadget with the witness the
        submission's own `range_witness` returns for it;
    (3) the set of values the gadget admits under any assignment of its auxiliary
        signals -- computed exactly, see `admitted_range_values` -- is 0 .. 2**bits - 1
        and nothing else. Every field element outside the range is covered, never a
        sample of them.
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

        try:
            admitted = admitted_range_values(constraints, bits, p)
        except SearchBudgetExceeded:
            failures.append(
                "the search over auxiliary signals exceeded its budget;"
                " use fewer free auxiliary signals"
            )
            continue
        except ConstraintError as error:
            failures.append(f"range gadget: {error}")
            continue
        inside = set(range(2**bits))
        if admitted - inside:
            failures.append("the range gadget admits a value outside 0 .. 2^bits - 1")
        elif inside - admitted:
            # Unreachable once (2) passed -- the witness is itself a solution for every
            # in-range value and the enumeration is complete -- kept so a checker
            # defect would surface as a failure rather than a silent pass.
            failures.append("the range gadget does not admit every value inside 0 .. 2^bits - 1")
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
