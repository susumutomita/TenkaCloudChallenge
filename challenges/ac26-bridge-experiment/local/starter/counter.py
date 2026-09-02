"""The only file you edit in this problem.

Two functions are graded from it: `advance` (the generalize field) and
`count_no_walkback` (the count-no-walkback field).

`advance` adds `step` to `start`, `rounds` times, and returns the number it was on
after each addition -- with the excess taken off every time, so the numbers stay
inside 0 .. modulus - 1. Inspect evidence shows your own numbers; note that the list it
prints under firstBroken is a deliberately broken run, not an example of a correct one.

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


def count_no_walkback(step: int, low: int, high: int) -> int:
    """How many ring sizes from low to high (inclusive) cannot undo `step`.

    A ring size m cannot undo step when m and step share a factor bigger than 1 --
    the no-walkback field asked for one such m; this asks how many there are.

    What the answer has to satisfy:
      - step is 2 or more; 1 <= low <= high, and high can be as large as 10**12.
      - Counted: every m with low <= m <= high sharing a prime factor with step.
      - The graded runs have a 10-second limit, and the ranges are far too large to
        try one by one. The statement gives the counting rule: add the multiples of
        each prime factor of step, subtract the multiples of each product of two of
        them, add each product of three, and so on -- for any number of prime factors.

    The version below tries every m one by one. It is correct, and far too slow for
    the graded ranges -- but it is a fine way to check your fast version on small ones.
    """
    count = 0
    for m in range(low, high + 1):
        for divisor in range(2, min(step, m) + 1):
            if step % divisor == 0 and m % divisor == 0:
                count += 1
                break
    return count
