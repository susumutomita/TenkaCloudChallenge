"""Scratchpad for the ten lines — optional, for when you cannot open Python.

The drill is meant to be typed into your own `python3`, one line at a time, after
pasting the numbers from "Inspect evidence". If you cannot open Python, fill in these
functions in the Portal editor instead and press "Run public tests": the test prints
what YOUR functions return on THIS deployment's numbers — exactly what the REPL would
have printed. Paste those values into the answer fields. Each answer field is a
single-line input.

Each function is one drill line, with the line's names replaced by parameters. n is
the size of the clock (the world holds only 0..n-1), u and v two numbers larger than
one turn, secret the number being hidden, cover the random cover laid over it, second
the second number the last two lines reuse the same cover on. Python's % gives the
division remainder: (u + v) % n is "add, then wrap back onto the clock".
"""

from __future__ import annotations


def wrap(u: int, v: int, n: int) -> tuple:
    """Line 1 — where u and v land on the clock: (u % n, v % n)."""
    return None


def add(u: int, v: int, n: int) -> tuple:
    """Line 2 — (add then wrap, wrap then add then wrap, their difference)."""
    return None


def mul(u: int, v: int, n: int) -> tuple:
    """Line 3 — (multiply then wrap, wrap then multiply then wrap, their difference)."""
    return None


def covered(secret: int, cover: int, n: int) -> int:
    """Line 4 — the secret with the random cover added, on the clock."""
    return None


def uncovered(secret: int, cover: int, n: int) -> int:
    """Line 5 — subtract the same cover from line 4's value, on the clock."""
    return None


def every(secret: int, cover: int, n: int) -> tuple:
    """Line 6 — the cover-count for three candidate secrets.

    Build the table t where t[cand] counts the covers c in 0..n-1 with
    (cand + c) % n equal to line 4's observed value, then read
    (t[secret], t[(secret + 1) % n], t[(observed + 3) % n]).
    """
    return None


def count(secret: int, cover: int, n: int) -> int:
    """Line 7 — the sum of the whole table t."""
    return None


def reuse(secret: int, second: int, cover: int, n: int) -> tuple:
    """Line 8 — (line 4's observed value, second covered with the SAME cover)."""
    return None


def leak(secret: int, second: int, cover: int, n: int) -> int:
    """Line 9 — the difference of the two observed values, on the clock."""
    return None


def same_diff(secret: int, second: int, cover: int, n: int) -> bool:
    """Line 10 — does line 9 equal the difference of the two secrets, on the clock?"""
    return None
