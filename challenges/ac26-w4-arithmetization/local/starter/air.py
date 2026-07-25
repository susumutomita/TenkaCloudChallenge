"""The only file you edit.

"Proving a program ran" does not put the program into the proof. It turns the program's
execution into a table, the table's rules into polynomial relations, and the claim into
"these relations vanish on these points".

The machine is two columns and two rules:

    a_{i+1} = a_i + b_i          (mod p)
    b_{i+1} = b_i + weight*a_i   (mod p)

That is the whole computation. What matters is the translation, and whether the
translation loses anything.

There are two kinds of constraint and they do different jobs. Transition constraints say
each row follows from the one before it. Boundary constraints say where the machine
started. Neither implies the other, and a system with only the first is satisfied by a
trace of the same machine started from somewhere else entirely.

`fixtures.generate` gives you the setting, the evaluation domain, and the traces.
"""

from __future__ import annotations


def execute(setting: dict) -> list[tuple[int, int]]:
    """Run the machine and return the trace: one (a, b) row per step."""
    return []


def transition_residuals(trace: list[tuple[int, int]], setting: dict) -> list[tuple[int, int]]:
    """"What the next row should have been, minus what it is", per adjacent row pair.

    Count them before you write this. It is not the number of rows.
    """
    return []


def boundary_residuals(trace: list[tuple[int, int]], setting: dict) -> list[int]:
    """The constraints that pin the trace to this computation rather than that one."""
    return []


def interpolate(values: list[int], points: list[int], p: int) -> list[int]:
    """The unique polynomial through (points[i], values[i]), over F_p.

    Return coefficients, lowest degree first. Field arithmetic — division is by modular
    inverse, and there is a reason `points` are distinct.
    """
    return []


def evaluate(coefficients: list[int], x: int, p: int) -> int:
    """That polynomial at x."""
    return 0


def column_polynomials(trace: list[tuple[int, int]], points: list[int], p: int) -> list[list[int]]:
    """One polynomial per column, agreeing with the column on the domain."""
    return []


def first_violation(trace: list[tuple[int, int]], setting: dict) -> dict | None:
    """The first row where a constraint breaks, or None if the trace is honest.

    Return {"row": int, "kind": "transition" | "boundary"}.

    Row 0 has no predecessor. Think about which kind of constraint can fail there, and
    which cannot.
    """
    return None


def underconstrained_witness(setting: dict) -> dict:
    """A trace satisfying every TRANSITION constraint that is not this computation.

    Return {"trace": [...], "constraint_dropped": "..."}.

    You are demonstrating that the transition constraints, on their own, do not say what
    they appear to say. Name which constraint had to be missing for your trace to pass.
    """
    return {}
