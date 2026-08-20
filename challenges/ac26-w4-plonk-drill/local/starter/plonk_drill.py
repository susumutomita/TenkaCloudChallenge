"""Scratchpad for the twelve lines — optional, for when you cannot open Python.

The drill is meant to be typed into your own `python3`, one line at a time, after pasting
the numbers from inspect. If you cannot open Python, fill in these twelve functions in the
Portal editor instead and press "run the public tests": the test prints what YOUR
functions return on THIS deployment's numbers — exactly what the REPL would have printed.
Paste those values into the answer fields. Each answer field is a single-line input.

Each function is one drill line, with the line's names replaced by parameters. `rows` is
the honest gate table [(L, R, O), …]; `bad` is the lying one; w, q address the cells;
beta, gamma are the verifier's randomness.
"""

from __future__ import annotations

import math

SIGMA = {
    (0, 0): (0, 0), (1, 0): (1, 0), (2, 0): (0, 2),
    (0, 1): (0, 1), (1, 1): (1, 1), (2, 1): (1, 2),
    (0, 2): (2, 0), (1, 2): (2, 1), (2, 2): (2, 2),
}
SELECTORS = [(1, 1, 0, -1, 0), (0, 0, 1, -1, 0), (1, 1, 0, -1, 0)]


def outputs(a0: int, b0: int, a1: int, b1: int, p: int) -> tuple:
    """Line 1 — (o0, o1, o2): the three gate outputs."""
    return None


def gate_eq(rows: list, p: int) -> tuple:
    """Line 2 — the gate equation on every row (0 means the row fits its type)."""
    return None


def copy_check(rows: list) -> tuple:
    """Line 3 — the two wires: gate 0's O vs gate 2's L, gate 1's O vs gate 2's R."""
    return None


def bad_row(o0: int, o1: int, g: int, p: int) -> tuple:
    """Line 4 — gate 2 shifted by g: gates still pass, the wire breaks."""
    return None


def bad_passes(rows: list, bad: list, p: int) -> tuple:
    """Line 5 — (gate equation on the lying table, its two wires)."""
    return None


def addresses(w: int, q: int) -> tuple:
    """Line 6 — ω^row · (col + 1) for the nine cells, row-major."""
    return None


def sigma_addresses(w: int, q: int) -> tuple:
    """Line 7 — the same nine addresses, re-attached through σ."""
    return None


def marks3(rows: list, w: int, q: int, beta: int, gamma: int) -> tuple:
    """Line 8 — the first three fingerprints (value + β·address + γ) of the honest table."""
    return None


def grand_product(rows: list, w: int, q: int, beta: int, gamma: int) -> tuple:
    """Line 9 — (product over raw addresses, product over σ-permuted addresses)."""
    return None


def bad_product(bad: list, w: int, q: int, beta: int, gamma: int) -> tuple:
    """Line 10 — the same two products on the lying table."""
    return None


def multiset(rows: list, bad: list, w: int, q: int) -> tuple:
    """Line 11 — does the set of (value, address) pairs survive σ? (honest, lying)."""
    return None


def miss_count(bad: list, w: int, q: int) -> int:
    """Line 12 — how many (β, γ) pairs let the lying table's two products coincide."""
    return None
