"""Reference solution. Inside the image only; never mounted to the host."""

from __future__ import annotations


def execute(setting: dict) -> list[tuple[int, int]]:
    p, steps, weight = setting["p"], setting["steps"], setting["weight"]
    a, b = setting["start"]
    rows = [(a % p, b % p)]
    for _ in range(steps - 1):
        a, b = (a + b) % p, (b + weight * a) % p
        rows.append((a, b))
    return rows


def transition_residuals(trace: list[tuple[int, int]], setting: dict) -> list[tuple[int, int]]:
    """One residual pair per ADJACENT ROW PAIR, so steps-1 of them, not steps.

    A residual is "what the next row should have been, minus what it is". Zero
    everywhere means every step of the machine was taken correctly.
    """
    p, weight = setting["p"], setting["weight"]
    out = []
    for index in range(len(trace) - 1):
        a, b = trace[index]
        next_a, next_b = trace[index + 1]
        out.append((((a + b) - next_a) % p, ((b + weight * a) - next_b) % p))
    return out


def boundary_residuals(trace: list[tuple[int, int]], setting: dict) -> list[int]:
    """The initial state, pinned.

    Transition constraints alone pin nothing: they say each row follows from the one
    before it, and are perfectly satisfied by a trace that starts somewhere else
    entirely. The boundary is what ties the polynomials to *this* computation.
    """
    p = setting["p"]
    start_a, start_b = setting["start"]
    return [(trace[0][0] - start_a) % p, (trace[0][1] - start_b) % p]


def interpolate(values: list[int], points: list[int], p: int) -> list[int]:
    """Lagrange interpolation over F_p, as coefficients, lowest degree first."""
    n = len(points)
    coefficients = [0] * n
    for index in range(n):
        basis = [1]
        denominator = 1
        for other in range(n):
            if other == index:
                continue
            basis = _mul(basis, [(-points[other]) % p, 1], p)
            denominator = denominator * (points[index] - points[other]) % p
        scale = values[index] * pow(denominator, -1, p) % p
        for degree, coefficient in enumerate(basis):
            coefficients[degree] = (coefficients[degree] + coefficient * scale) % p
    return coefficients


def _mul(left: list[int], right: list[int], p: int) -> list[int]:
    out = [0] * (len(left) + len(right) - 1)
    for i, a in enumerate(left):
        for j, b in enumerate(right):
            out[i + j] = (out[i + j] + a * b) % p
    return out


def evaluate(coefficients: list[int], x: int, p: int) -> int:
    total = 0
    for coefficient in reversed(coefficients):
        total = (total * x + coefficient) % p
    return total


def column_polynomials(trace: list[tuple[int, int]], points: list[int], p: int) -> list[list[int]]:
    """One polynomial per trace column, agreeing with the column on the domain."""
    return [
        interpolate([row[column] for row in trace], points, p)
        for column in range(len(trace[0]))
    ]


def first_violation(trace: list[tuple[int, int]], setting: dict) -> dict | None:
    """The first row where something breaks, and which kind of constraint broke.

    Boundary is checked first because row 0 has no predecessor: a wrong starting state
    is not a transition failure, and calling it one points at the wrong place.
    """
    if any(residual != 0 for residual in boundary_residuals(trace, setting)):
        return {"row": 0, "kind": "boundary"}
    for index, residual in enumerate(transition_residuals(trace, setting)):
        if any(value != 0 for value in residual):
            # The transition out of `index` produced row index+1, so that is the first
            # row that is wrong.
            return {"row": index + 1, "kind": "transition"}
    return None


def underconstrained_witness(setting: dict) -> dict:
    """A trace satisfying every TRANSITION constraint that is not the computation.

    Drop the boundary constraints and the system says nothing about where the machine
    started: any starting state generates a trace whose transitions all hold. The
    polynomials are just as valid. They are a proof of a different statement.
    """
    p = setting["p"]
    start_a, start_b = setting["start"]
    forged = dict(setting)
    forged["start"] = ((start_a + 1) % p, start_b)
    return {"trace": execute(forged), "constraint_dropped": "boundary"}
