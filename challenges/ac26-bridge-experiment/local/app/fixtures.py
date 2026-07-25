"""Seeded fixture generation for ac26-bridge-experiment.

Every parameter set is derived from FLAG_SEED, so the values a participant sees
are stable for their deployment and different from anyone else's. Hard-coding a
value that passed once therefore fails on the hidden cases, which is the point of
the fourth checkpoint.

Parameters stay small on purpose: a learner who fails a hidden case must be able
to reproduce it by hand. These are observability parameters, not security ones.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass

# Small primes and composites both appear: the counter must not quietly assume a
# prime modulus, and a composite modulus is where a "reduce only at the end"
# implementation is most visibly wrong.
_MODULI = (7, 10, 12, 13, 16, 17, 23, 25, 31, 36, 41, 49, 53, 64, 97, 100)

# How many parameter sets to try when searching for a well-formed broken trace.
# Empirically fewer than 1% of seeds need more than one attempt.
_MAX_CASE_ATTEMPTS = 64


@dataclass(frozen=True)
class Case:
    """One counter run: `rounds` steps of `step`, starting from `start`, mod `modulus`."""

    start: int
    step: int
    rounds: int
    modulus: int

    def describe(self) -> str:
        return (
            f"start={self.start} step={self.step} rounds={self.rounds} modulus={self.modulus}"
        )


def seed() -> str:
    """The per-deployment secret. `make local` injects it; local dev gets a default."""
    return os.environ.get("FLAG_SEED", "local-dev-seed")


def _digest(*parts: str) -> bytes:
    return hashlib.sha256("::".join((seed(), *parts)).encode("utf-8")).digest()


def _int(label: str, index: int, lo: int, hi: int) -> int:
    """Deterministic integer in [lo, hi] derived from the seed."""
    raw = int.from_bytes(_digest(label, str(index)), "big")
    return lo + raw % (hi - lo + 1)


def environment_marker() -> str:
    """Printed by `make test` once the harness runs. Proves the container works."""
    return f"TC{{AC26-ENV:{_digest('environment').hex()[:12]}}}"


def public_case() -> Case:
    """The case shown to the participant, used by the public tests and `make inspect`."""
    return Case(
        start=_int("public-start", 0, 0, 40),
        step=_int("public-step", 0, 1, 9),
        rounds=_int("public-rounds", 0, 6, 12),
        modulus=_MODULI[_int("public-modulus", 0, 0, len(_MODULI) - 1)],
    )


def predict_case() -> Case:
    """Checkpoint 2's case. Different from the public case so running it is not the shortcut."""
    return Case(
        start=_int("predict-start", 0, 10, 90),
        step=_int("predict-step", 0, 2, 17),
        rounds=_int("predict-rounds", 0, 15, 40),
        modulus=_MODULI[_int("predict-modulus", 0, 0, len(_MODULI) - 1)],
    )


def _candidate_broken_case(attempt: int) -> Case:
    return Case(
        start=_int("broken-start", attempt, 0, 30),
        step=_int("broken-step", attempt, 3, 11),
        rounds=_int("broken-rounds", attempt, 12, 20),
        modulus=_MODULI[_int("broken-modulus", attempt, 0, len(_MODULI) - 1)],
    )


def broken_trace_case() -> Case:
    """Checkpoint 3's case. Long enough that eyeballing the end is not enough.

    Not every parameter set can carry an observable skipped reduction: when the
    only overflowing round is the very first one, the fault would be found by
    accident rather than by tracing. Search deterministically for a set that can,
    so the checkpoint is well-formed for every seed rather than for most of them.
    """
    for attempt in range(_MAX_CASE_ATTEMPTS):
        case = _candidate_broken_case(attempt)
        if _overflowing_rounds(case):
            return case
    raise RuntimeError("no observable broken-trace case found for this seed (fixture bug)")


def _overflowing_rounds(case: Case) -> list[int]:
    """1-based rounds whose unreduced value would leave [0, modulus).

    Skipping the reduction is only observable on such a round: elsewhere the
    unreduced value already equals the reduced one and the trace stays correct.
    """
    rounds: list[int] = []
    previous = case.start % case.modulus
    for index in range(1, case.rounds + 1):
        raw = previous + case.step
        if raw < 0 or raw >= case.modulus:
            rounds.append(index)
        previous = raw % case.modulus
    # Never the first round: a trace that is wrong from its first step is found
    # by accident rather than by tracing.
    return [r for r in rounds if r >= 2]


def broken_round() -> int:
    """1-based round where the published trace skipped the reduction."""
    case = broken_trace_case()
    candidates = _overflowing_rounds(case)
    if not candidates:
        raise RuntimeError(
            "seed produced a case with no observable skipped reduction; "
            "this is a fixture bug, not a participant error"
        )
    return candidates[_int("broken-round", 0, 0, len(candidates) - 1)]


def hidden_cases() -> list[Case]:
    """Checkpoint 4's cases: negative start, negative step, zero step, wide moduli.

    These are the shapes a solution over-fitted to the public case gets wrong.
    """
    cases = [
        Case(start=0, step=0, rounds=5, modulus=_MODULI[_int("h-mod", 1, 0, len(_MODULI) - 1)]),
        Case(
            start=-_int("h-start", 2, 1, 50),
            step=_int("h-step", 2, 1, 9),
            rounds=_int("h-rounds", 2, 4, 9),
            modulus=_MODULI[_int("h-mod", 2, 0, len(_MODULI) - 1)],
        ),
        Case(
            start=_int("h-start", 3, 0, 20),
            step=-_int("h-step", 3, 1, 13),
            rounds=_int("h-rounds", 3, 5, 11),
            modulus=_MODULI[_int("h-mod", 3, 0, len(_MODULI) - 1)],
        ),
        Case(
            start=-_int("h-start", 4, 1, 30),
            step=-_int("h-step", 4, 1, 7),
            rounds=_int("h-rounds", 4, 6, 12),
            modulus=_MODULI[_int("h-mod", 4, 0, len(_MODULI) - 1)],
        ),
    ]
    for index in range(5, 9):
        cases.append(
            Case(
                start=_int("h-start", index, -60, 60),
                step=_int("h-step", index, -15, 15),
                rounds=_int("h-rounds", index, 3, 14),
                modulus=_MODULI[_int("h-mod", index, 0, len(_MODULI) - 1)],
            )
        )
    return cases


def expected(case: Case) -> list[int]:
    """The reference result. Kept here, never shipped to the host as a solution file."""
    return [(case.start + case.step * (i + 1)) % case.modulus for i in range(case.rounds)]


def broken_trace() -> list[int]:
    """The published trace for checkpoint 3: correct except one round that skipped `% modulus`."""
    case = broken_trace_case()
    target = broken_round()
    values: list[int] = []
    previous = case.start % case.modulus
    for index in range(1, case.rounds + 1):
        raw = previous + case.step
        # The faulty round records the unreduced value; every later round reduces
        # normally from it, so exactly one transition breaks the recurrence and
        # the tail stays self-consistent. Reading only the final value is not
        # enough — the divergence has to be traced.
        values.append(raw if index == target else raw % case.modulus)
        previous = values[-1] % case.modulus
    return values
