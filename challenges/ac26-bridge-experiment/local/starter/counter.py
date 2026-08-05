"""The only file you edit in this problem.

`advance` adds `step` to `start`, `rounds` times, and returns the number it was on
after each addition -- with the excess taken off every time, so the numbers stay
inside 0 .. modulus - 1. Run `inspect` to see it done on your own numbers.

It is called with small numbers you can work through on paper, and with numbers you
have not been shown.
"""

from __future__ import annotations


def advance(start: int, step: int, rounds: int, modulus: int) -> list[int]:
    """Return the number you are on after each of the `rounds` additions of `step`.

    What the answer has to satisfy:
      - The list has exactly `rounds` numbers in it.
      - The number in position i is where you are after i+1 additions.
      - Every number is 0 or more and smaller than `modulus` -- including when
        `step` is negative, and when `start` is already `modulus` or bigger.
      - `rounds == 0` gives an empty list.
      - `modulus` is always 2 or more.

    The version below is deliberately unfinished: it never takes the excess off.
    """
    trace: list[int] = []
    value = start
    for _ in range(rounds):
        value = value + step
        trace.append(value)
    return trace
