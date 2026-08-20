"""Scratchpad for the twelve lines — optional, for when you cannot open Python.

The drill is meant to be typed into your own `python3`, one line at a time, after pasting
the numbers from inspect. If you cannot open Python, fill in these twelve functions in the
Portal editor instead and press "run the public tests": the test prints what YOUR
functions return on THIS deployment's numbers — exactly what the REPL would have printed.
Paste those values into the answer fields. Each answer field is a single-line input.

Each function is one drill line, with the line's names replaced by parameters. qs is the
coefficient tuple (q0, q1, q2, q3) of the committed Q₀; beta, beta2 the verifier's folding
challenges; x the query point; d0, d1 the dishonest fold's difference.
"""

from __future__ import annotations


def _q(qs: tuple, X: int, p: int) -> int:
    return None


def _qe(qs: tuple, Y: int, p: int) -> int:
    return None


def _qo(qs: tuple, Y: int, p: int) -> int:
    return None


def _q1(qs: tuple, beta: int, Y: int, p: int) -> int:
    return None


def poly3(qs: tuple, p: int) -> tuple:
    """Line 1 — the committed Q₀ at 0, 1, 2."""
    return None


def split(qs: tuple, p: int) -> tuple:
    """Line 2 — the even and odd parts at Y = 1."""
    return None


def identity_holds(qs: tuple, p: int) -> bool:
    """Line 3 — Q₀(X) = Q_even(X²) + X·Q_odd(X²) at every point."""
    return None


def fold(qs: tuple, beta: int, p: int) -> tuple:
    """Line 4 — Q₁ = Q_even + β·Q_odd at 0, 1, 2."""
    return None


def fold2(qs: tuple, beta: int, beta2: int, p: int) -> int:
    """Line 5 — fold Q₁ once more: the constant c + β₂·d."""
    return None


def query(qs: tuple, x: int, p: int) -> tuple:
    """Line 6 — the two openings (Q₀(x), Q₀(−x))."""
    return None


def recover(qs: tuple, x: int, p: int) -> tuple:
    """Line 7 — (re, ro, Q_even(x²), Q_odd(x²)): both halves from the two openings."""
    return None


def consistency(qs: tuple, beta: int, x: int, p: int) -> tuple:
    """Line 8 — (re + β·ro, Q₁(x²)): the query check, honest side."""
    return None


def cheat(qs: tuple, beta: int, d0: int, d1: int, p: int) -> tuple:
    """Line 9 — the swapped Q₁′ = Q₁ + d0 + d1·Y at 0 and 1."""
    return None


def cheat_caught(qs: tuple, beta: int, x: int, d0: int, d1: int, p: int) -> tuple:
    """Line 10 — (re + β·ro, Q₁′(x²)): the query check against the swapped commitment."""
    return None


def miss_points(d0: int, d1: int, p: int) -> list:
    """Line 11 — every x where the swap's gap d0 + d1·x² vanishes."""
    return None


def honest_all(qs: tuple, beta: int, p: int) -> list:
    """Line 12 — every x where the HONEST fold fails the query check (none)."""
    return None
