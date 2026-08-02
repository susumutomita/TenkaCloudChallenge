"""The residual evaluator, as the audit tool would compute it.

This is the thing the learner is building an understanding of, so it is worth
being explicit about what it does and does not do for them. It computes a
residual from a constraint and a witness -- and the participant never calls it on
their own answer. `audit trace` grades the numbers they worked out by hand against
what this returns; `audit explain` renders a constraint's residual with its
operand *names* substituted and no values, which is the shape of the arithmetic
rather than its result.

A residual is a field element. Every function here reduces into [0, p), because
-1 and p-1 are the same element and an evaluator that returns the raw subtraction
is right until an intermediate value goes negative.
"""

from __future__ import annotations


class MissingSignal(KeyError):
    """A constraint named a signal the witness does not assign."""


def _get(witness: dict[str, int], constraint: dict, key: str) -> int:
    name = str(constraint[key])
    if name not in witness:
        raise MissingSignal(name)
    return witness[name]


def residual(constraint: dict, witness: dict[str, int], p: int) -> int:
    """The value this constraint claims is zero, reduced into [0, p)."""
    kind = constraint["kind"]
    if kind == "const":
        return (_get(witness, constraint, "signal") - int(constraint["value"])) % p  # type: ignore[arg-type]
    if kind == "boolean":
        value = _get(witness, constraint, "signal")
        return (value * (value - 1)) % p
    if kind == "mul":
        return (
            _get(witness, constraint, "left") * _get(witness, constraint, "right")
            - _get(witness, constraint, "out")
        ) % p
    if kind == "add":
        return (
            _get(witness, constraint, "left") + _get(witness, constraint, "right")
            - _get(witness, constraint, "out")
        ) % p
    if kind == "member":
        value = _get(witness, constraint, "signal")
        product = 1
        for allowed in constraint["allowed"]:  # type: ignore[union-attr]
            product = (product * (value - int(allowed))) % p
        return product % p
    raise ValueError(f"unknown constraint kind: {kind}")


def trace(circuit: list[dict], witness: dict[str, int], p: int) -> list[int]:
    """One residual per constraint, in circuit order. What `audit trace` is graded on."""
    return [residual(constraint, witness, p) for constraint in circuit]


def formula(constraint: dict) -> str:
    """The constraint's residual with its operands named -- never their values.

    What `audit explain` prints. It restates which expression has to come out zero
    for one constraint, which is the step a wrong trace is usually stuck on, and it
    is not an oracle: everything in the returned string is already in the circuit
    dump `audit show` prints.
    """
    kind = constraint["kind"]
    if kind == "const":
        return f"{constraint['signal']} - {constraint['value']}"
    if kind == "boolean":
        signal = constraint["signal"]
        return f"{signal} * ({signal} - 1)"
    if kind == "mul":
        return f"{constraint['left']} * {constraint['right']} - {constraint['out']}"
    if kind == "add":
        return f"{constraint['left']} + {constraint['right']} - {constraint['out']}"
    if kind == "member":
        signal = constraint["signal"]
        return " * ".join(f"({signal} - {allowed})" for allowed in constraint["allowed"])  # type: ignore[union-attr]
    raise ValueError(f"unknown constraint kind: {kind}")
