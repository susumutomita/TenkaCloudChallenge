"""Scratchpad for the eleven lines — optional, for when you cannot open Python.

The drill is meant to be typed into your own `python3`, one line at a time, after
pasting the numbers from "Inspect evidence". If you cannot open Python, fill in these
functions in the Portal editor instead and press "Run public tests": the test prints
what YOUR functions return on THIS deployment's numbers — exactly what the REPL would
have printed. Paste those values into the answer fields. Each answer field is a
single-line input.

Each function is one drill line, with the line's names replaced by parameters. a and b
are the two numbers being added for you, x the small cover laid over each of them,
huge the fifteen-digit cover of line 5, n the size of the candidate range in line 8.
"""

from __future__ import annotations


def covered(a: int, b: int, x: int) -> tuple:
    """Line 1 — the two covered numbers (a + x, b + x), in this order."""
    return None


def sum_covered(a: int, b: int, x: int) -> int:
    """Line 2 — what the holder of the two covered numbers gets by adding them."""
    return None


def sum_plain(a: int, b: int, x: int) -> int:
    """Line 3 — the same total written by someone who knows everything: (a + b) + 2x."""
    return None


def same(a: int, b: int, x: int) -> bool:
    """Line 4 — are lines 2 and 3 the same number?"""
    return None


def huge_gap(a: int, b: int, huge: int) -> int:
    """Line 5 — the same comparison with the fifteen-digit cover, as a difference."""
    return None


def held(a: int, b: int, x: int) -> tuple:
    """Line 6 — (the sum the holder returns, the total amount of cover inside it)."""
    return None


def recover(a: int, b: int, x: int) -> int:
    """Line 7 — take the cover back off the returned sum."""
    return None


def guesses(a: int, x: int, n: int) -> int:
    """Line 8 — how many candidates for a (0..n-1) stay possible after seeing a + x.

    A candidate ca stays possible when some cover cx in 0..n-1 lands it on the
    observed number, counting on a wheel of n ("% n" wraps past n back to 0).
    """
    return None


def gap(a: int, b: int, x: int) -> int:
    """Line 9 — the difference of the two covered numbers: (a + x) - (b + x)."""
    return None


def product(a: int, b: int, x: int) -> tuple:
    """Line 10 — (the covered product, every term except x*x, their difference)."""
    return None


def wall(a: int, b: int, x: int) -> bool:
    """Line 11 — is the leftover of line 10 exactly x * x?"""
    return None
