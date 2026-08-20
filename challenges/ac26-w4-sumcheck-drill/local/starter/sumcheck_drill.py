"""Scratchpad for the twelve lines — optional, for when you cannot open Python.

The drill is meant to be typed into your own `python3`, one line at a time, after pasting
the numbers from inspect. If you cannot open Python, fill in these twelve functions in the
Portal editor instead and press "run the public tests": the test prints what YOUR
functions return on THIS deployment's numbers — exactly what the REPL would have printed.
Paste those values into the answer fields. Each answer field is a single-line input.

Each function is one drill line, with the line's names replaced by parameters. y0, y1 are
the two layer values; (c0, c1, c2) and (b1, b2) are the prover's two messages; r1, r2 the
verifier's random points; d, m the lying prover's fudge parameters.
"""

from __future__ import annotations


def layer(x1: int, x2: int, x3: int, x4: int, p: int) -> tuple:
    """Line 1 — (y0, y1, output): the addition gate, the multiplication gate, their sum."""
    return None


def w1(y0: int, y1: int, z: int, p: int) -> int:
    """Line 2 (part 1) — the table {0: y0, 1: y1} stretched into a line, at z."""
    return None


def mle3(y0: int, y1: int, p: int) -> tuple:
    """Line 2 (part 2) — (W1(0), W1(1), W1(2))."""
    return None


def g0(y0: int, y1: int, a: int, b: int, p: int) -> int:
    """Line 3 (part 1) — the wired gate: (1-a)*b*(W1(a)+W1(b))."""
    return None


def grid(y0: int, y1: int, p: int) -> tuple:
    """Line 3 (part 2) — g0 on the four grid points."""
    return None


def grid_total(y0: int, y1: int, p: int) -> int:
    """Line 4 — the four-term sum the verifier does not want to compute."""
    return None


def p1_sum(c0: int, c1: int, c2: int, p: int) -> int:
    """Line 5 — the received p1's two-point sum, p1(0) + p1(1)."""
    return None


def round1(c0: int, c1: int, c2: int, r1: int, p: int) -> int:
    """Line 7 — p1 evaluated at the verifier's random r1: the next round's claim."""
    return None


def p2_sum(b1: int, b2: int, p: int) -> int:
    """Line 8 — the received p2's two-point sum, p2(0) + p2(1)."""
    return None


def final_check(y0: int, y1: int, b1: int, b2: int, r1: int, r2: int, p: int) -> tuple:
    """Line 9 — (prover's p2 at r2, the verifier's own g0(r1, r2))."""
    return None


def lie(c0: int, c1: int, c2: int, d: int, r1: int, p: int) -> tuple:
    """Line 10 — the inflated p1' = p1 + d*(1-t): (its two-point sum, its value at r1)."""
    return None


def lie_caught(
    c0: int, c1: int, c2: int, b1: int, b2: int,
    d: int, m: int, r1: int, r2: int, y0: int, y1: int, p: int,
) -> tuple:
    """Line 11 — the doctored p2': (its two-point sum, p2'(r2), the verifier's g0)."""
    return None


def miss_points(
    c0: int, c1: int, c2: int, b1: int, b2: int,
    d: int, m: int, r1: int, y0: int, y1: int, p: int,
) -> list:
    """Line 12 — every r2 at which the doctored p2' agrees with the truth."""
    return None
