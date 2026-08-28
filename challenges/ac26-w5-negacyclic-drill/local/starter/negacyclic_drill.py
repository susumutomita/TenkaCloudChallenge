"""Scratchpad for the twelve lines — optional, for when you cannot open Python.

The drill is meant to be typed into your own `python3`, one line at a time, after pasting
the numbers from "Inspect evidence". If you cannot open Python, fill in these functions in the
Portal editor instead and press "Run public tests": the test prints what YOUR
functions return on THIS deployment's numbers — exactly what the REPL would have printed.
Paste those values into the answer fields. Each answer field is a single-line input.

Each function is one drill line, with the line's names replaced by parameters. p is the
plaintext modulus, n the ring degree (so q = 2n and D = q/p), v the all-ones test
polynomial, lo and hi the two probe exponents, noise_a and noise_b the two input
ciphertexts' noise, dmax the largest noise either may carry.
"""

from __future__ import annotations


def params(p: int, n: int) -> tuple:
    """Line 1 — (p, q, n, D): the ring's four constants, q = 2n and D = q/p."""
    return None


def wrap(lo: int, hi: int, n: int) -> tuple:
    """Line 2 — x^(lo+hi) mod x^n + 1 as (reduced exponent, sign, exponent before)."""
    return None


def constant_at(v: list, i: int) -> int:
    """Line 3 (part 1) — the constant term of x^(-i) * v(x) mod x^n + 1."""
    return None


def signs(v: list, probes) -> tuple:
    """Line 3 (part 2) — the constant term at each of the six probe indices."""
    return None


def boundary(v: list) -> int:
    """Line 4 — the smallest i whose constant term comes out negated."""
    return None


def hazard(v: list, lo: int) -> tuple:
    """Line 5 — the read that overshoots by n: (lo + n, the constant term there)."""
    return None


def encoding(p: int) -> tuple:
    """Line 6 — the bit encoding (bit 0, bit 1) = (p - 1, 1)."""
    return None


def phases(p: int) -> tuple:
    """Line 7 — r = 1 - m1 - m2 mod p for the four input pairs (0,0), (0,1), (1,0), (1,1)."""
    return None


def rotations(p: int, n: int, noise_a: int, noise_b: int) -> tuple:
    """Line 8 — the four rotation amounts D*r - (noise_a + noise_b) mod q."""
    return None


def constants(p: int, n: int, noise_a: int, noise_b: int) -> tuple:
    """Line 9 — the constant term after each of the four rotations."""
    return None


def nand_table() -> tuple:
    """Line 10 — the NAND truth table for the four input pairs."""
    return None


def noise_sweep(p: int, n: int, dmax: int) -> bool:
    """Line 11 — does the table close for EVERY noise total 0..dmax, not just this one."""
    return None


def margin(p: int, n: int) -> int:
    """Line 12 — the room between the largest rotation 3D and the boundary n."""
    return None
