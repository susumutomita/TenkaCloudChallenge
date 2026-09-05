"""Scratchpad for the fourteen lines — optional, for when you cannot open Python.

The drill is meant to be typed into your own `python3`, one line at a time, after pasting
the numbers from "Inspect evidence". If you cannot open Python, fill in these functions in the
Portal editor instead and press "Run public tests": the test prints what YOUR
functions return on THIS deployment's numbers — exactly what the REPL would have printed.
Paste those values into the answer fields. Each answer field is a single-line input.

Each function is one drill line, with the line's names replaced by parameters. p is the
field modulus, w = (w0, w1) the two-wire witness, r0/r1 each wire's own share randomness,
ca/cb the public coefficient vectors of the two linear forms A = ca . w and B = cb . w,
a/b the Beaver triple's two random factors, and ra/rb/rc the triple's own share
randomness (one per factor: a, b, and c = a * b).
"""

from __future__ import annotations


def w_shares(p: int, w, r0: int, r1: int):
    """Helper for lines 2-14 — each wire's two-party share vector: [r_i, (w[i] - r_i) % p]."""
    return None


def witness(p: int, w) -> tuple:
    """Line 1 — (p, w): the field and the secret about to be split. Nobody keeps it whole."""
    return None


def shares(p: int, w, r0: int, r1: int) -> tuple:
    """Line 2 — (w0[1], w1[1]): the second, newly-revealed entry of each wire's share."""
    return None


def reconstruct(p: int, w, r0: int, r1: int) -> tuple:
    """Line 3 — add every party's shares back: this must equal the witness on screen."""
    return None


def noleak(p: int, w, r0: int) -> list:
    """Line 4 — hold r0 fixed, vary the secret: the first party's share never moves."""
    return None


def ashares(p: int, w, r0: int, r1: int, ca) -> list:
    """Line 5 — A's shares: ca[0]*w0[i] + ca[1]*w1[i] for each party i. No communication."""
    return None


def aopen(p: int, w, r0: int, r1: int, ca) -> tuple:
    """Line 6 — (A opened, A computed directly from w): the two must agree."""
    return None


def bshares(p: int, w, r0: int, r1: int, cb) -> tuple:
    """Line 7 — (B_sh[0], B_sh[1], B): B's shares and B opened, same recipe as lines 5-6."""
    return None


def crossmul(p: int, w, r0: int, r1: int, ca, cb) -> tuple:
    """Line 8 — (share-wise product, the correct A*B): these do NOT agree."""
    return None


def triple(p: int, a: int, b: int, ra: int, rb: int, rc: int) -> tuple:
    """Line 9 — (a opened, b opened, c opened, a*b): confirms the triple satisfies c = a*b."""
    return None


def beaveropen(
    p: int, w, r0: int, r1: int, ca, cb, a: int, b: int, ra: int, rb: int
) -> tuple:
    """Line 10 — (d, e) = (A - a, B - b) opened: the only round of communication."""
    return None


def cshares(
    p: int, w, r0: int, r1: int, ca, cb, a: int, b: int, ra: int, rb: int, rc: int
) -> list:
    """Line 11 — each party's share of C, built from d, e and their own triple shares."""
    return None


def csum(
    p: int, w, r0: int, r1: int, ca, cb, a: int, b: int, ra: int, rb: int, rc: int
) -> int:
    """Line 12 — C = the sum of the shares from line 11, opened."""
    return None


def expand(p: int, w, r0: int, r1: int, ca, cb, a: int, b: int, ra: int, rb: int) -> int:
    """Line 13 — the textbook identity d*e + d*b + e*a + a*b, which must also equal C."""
    return None


def nolink(p: int, w, r0: int, r1: int, ca, cb, a: int, b: int, ra: int, rb: int) -> list:
    """Line 14 — for three candidate values of A, the 'a' that would make d match."""
    return None
