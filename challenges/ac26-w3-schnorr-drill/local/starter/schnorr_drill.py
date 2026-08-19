"""Scratchpad for the twelve lines — optional, for when you cannot open Python.

The drill is meant to be typed into your own `python3`, one line at a time, after pasting
the numbers from inspect. If you cannot open Python, fill in these twelve functions in the
Portal editor instead and press "run the public tests": the test prints what YOUR
functions return on THIS deployment's numbers — exactly what the REPL would have printed.
Paste those values into the answer fields. Each answer field is a single-line input.

Each function is one drill line. Its body is the line from the statement, with the
names replaced by the parameters. Points are tuples (x, y); the point at infinity is None.
"""

from __future__ import annotations


def field_neg(t: int, p: int) -> int:
    """Line 1 — the negative of t, brought into 0..p-1."""
    return None


def field_inv(t: int, p: int) -> int:
    """Line 2 — the partner of t that multiplies to 1 (mod p)."""
    return None


def lambda_chord(G: tuple, Q: tuple, p: int) -> int:
    """Line 3 — the slope of the line through G and Q (mod p)."""
    return None


def add_points(G: tuple, Q: tuple, p: int) -> tuple:
    """Line 4 — G + Q: the third intersection, reflected. Returns (x3, y3)."""
    return None


def double(G: tuple, p: int, a: int) -> tuple:
    """Line 5 — 2G by the tangent. Returns (x3, y3)."""
    return None


def ec_add(P: tuple | None, Q: tuple | None, p: int, a: int) -> tuple | None:
    """Line 6 (part 1) — the full addition: None is O, same x with opposite y is O."""
    return None


def order(G: tuple, p: int, a: int) -> int:
    """Line 6 (part 2) — how many additions of G reach O."""
    return None


def ec_mul(k: int, P: tuple | None, p: int, a: int) -> tuple | None:
    """Line 7 (part 1) — k copies of P added together."""
    return None


def pubkey(x: int, G: tuple, p: int, a: int) -> tuple:
    """Line 7 (part 2) — P = x*G."""
    return None


def commit(r: int, G: tuple, p: int, a: int) -> tuple:
    """Line 8 — R = r*G."""
    return None


def response(r: int, e: int, x: int, n: int) -> int:
    """Line 9 — s = r + e*x, reduced by the order n."""
    return None


def verify_left(s: int, G: tuple, p: int, a: int) -> tuple:
    """Line 10 — the left side s*G of the check s*G = R + e*P."""
    return None


def nonce_reuse(s1: int, s2: int, e1: int, e2: int, n: int) -> int:
    """Line 11 — the secret behind two signatures that shared a nonce."""
    return None


def transfer(x2: int, r2: int, e2p: int, G2: tuple, p2: int, a2: int) -> int:
    """Line 12 — s on the second curve: recount its order, then r2 + e2p*x2."""
    return None
