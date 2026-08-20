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
    o0 = (a0 + b0) % p
    o1 = (a1 * b1) % p
    return (o0, o1, (o0 + o1) % p)


def gate_eq(rows: list, p: int) -> tuple:
    """Line 2 — the gate equation on every row (0 means the row fits its type)."""
    return tuple(
        (ql * L + qr * R + qm * L * R + qo * O + qc) % p
        for (L, R, O), (ql, qr, qm, qo, qc) in zip(rows, SELECTORS)
    )


def copy_check(rows: list) -> tuple:
    """Line 3 — the two wires: gate 0's O vs gate 2's L, gate 1's O vs gate 2's R."""
    return (rows[0][2] == rows[2][0], rows[1][2] == rows[2][1])


def bad_row(o0: int, o1: int, g: int, p: int) -> tuple:
    """Line 4 — gate 2 shifted by g: gates still pass, the wire breaks."""
    return ((o0 + g) % p, o1, (o0 + g + o1) % p)


def bad_passes(rows: list, bad: list, p: int) -> tuple:
    """Line 5 — (gate equation on the lying table, its two wires)."""
    return (gate_eq(bad, p), copy_check(bad))


def addresses(w: int, q: int) -> tuple:
    """Line 6 — ω^row · (col + 1) for the nine cells, row-major."""
    return tuple((pow(w, r, q) * (c + 1)) % q for r in range(3) for c in range(3))


def sigma_addresses(w: int, q: int) -> tuple:
    """Line 7 — the same nine addresses, re-attached through σ."""
    return tuple(
        (pow(w, SIGMA[(c, r)][1], q) * (SIGMA[(c, r)][0] + 1)) % q
        for r in range(3)
        for c in range(3)
    )


def marks3(rows: list, w: int, q: int, beta: int, gamma: int) -> tuple:
    """Line 8 — the first three fingerprints (value + β·address + γ) of the honest table."""
    vals = [v for row in rows for v in row]
    addr = addresses(w, q)
    return tuple((v + beta * a + gamma) % q for v, a in zip(vals[:3], addr[:3]))


def grand_product(rows: list, w: int, q: int, beta: int, gamma: int) -> tuple:
    """Line 9 — (product over raw addresses, product over σ-permuted addresses)."""
    vals = [v for row in rows for v in row]
    f = math.prod((v + beta * a + gamma) % q for v, a in zip(vals, addresses(w, q))) % q
    fs = math.prod((v + beta * a + gamma) % q for v, a in zip(vals, sigma_addresses(w, q))) % q
    return (f, fs)


def bad_product(bad: list, w: int, q: int, beta: int, gamma: int) -> tuple:
    """Line 10 — the same two products on the lying table."""
    return grand_product(bad, w, q, beta, gamma)


def multiset(rows: list, bad: list, w: int, q: int) -> tuple:
    """Line 11 — does the set of (value, address) pairs survive σ? (honest, lying)."""
    vals = [v for row in rows for v in row]
    vb = [v for row in bad for v in row]
    addr = addresses(w, q)
    saddr = sigma_addresses(w, q)
    return (
        set(zip(vals, saddr)) == set(zip(vals, addr)),
        set(zip(vb, saddr)) == set(zip(vb, addr)),
    )


def miss_count(bad: list, w: int, q: int) -> int:
    """Line 12 — how many (β, γ) pairs let the lying table's two products coincide."""
    vb = [v for row in bad for v in row]
    addr = addresses(w, q)
    saddr = sigma_addresses(w, q)
    count = 0
    for b in range(1, q):
        for c in range(q):
            f = math.prod((v + b * a + c) % q for v, a in zip(vb, addr)) % q
            fs = math.prod((v + b * a + c) % q for v, a in zip(vb, saddr)) % q
            if f == fs:
                count += 1
    return count
