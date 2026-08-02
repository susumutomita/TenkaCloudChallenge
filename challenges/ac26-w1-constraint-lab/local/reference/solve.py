"""Reference solution: the three answers, derived from the seed rather than stored.

Author stage only -- the `participant` image does not carry this directory, and
nothing on the participant path imports it. See TEMPLATE.md "Assurance scope" for
what that does and does not buy.

There is nothing clever here, and that is the point. The trace is what the
evaluator computes, and the membership gadget is one factor per licensed value.
The problem is not that the answers are hard to write down; it is that writing
them down requires reading a constraint system as a set of expressions that must
be zero, which is the thing the track is built on.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.evaluator import trace
from fixtures.generate import (
    LIVE,
    allowed_set,
    circuit,
    failing_witness,
    field_modulus,
)
from lab.judge import MEMBERSHIP_SIGNAL


def trace_arguments(seed: str, case: str) -> list[str]:
    """The trace as the single argument `audit trace` / `audit transfer` takes."""
    p = field_modulus(seed, case)
    residuals = trace(circuit(seed, case), failing_witness(seed, case), p)
    return [",".join(str(value) for value in residuals)]


def admit_expression(seed: str) -> str:
    """One factor per licensed value: zero exactly there, non-zero everywhere else."""
    factors = "*".join(
        f"({MEMBERSHIP_SIGNAL} - {value})" for value in allowed_set(seed, LIVE)
    )
    return factors


def admit_arguments(seed: str) -> list[str]:
    return [admit_expression(seed)]
