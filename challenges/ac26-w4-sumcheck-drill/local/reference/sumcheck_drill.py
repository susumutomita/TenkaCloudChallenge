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
    y0 = (x1 + x2) % p
    y1 = (x3 * x4) % p
    return (y0, y1, (y0 + y1) % p)


def w1(y0: int, y1: int, z: int, p: int) -> int:
    """Line 2 (part 1) — the table {0: y0, 1: y1} stretched into a line, at z."""
    return (y0 * (1 - z) + y1 * z) % p


def mle3(y0: int, y1: int, p: int) -> tuple:
    """Line 2 (part 2) — (W1(0), W1(1), W1(2))."""
    return (w1(y0, y1, 0, p), w1(y0, y1, 1, p), w1(y0, y1, 2, p))


def g0(y0: int, y1: int, a: int, b: int, p: int) -> int:
    """Line 3 (part 1) — the wired gate: (1-a)*b*(W1(a)+W1(b))."""
    return ((1 - a) * b * (w1(y0, y1, a, p) + w1(y0, y1, b, p))) % p


def grid(y0: int, y1: int, p: int) -> tuple:
    """Line 3 (part 2) — g0 on the four grid points."""
    return (
        g0(y0, y1, 0, 0, p),
        g0(y0, y1, 0, 1, p),
        g0(y0, y1, 1, 0, p),
        g0(y0, y1, 1, 1, p),
    )


def grid_total(y0: int, y1: int, p: int) -> int:
    """Line 4 — the four-term sum the verifier does not want to compute."""
    return sum(g0(y0, y1, a, b, p) for a in (0, 1) for b in (0, 1)) % p


def p1_sum(c0: int, c1: int, c2: int, p: int) -> int:
    """Line 5 — the received p1's two-point sum, p1(0) + p1(1)."""
    p1 = lambda t: (c0 + c1 * t + c2 * t * t) % p  # noqa: E731
    return (p1(0) + p1(1)) % p


def round1(c0: int, c1: int, c2: int, r1: int, p: int) -> int:
    """Line 7 — p1 evaluated at the verifier's random r1: the next round's claim."""
    return (c0 + c1 * r1 + c2 * r1 * r1) % p


def p2_sum(b1: int, b2: int, p: int) -> int:
    """Line 8 — the received p2's two-point sum, p2(0) + p2(1)."""
    p2 = lambda t: (b1 * t + b2 * t * t) % p  # noqa: E731
    return (p2(0) + p2(1)) % p


def final_check(y0: int, y1: int, b1: int, b2: int, r1: int, r2: int, p: int) -> tuple:
    """Line 9 — (prover's p2 at r2, the verifier's own g0(r1, r2))."""
    p2 = lambda t: (b1 * t + b2 * t * t) % p  # noqa: E731
    return (p2(r2), g0(y0, y1, r1, r2, p))


def lie(c0: int, c1: int, c2: int, d: int, r1: int, p: int) -> tuple:
    """Line 10 — the inflated p1' = p1 + d*(1-t): (its two-point sum, its value at r1)."""
    p1c = lambda t: (c0 + c1 * t + c2 * t * t + d * (1 - t)) % p  # noqa: E731
    return ((p1c(0) + p1c(1)) % p, p1c(r1))


def lie_caught(
    c0: int, c1: int, c2: int, b1: int, b2: int,
    d: int, m: int, r1: int, r2: int, y0: int, y1: int, p: int,
) -> tuple:
    """Line 11 — the doctored p2': (its two-point sum, p2'(r2), the verifier's g0)."""
    p2 = lambda t: (b1 * t + b2 * t * t) % p  # noqa: E731
    fake_claim = lie(c0, c1, c2, d, r1, p)[1]
    sh = (fake_claim - (p2(0) + p2(1))) % p
    p2c = lambda t: (p2(t) + sh * (1 - t) + m * t * (1 - t)) % p  # noqa: E731
    return ((p2c(0) + p2c(1)) % p, p2c(r2), g0(y0, y1, r1, r2, p))


def miss_points(
    c0: int, c1: int, c2: int, b1: int, b2: int,
    d: int, m: int, r1: int, y0: int, y1: int, p: int,
) -> list:
    """Line 12 — every r2 at which the doctored p2' agrees with the truth."""
    p2 = lambda t: (b1 * t + b2 * t * t) % p  # noqa: E731
    fake_claim = lie(c0, c1, c2, d, r1, p)[1]
    sh = (fake_claim - (p2(0) + p2(1))) % p
    p2c = lambda t: (p2(t) + sh * (1 - t) + m * t * (1 - t)) % p  # noqa: E731
    return sorted(t for t in range(p) if p2c(t) == g0(y0, y1, r1, t, p))
