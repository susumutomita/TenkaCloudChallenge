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
    return (u % n, v % n)


def add(u: int, v: int, n: int) -> tuple:
    """Line 2 — (add then wrap, wrap then add then wrap, their difference)."""
    return ((u + v) % n, (u % n + v % n) % n, ((u + v) % n) - ((u % n + v % n) % n))


def mul(u: int, v: int, n: int) -> tuple:
    """Line 3 — (multiply then wrap, wrap then multiply then wrap, their difference)."""
    return ((u * v) % n, (u % n) * (v % n) % n, ((u * v) % n) - ((u % n) * (v % n) % n))


def covered(secret: int, cover: int, n: int) -> int:
    """Line 4 — the secret with the random cover added, on the clock."""
    return (secret + cover) % n


def uncovered(secret: int, cover: int, n: int) -> int:
    """Line 5 — subtract the same cover from line 4's value, on the clock."""
    return (covered(secret, cover, n) - cover) % n


def _table(secret: int, cover: int, n: int) -> list:
    observed = covered(secret, cover, n)
    return [sum(1 for c in range(n) if (cand + c) % n == observed) for cand in range(n)]


def every(secret: int, cover: int, n: int) -> tuple:
    """Line 6 — the cover-count for three candidate secrets.

    Build the table t where t[cand] counts the covers c in 0..n-1 with
    (cand + c) % n equal to line 4's observed value, then read
    (t[secret], t[(secret + 1) % n], t[(observed + 3) % n]).
    """
    observed = covered(secret, cover, n)
    t = _table(secret, cover, n)
    return (t[secret], t[(secret + 1) % n], t[(observed + 3) % n])


def count(secret: int, cover: int, n: int) -> int:
    """Line 7 — the sum of the whole table t."""
    return sum(_table(secret, cover, n))


def reuse(secret: int, second: int, cover: int, n: int) -> tuple:
    """Line 8 — (line 4's observed value, second covered with the SAME cover)."""
    return (covered(secret, cover, n), (second + cover) % n)


def leak(secret: int, second: int, cover: int, n: int) -> int:
    """Line 9 — the difference of the two observed values, on the clock."""
    first, twice = reuse(secret, second, cover, n)
    return (first - twice) % n


def same_diff(secret: int, second: int, cover: int, n: int) -> bool:
    """Line 10 — does line 9 equal the difference of the two secrets, on the clock?"""
    return leak(secret, second, cover, n) == (secret - second) % n
