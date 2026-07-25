"""Derive every fixture from the per-deploy FLAG_SEED.

Nothing in this problem ships a committed constant a learner could memorize. Same
seed, same fixtures (so a session is reproducible and debuggable); different seed,
different fixtures (so a hard-coded answer from someone else's run does not carry).

Parameters stay small on purpose: a learner has to be able to work an example
through on paper, or the trace teaches nothing.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass


@dataclass(frozen=True)
class Case:
    start: int
    step: int
    rounds: int
    modulus: int

    def as_dict(self) -> dict[str, int]:
        return {
            "start": self.start,
            "step": self.step,
            "rounds": self.rounds,
            "modulus": self.modulus,
        }


def _stream(seed: str, label: str) -> "list[int]":
    """A deterministic byte stream for (seed, label). Not a CSPRNG; it does not need to be."""
    out: list[int] = []
    counter = 0
    while len(out) < 64:
        digest = hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest()
        out.extend(digest)
        counter += 1
    return out


def _pick(stream: list[int], index: int, low: int, high: int) -> int:
    """Uniform-enough choice in [low, high]. Range is tiny, so modulo bias is irrelevant here."""
    span = high - low + 1
    return low + ((stream[index] * 256 + stream[index + 1]) % span)


def public_case(seed: str) -> Case:
    """The one case the learner can see, via `make inspect`."""
    s = _stream(seed, "public")
    modulus = _pick(s, 0, 7, 23)
    return Case(
        start=_pick(s, 2, 0, modulus - 1),
        step=_pick(s, 4, 1, modulus - 1),
        rounds=_pick(s, 6, 4, 9),
        modulus=modulus,
    )


def hidden_cases(seed: str) -> list[Case]:
    """Cases the learner never sees: several moduli, a negative step, a zero step, zero rounds.

    These are the cases that separate "reduced mod modulus every round" from
    "reduced once at the end", and "normalized negatives" from "left Python's % to
    do something that only looks right for positive inputs".
    """
    s = _stream(seed, "hidden")
    cases: list[Case] = []
    for index in range(4):
        modulus = _pick(s, index * 4, 5, 97)
        cases.append(
            Case(
                start=_pick(s, index * 4 + 2, 0, modulus - 1),
                step=_pick(s, index * 4 + 6, 1, modulus - 1),
                rounds=_pick(s, index * 4 + 8, 3, 12),
                modulus=modulus,
            )
        )
    negative_modulus = _pick(s, 32, 5, 41)
    cases.append(
        Case(
            start=_pick(s, 34, 0, negative_modulus - 1),
            step=-_pick(s, 36, 1, negative_modulus - 1),
            rounds=_pick(s, 38, 3, 11),
            modulus=negative_modulus,
        )
    )
    zero_step_modulus = _pick(s, 40, 5, 31)
    cases.append(
        Case(
            start=_pick(s, 42, 0, zero_step_modulus - 1),
            step=0,
            rounds=_pick(s, 44, 2, 6),
            modulus=zero_step_modulus,
        )
    )
    big_start_modulus = _pick(s, 46, 5, 29)
    cases.append(
        Case(
            start=big_start_modulus * _pick(s, 48, 2, 5) + _pick(s, 50, 0, big_start_modulus - 1),
            step=_pick(s, 52, 1, big_start_modulus - 1),
            rounds=_pick(s, 54, 3, 8),
            modulus=big_start_modulus,
        )
    )
    cases.append(Case(start=_pick(s, 56, 0, 20), step=_pick(s, 58, 1, 9), rounds=0, modulus=13))
    return cases


def corrupted_trace(seed: str) -> tuple[Case, list[int], int]:
    """A trace with the modulus skipped on exactly one round.

    Returns the case, the corrupted trace, and the 0-based index where the trace
    first stops satisfying `0 <= value < modulus` — the answer to the inspect
    checkpoint.
    """
    s = _stream(seed, "corrupt")
    modulus = _pick(s, 0, 6, 19)
    case = Case(
        start=_pick(s, 2, 0, modulus - 1),
        step=_pick(s, 4, 2, modulus - 1),
        rounds=_pick(s, 6, 6, 11),
        modulus=modulus,
    )
    # Skip the reduction on this round. Chosen late enough that the value has already
    # wrapped at least once, so the break is a real observation and not just "round 0".
    skip_at = _pick(s, 8, 2, case.rounds - 2)

    trace: list[int] = []
    value = case.start % modulus
    broke_at = -1
    for index in range(case.rounds):
        value = value + case.step
        if index != skip_at:
            value = value % modulus
        trace.append(value)
        if broke_at == -1 and not 0 <= trace[index] < modulus:
            broke_at = index
    return case, trace, broke_at


def health_token(seed: str) -> str:
    """Proof that the learner actually started the container, rather than reading the README."""
    case = public_case(seed)
    payload = f"{case.start}:{case.step}:{case.rounds}:{case.modulus}"
    return hashlib.sha256(f"health:{seed}:{payload}".encode()).hexdigest()[:16]
