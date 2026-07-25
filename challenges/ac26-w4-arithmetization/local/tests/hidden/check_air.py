"""Hidden tests. Run by /verify against a copy of the learner's air.py.

Two things are checked that a working-looking implementation usually gets wrong: the
NUMBER of transition residuals (one per adjacent pair, not one per row), and which row a
violation is attributed to (the transition out of row i breaks row i+1).
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    domain,
    honest_trace,
    setting,
    tampered_trace,
)

LABELS = ("h0", "h1", "h2")


def check_trace(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        try:
            trace = module.execute(dict(cfg))
        except Exception as error:  # noqa: BLE001
            return [f"running the machine raised {type(error).__name__}"]
        want = honest_trace(cfg)
        if not isinstance(trace, list) or len(trace) != cfg["steps"]:
            failures.append("the trace does not have one row per step")
            continue
        if [tuple(row) for row in trace] != want:
            failures.append("the trace is not what the machine produces")
    return failures


def check_transition(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        trace = honest_trace(cfg)
        try:
            residuals = module.transition_residuals(list(trace), dict(cfg))
        except Exception as error:  # noqa: BLE001
            return [f"evaluating the transition residuals raised {type(error).__name__}"]
        # One per adjacent pair. A residual per row means the last row was compared
        # against a row that does not exist.
        if not isinstance(residuals, list) or len(residuals) != cfg["steps"] - 1:
            failures.append("there is not one transition residual per adjacent row pair")
            continue
        if any(any(value % cfg["p"] != 0 for value in pair) for pair in residuals):
            failures.append("an honest trace has a non-zero transition residual")
            continue
        broken, index = tampered_trace(seed, label, cfg)
        after = module.transition_residuals(list(broken), dict(cfg))
        nonzero = [
            position
            for position, pair in enumerate(after)
            if any(value % cfg["p"] != 0 for value in pair)
        ]
        if not nonzero:
            failures.append("a tampered trace has no non-zero transition residual")
        elif min(nonzero) != index - 1:
            failures.append("the first non-zero residual is not at the tampered step")
    return failures


def check_boundary(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        trace = [list(row) for row in honest_trace(cfg)]
        try:
            residuals = module.boundary_residuals([tuple(row) for row in trace], dict(cfg))
        except Exception as error:  # noqa: BLE001
            return [f"evaluating the boundary residuals raised {type(error).__name__}"]
        if not isinstance(residuals, list) or not residuals:
            failures.append("there are no boundary residuals")
            continue
        if any(value % cfg["p"] != 0 for value in residuals):
            failures.append("an honest trace has a non-zero boundary residual")
            continue
        moved = [tuple(row) for row in trace]
        moved[0] = ((moved[0][0] + 1) % cfg["p"], moved[0][1])
        if all(value % cfg["p"] == 0 for value in module.boundary_residuals(moved, dict(cfg))):
            failures.append("moving the starting state left every boundary residual at zero")
    return failures


def check_interpolate(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        p = cfg["p"]
        points = domain(cfg)
        trace = honest_trace(cfg)
        try:
            polynomials = module.column_polynomials(list(trace), list(points), p)
        except Exception as error:  # noqa: BLE001
            return [f"interpolating raised {type(error).__name__}"]
        if not isinstance(polynomials, list) or len(polynomials) != 2:
            failures.append("there is not one polynomial per trace column")
            continue
        wrong = False
        for column, coefficients in enumerate(polynomials):
            if any(not isinstance(value, int) or not 0 <= value < p for value in coefficients):
                failures.append("a coefficient is not a canonical field element")
                wrong = True
                break
            for index, x in enumerate(points):
                if module.evaluate(list(coefficients), x, p) % p != trace[index][column]:
                    failures.append("a polynomial does not agree with its column on the domain")
                    wrong = True
                    break
            if wrong:
                break
        if wrong:
            continue
        # Off the domain it must still be a polynomial, not a lookup table: evaluating
        # by Horner and by the definition have to agree.
        outside = next(x for x in range(1, p) if x not in points)
        for coefficients in polynomials:
            direct = sum(c * pow(outside, degree, p) for degree, c in enumerate(coefficients)) % p
            if module.evaluate(list(coefficients), outside, p) % p != direct:
                failures.append("evaluation disagrees with the coefficients off the domain")
                break
    return failures


def check_compose(module, seed: str) -> list[str]:
    """The bridge: the residuals, recomputed through the polynomials, still vanish.

    This is the step where "the table is right" becomes "the polynomial relation holds
    on the domain", and it is where a wrong domain-to-row mapping shows up.
    """
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        p, steps, weight = cfg["p"], cfg["steps"], cfg["weight"]
        points = domain(cfg)
        trace = honest_trace(cfg)
        polynomials = module.column_polynomials(list(trace), list(points), p)
        if not isinstance(polynomials, list) or len(polynomials) != 2:
            failures.append("there is not one polynomial per trace column")
            continue
        broke = False
        for index in range(steps - 1):
            x, next_x = points[index], points[index + 1]
            a = module.evaluate(list(polynomials[0]), x, p)
            b = module.evaluate(list(polynomials[1]), x, p)
            next_a = module.evaluate(list(polynomials[0]), next_x, p)
            next_b = module.evaluate(list(polynomials[1]), next_x, p)
            if ((a + b) - next_a) % p != 0 or ((b + weight * a) - next_b) % p != 0:
                failures.append("the transition relation does not vanish on the domain")
                broke = True
                break
        if broke:
            continue
    return failures


def check_locate(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        honest = honest_trace(cfg)
        try:
            if module.first_violation(list(honest), dict(cfg)) is not None:
                failures.append("an honest trace was reported as violating something")
                continue
        except Exception as error:  # noqa: BLE001
            return [f"locating a violation raised {type(error).__name__}"]

        broken, index = tampered_trace(seed, label, cfg)
        found = module.first_violation(list(broken), dict(cfg))
        if not isinstance(found, dict):
            failures.append("a tampered trace was reported as honest")
            continue
        if found.get("row") != index:
            failures.append("the violation was not located at the first row that is wrong")
        if found.get("kind") != "transition":
            failures.append("a tampered middle row was not reported as a transition failure")

        # Row 0 has no predecessor, so a wrong start is a boundary failure and not a
        # transition one. Calling it a transition failure points at the wrong place.
        moved = list(honest)
        moved[0] = ((moved[0][0] + 1) % cfg["p"], moved[0][1])
        found = module.first_violation(moved, dict(cfg))
        if not isinstance(found, dict) or found.get("row") != 0:
            failures.append("a wrong starting state was not located at row 0")
        elif found.get("kind") != "boundary":
            failures.append("a wrong starting state was not reported as a boundary failure")
    return failures


def check_underconstrained(module, seed: str) -> list[str]:
    """The counterexample: valid polynomials, wrong statement."""
    failures: list[str] = []
    for label in LABELS:
        cfg = setting(seed, label)
        try:
            witness = module.underconstrained_witness(dict(cfg))
        except Exception as error:  # noqa: BLE001
            return [f"building the witness raised {type(error).__name__}"]
        if not isinstance(witness, dict) or "trace" not in witness:
            failures.append("no witness trace was produced")
            continue
        trace = [tuple(row) for row in witness["trace"]]
        if len(trace) != cfg["steps"]:
            failures.append("the witness trace does not have one row per step")
            continue
        if trace == honest_trace(cfg):
            failures.append("the witness is the honest trace, which demonstrates nothing")
            continue
        p, weight = cfg["p"], cfg["weight"]
        for index in range(len(trace) - 1):
            a, b = trace[index]
            next_a, next_b = trace[index + 1]
            if ((a + b) - next_a) % p != 0 or ((b + weight * a) - next_b) % p != 0:
                failures.append("the witness does not satisfy the transition constraints")
                break
        else:
            start_a, start_b = cfg["start"]
            if (trace[0][0] - start_a) % p == 0 and (trace[0][1] - start_b) % p == 0:
                failures.append("the witness starts where the real computation starts")
            if witness.get("constraint_dropped") != "boundary":
                failures.append("the witness does not name the constraint that had to be missing")
    return failures


def run(module, seed: str) -> list[str]:
    return [
        *check_trace(module, seed),
        *check_transition(module, seed),
        *check_boundary(module, seed),
        *check_interpolate(module, seed),
        *check_compose(module, seed),
        *check_locate(module, seed),
        *check_underconstrained(module, seed),
    ]
