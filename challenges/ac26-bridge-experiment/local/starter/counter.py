"""The only file you edit in this problem.

`advance` must return the *trace*: the value after each round, in order, with the
modulus applied at every step. `advance` is called with small parameters you can
work through on paper, and with parameters you have not seen.

Run `make inspect` to see a worked example, `make test` to check yourself.
"""

from __future__ import annotations


def advance(start: int, step: int, rounds: int, modulus: int) -> list[int]:
    """Return the value after each of `rounds` additions of `step`, mod `modulus`.

    Contract:
      - The returned list has exactly `rounds` entries.
      - Entry i is the value after i+1 additions, reduced mod `modulus`.
      - Every entry satisfies 0 <= entry < modulus, including when `step` or
        `start` is negative.
      - `rounds == 0` returns an empty list.
      - `modulus` is always >= 2.

    The starter below is deliberately incomplete: it never reduces mod `modulus`.
    """
    trace: list[int] = []
    value = start
    for _ in range(rounds):
        value = value + step
        trace.append(value)
    return trace
