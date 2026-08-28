"""Scratchpad for the twelve lines — optional, for when you cannot open Python.

The drill is meant to be typed into your own `python3`, one line at a time, after pasting
the numbers from "Inspect evidence". If you cannot open Python, fill in these functions in the
Portal editor instead and press "Run public tests": the test prints what YOUR
functions return on THIS deployment's numbers — exactly what the REPL would have printed.
Paste those values into the answer fields. Each answer field is a single-line input.

Each function is one drill line, with the line's names replaced by parameters. p is the
plaintext modulus, q the ciphertext modulus, n the ring degree (so the rotation space has
2n positions and D = q/p), s the binary secret, a the mask and b the body of one LWE
ciphertext, shift the parameter of the function f(t) = (t + shift) % (p // 2) the test
polynomial evaluates.
"""

from __future__ import annotations


def params(p: int, q: int, n: int) -> tuple:
    """Line 1 — (p, q, n, D): this deployment's four constants, D = q/p."""
    return None


def phase(q: int, s, a, b: int) -> int:
    """Line 2 — the phase b - a.s mod q: the mask stripped, plaintext and noise left."""
    return None


def split(p: int, q: int, s, a, b: int) -> tuple:
    """Line 3 — divmod(phase, D): the plaintext and the noise, seen once for cross-checking."""
    return None


def slots(p: int, n: int) -> int:
    """Line 4 — 2n // p: how many of the ring's 2n positions one plaintext owns."""
    return None


def testvector(p: int, n: int, shift: int) -> list:
    """Line 5 (part 1) — the test polynomial: f(m) written out in slot-wide runs.

    The runs are shifted back by half a slot so a plaintext's target position lands in
    the MIDDLE of its run, not on its first coefficient — the mask and body are rounded
    separately in line 6, and the middle is what absorbs those errors.
    """
    return None


def testpoly(p: int, n: int, shift: int) -> tuple:
    """Line 5 (part 2) — the coefficients sampled at the four slot boundaries."""
    return None


def rescale_one(q: int, n: int, x: int) -> int:
    """Line 6 (part 1) — one value carried from the q world onto the ring's 2n positions."""
    return None


def rescale(p: int, q: int, n: int, a, b: int) -> tuple:
    """Line 6 (part 2) — (D̂, â[0], b̂): the scaling step and the ciphertext, rescaled."""
    return None


def index(q: int, n: int, s, a, b: int) -> int:
    """Line 7 — the rotation amount: b̂ minus the rescaled â.s, reduced mod 2n (never n)."""
    return None


def constant_at(v: list, i: int) -> int:
    """Line 8 (part 1) — the constant term of x^(-i) * v(x) mod x^n + 1."""
    return None


def readout(p: int, q: int, n: int, s, a, b: int, shift: int) -> int:
    """Line 8 (part 2) — rotate the test polynomial by the index, read address zero."""
    return None


def programmable(p: int, q: int, s, a, b: int, shift: int) -> int:
    """Line 9 — f(m) computed directly: what the readout must equal."""
    return None


def window(p: int, q: int, n: int, s, a, b: int, shift: int) -> int:
    """Line 10 — how many positions around the index return the same value."""
    return None


def edge(p: int, q: int, n: int, s, a, b: int, shift: int) -> int:
    """Line 11 — how many more positions the noise may push before the readout changes."""
    return None


def sweep(p: int, q: int, n: int, s, a, b: int, shift: int) -> bool:
    """Line 12 — every usable plaintext through the same machine: readout == f(m) for all."""
    return None
