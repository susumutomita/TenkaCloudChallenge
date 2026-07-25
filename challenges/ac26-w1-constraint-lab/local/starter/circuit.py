"""Constraint evaluation and traces. One of the three files you edit.

A constraint is a claim that an expression equals zero. Evaluating it gives the
*residual*: zero means satisfied, anything else means broken. A circuit is satisfied
by a witness exactly when every residual is zero.
"""

from __future__ import annotations

from field import Field


def evaluate(constraint: dict, witness: dict[str, int], field: Field) -> int:
    """Return the residual of one constraint under one witness.

    Kinds you must handle:
      mul      left * right - out
      add      left + right - out
      const    signal - value
      boolean  signal * (signal - 1)
      member   product over constraint["allowed"] of (signal - a)

    A signal named in the constraint but missing from the witness is an error, not
    a zero. The starter returns zero for everything, which is the same as claiming
    every witness satisfies every circuit.
    """
    return 0


def trace(circuit: list[dict], witness: dict[str, int], field: Field) -> list[dict]:
    """Residual of every constraint, in circuit order.

    Return one entry per constraint: {"id": <constraint id>, "residual": <int>}.
    """
    return []


def first_broken(circuit: list[dict], witness: dict[str, int], field: Field) -> str | None:
    """The id of the first constraint whose residual is non-zero, or None."""
    return None
