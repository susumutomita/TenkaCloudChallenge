"""The only file you edit in this challenge.

`make test` runs the public tests against it, `make inspect` prints a trace from
it, and the fourth checkpoint runs it against cases you have not seen.

Implement `advance` so that, for every round i (1-based), the recorded value is

    (start + step * i)  reduced into  [0, modulus)

and return the `rounds` recorded values in order.

Things the hidden cases will try, which the visible one does not:

  * a negative `start`
  * a negative `step`
  * `step == 0`
  * a composite modulus, not just a prime one

Reduce on every round. Reducing only at the end happens to agree with the
visible case and disagrees with several of the hidden ones.
"""

from __future__ import annotations


def advance(start: int, step: int, rounds: int, modulus: int) -> list[int]:
    """Return the `rounds` recorded values of the counter, each in [0, modulus).

    Args:
        start: the value before the first round. May be negative.
        step: added once per round. May be negative or zero.
        rounds: how many values to record. Always >= 0.
        modulus: the modulus to reduce into. Always >= 2.
    """
    raise NotImplementedError("implement advance() — see the docstring above")
