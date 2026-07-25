"""Reference implementation. Lives inside the image only; never mounted to the host.

Used by two things: the mutation suite (which breaks copies of this file and asserts
the hidden tests catch each break), and the `reference-test` CI target.
"""

from __future__ import annotations


def advance(start: int, step: int, rounds: int, modulus: int) -> list[int]:
    trace: list[int] = []
    value = start % modulus
    for _ in range(rounds):
        value = (value + step) % modulus
        trace.append(value)
    return trace
