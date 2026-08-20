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
    q0, q1, q2, q3 = qs
    return (q0 + q1 * X + q2 * X * X + q3 * X * X * X) % p


def _qe(qs: tuple, Y: int, p: int) -> int:
    return (qs[0] + qs[2] * Y) % p


def _qo(qs: tuple, Y: int, p: int) -> int:
    return (qs[1] + qs[3] * Y) % p


def _q1(qs: tuple, beta: int, Y: int, p: int) -> int:
    return (_qe(qs, Y, p) + beta * _qo(qs, Y, p)) % p


def poly3(qs: tuple, p: int) -> tuple:
    """Line 1 — the committed Q₀ at 0, 1, 2."""
    return (_q(qs, 0, p), _q(qs, 1, p), _q(qs, 2, p))


def split(qs: tuple, p: int) -> tuple:
    """Line 2 — the even and odd parts at Y = 1."""
    return (_qe(qs, 1, p), _qo(qs, 1, p))


def identity_holds(qs: tuple, p: int) -> bool:
    """Line 3 — Q₀(X) = Q_even(X²) + X·Q_odd(X²) at every point."""
    return all(
        _q(qs, X, p) == (_qe(qs, X * X % p, p) + X * _qo(qs, X * X % p, p)) % p
        for X in range(p)
    )


def fold(qs: tuple, beta: int, p: int) -> tuple:
    """Line 4 — Q₁ = Q_even + β·Q_odd at 0, 1, 2."""
    return (_q1(qs, beta, 0, p), _q1(qs, beta, 1, p), _q1(qs, beta, 2, p))


def fold2(qs: tuple, beta: int, beta2: int, p: int) -> int:
    """Line 5 — fold Q₁ once more: the constant c + β₂·d."""
    c = _q1(qs, beta, 0, p)
    d = (_q1(qs, beta, 1, p) - c) % p
    return (c + beta2 * d) % p


def query(qs: tuple, x: int, p: int) -> tuple:
    """Line 6 — the two openings (Q₀(x), Q₀(−x))."""
    return (_q(qs, x, p), _q(qs, (-x) % p, p))


def recover(qs: tuple, x: int, p: int) -> tuple:
    """Line 7 — (re, ro, Q_even(x²), Q_odd(x²)): both halves from the two openings."""
    inv2 = pow(2, p - 2, p)
    re = (_q(qs, x, p) + _q(qs, (-x) % p, p)) * inv2 % p
    ro = (_q(qs, x, p) - _q(qs, (-x) % p, p)) * pow(2 * x, p - 2, p) % p
    return (re, ro, _qe(qs, x * x % p, p), _qo(qs, x * x % p, p))


def consistency(qs: tuple, beta: int, x: int, p: int) -> tuple:
    """Line 8 — (re + β·ro, Q₁(x²)): the query check, honest side."""
    re, ro, _e, _o = recover(qs, x, p)
    return ((re + beta * ro) % p, _q1(qs, beta, x * x % p, p))


def cheat(qs: tuple, beta: int, d0: int, d1: int, p: int) -> tuple:
    """Line 9 — the swapped Q₁′ = Q₁ + d0 + d1·Y at 0 and 1."""
    return (
        (_q1(qs, beta, 0, p) + d0) % p,
        (_q1(qs, beta, 1, p) + d0 + d1) % p,
    )


def cheat_caught(qs: tuple, beta: int, x: int, d0: int, d1: int, p: int) -> tuple:
    """Line 10 — (re + β·ro, Q₁′(x²)): the query check against the swapped commitment."""
    re, ro, _e, _o = recover(qs, x, p)
    xx = x * x % p
    return ((re + beta * ro) % p, (_q1(qs, beta, xx, p) + d0 + d1 * xx) % p)


def miss_points(d0: int, d1: int, p: int) -> list:
    """Line 11 — every x where the swap's gap d0 + d1·x² vanishes."""
    return sorted(xx for xx in range(1, p) if (d0 + d1 * (xx * xx % p)) % p == 0)


def honest_all(qs: tuple, beta: int, p: int) -> list:
    """Line 12 — every x where the HONEST fold fails the query check (none)."""
    inv2 = pow(2, p - 2, p)
    return [
        xx
        for xx in range(1, p)
        if (
            (_q(qs, xx, p) + _q(qs, (-xx) % p, p)) * inv2
            + beta * (_q(qs, xx, p) - _q(qs, (-xx) % p, p)) * pow(2 * xx, p - 2, p)
            - _q1(qs, beta, xx * xx % p, p)
        )
        % p
        != 0
    ]
