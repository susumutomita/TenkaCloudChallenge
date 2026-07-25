"""Reference counterexamples. Inside the image only; never mounted to the host."""

from __future__ import annotations


def _solve(statement: dict[str, int], target: int) -> int:
    """The unique w mod p with a*w + b == c (mod p)."""
    p, a, b = statement["p"], statement["a"], statement["b"]
    return ((target - b) * pow(a, -1, p)) % p


def incompleteness_witness(statement: dict[str, int]) -> int:
    """The valid witness P1 rejects.

    The relation pins a single w modulo p; solve for it. On the boundary instance
    that w equals lo, and P1's strict lower bound rejects it even though the
    statement says lo <= w.
    """
    return _solve(statement, statement["c"])


def unsoundness_witness(statement: dict[str, int]) -> int:
    """The relation's solution mod p, lifted out of [lo, hi] by adding p.

    P2 checks the relation modulo p and nothing else, so w + p satisfies it just as
    well while sitting far outside the claimed range.
    """
    return _solve(statement, statement["c"]) + statement["p"]


def extract_witness(transcript: dict) -> int:
    """P3 records the opening verbatim."""
    return int(transcript["opening"]["value"])
