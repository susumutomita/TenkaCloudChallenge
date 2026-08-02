"""Every case, every broken trace and the flag, derived from the per-deploy FLAG_SEED.

The subject is a counter that advances by a fixed step and is kept inside a window.
One round is

    value <- value + step, brought back into [0, modulus)

and the promise the whole problem hangs on is that **every value the counter ever
takes lies in [0, modulus)**. That promise is what a broken trace violates, and
naming where it first breaks is the reading skill this problem exists to build.

Parameters stay small on purpose: a learner has to be able to work a case through
on paper, or predicting before running teaches nothing.

Nothing here ships a committed constant. Same seed, same numbers (so a session is
reproducible and debuggable); different seed, different numbers (so an answer copied
from someone else's run does not carry).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

#: The names a rule may use, and the order every case is printed in.
PARAMETERS = ("start", "step", "rounds", "modulus")


@dataclass(frozen=True)
class Case:
    """One deployment of the counter."""

    start: int
    step: int
    rounds: int
    modulus: int

    def as_dict(self) -> dict[str, int]:
        return {name: getattr(self, name) for name in PARAMETERS}

    def rendered(self) -> str:
        return " ".join(f"{name}={getattr(self, name)}" for name in PARAMETERS)


def _stream(seed: str, label: str) -> list[int]:
    """A deterministic byte stream for (seed, label). Not a CSPRNG; it does not need to be."""
    out: list[int] = []
    counter = 0
    while len(out) < 64:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(stream: list[int], index: int, low: int, high: int) -> int:
    """Uniform-enough choice in [low, high]. The range is tiny, so modulo bias is irrelevant."""
    return low + ((stream[index] * 256 + stream[index + 1]) % (high - low + 1))


# --------------------------------------------------------------------------- the counter


def trace(case: Case) -> list[int]:
    """The honest trace: the value after each round, every one inside [0, modulus)."""
    values: list[int] = []
    value = case.start % case.modulus
    for _ in range(case.rounds):
        value = (value + case.step) % case.modulus
        values.append(value)
    return values


def final_value(case: Case) -> int:
    """Where the counter stands after the last round. With no rounds, where it started."""
    values = trace(case)
    return values[-1] if values else case.start % case.modulus


def in_window(value: int, modulus: int) -> bool:
    return 0 <= value < modulus


def first_break(values: list[int], modulus: int) -> int:
    """The 0-based index of the first entry outside [0, modulus), or -1 if there is none."""
    for index, value in enumerate(values):
        if not in_window(value, modulus):
            return index
    return -1


# --------------------------------------------------------------------------- the cases


def main_case(seed: str) -> Case:
    """The case `counter predict` asks about. Small enough to work out on paper."""
    s = _stream(seed, "main")
    modulus = _pick(s, 0, 7, 23)
    return Case(
        start=_pick(s, 2, 0, modulus - 1),
        step=_pick(s, 4, 1, modulus - 1),
        rounds=_pick(s, 6, 4, 9),
        modulus=modulus,
    )


def _skip_reduction(case: Case, skipped: set[int]) -> list[int]:
    """The trace an implementation produces when it forgets the window on `skipped` rounds."""
    values: list[int] = []
    value = case.start % case.modulus
    for index in range(case.rounds):
        value = value + case.step
        if index not in skipped:
            value = value % case.modulus
        values.append(value)
    return values


def broken_case(seed: str) -> tuple[Case, list[int], int]:
    """A trace from an implementation that forgot the window on more than one round.

    Returns the case, the broken trace, and the 0-based index where the trace first
    leaves [0, modulus) -- the answer to `counter locate`.

    Two things here are deliberate.

    **The first break is placed by construction** rather than hoped for. Skipping the
    reduction only produces an out-of-range value when the running value was already
    within `step` of the modulus, so picking a round at random and hoping produces
    traces that never break at all -- and a checkpoint with no answer. Instead the
    round is chosen first, the value just before it is drawn from the range that is
    guaranteed to overflow, and `start` is back-computed from there.

    **There is more than one break**, which is what makes the word FIRST in the
    question mean anything. With a single out-of-range entry, "the first entry that
    breaks the invariant" and "the entry that breaks the invariant" are the same
    question, and a checkpoint that says the former while asking the latter is not
    teaching the reading it claims to. The mutation suite is what found that: with one
    break, breaking the judge's "is it the first one" requirement changed no verdict.
    """
    s = _stream(seed, "broken")
    modulus = _pick(s, 0, 9, 19)
    step = _pick(s, 2, 2, modulus - 1)
    rounds = _pick(s, 4, 8, 11)
    # Late enough that the counter has already wrapped at least once, so the break is
    # a real reading rather than "it is round 0"; early enough that entries follow it.
    first_skip = _pick(s, 6, 2, rounds - 4)
    # The value the honest counter holds just before the skipped round. Anything in
    # [modulus - step, modulus - 1] overflows the window when `step` is added to it.
    before = _pick(s, 8, modulus - step, modulus - 1)
    start = (before - first_skip * step) % modulus
    case = Case(start=start, step=step, rounds=rounds, modulus=modulus)

    # A second skipped round, chosen from the ones that actually overflow given what
    # the first skip did to the running value. `first_skip + 1` always overflows -- the
    # value is already at or above the modulus there -- so the fallback is a guarantee
    # rather than a hope, and a gap is preferred when one is available so the two
    # breaks do not read as one two-entry event.
    running = _skip_reduction(case, {first_skip})
    eligible = [
        index
        for index in range(first_skip + 2, rounds)
        if not in_window(running[index - 1] + step, modulus)
    ]
    second_skip = eligible[_pick(s, 10, 0, len(eligible) - 1)] if eligible else first_skip + 1

    values = _skip_reduction(case, {first_skip, second_skip})
    return case, values, first_break(values, modulus)


def transfer_case(seed: str) -> Case:
    """The second deployment, shown only after the first three stages are cleared.

    The step runs **backwards**. That is the whole point of the stage: a rule or a
    reading habit built on a forward-running counter has to survive the counter
    running the other way, where bringing a value back into [0, modulus) means adding
    the modulus rather than subtracting it. Nothing else about the subject changes.
    """
    s = _stream(seed, "transfer")
    modulus = _pick(s, 0, 8, 21)
    return Case(
        start=_pick(s, 2, 0, modulus - 1),
        step=-_pick(s, 4, 2, modulus - 1),
        rounds=_pick(s, 6, 4, 9),
        modulus=modulus,
    )


def transfer_broken_case(seed: str) -> tuple[Case, list[int], int]:
    """A backwards counter whose implementation kept a negative representative.

    The bug is the other half of the same misunderstanding: this implementation
    reduces with a remainder that truncates toward zero, so a value that has gone
    below zero is left below zero instead of being brought back up by a modulus. The
    trace therefore leaves the window **downwards**, and once it has left it can stay
    out for several entries -- so "the FIRST index" is a real question here in a way
    it is not when a single entry overshoots.

    Placed by construction, like `broken_case`: the crossing round is chosen first and
    `start` is set so the counter passes below zero exactly then.
    """
    s = _stream(seed, "transfer-broken")
    modulus = _pick(s, 0, 13, 23)
    rounds = _pick(s, 2, 6, 10)
    # `start` is built from `crossing` and `magnitude` below, and it has to come out
    # BELOW the modulus: the implementation reduces once before the loop, so a start
    # at or above the modulus is silently moved and the crossing lands somewhere else
    # entirely -- including at entry 0, which makes the stage unreadable. Bounding
    # `magnitude` to a fifth of the modulus and `crossing` to `modulus // magnitude - 1`
    # makes `start <= modulus - 1` an arithmetic fact rather than a lucky seed.
    magnitude = _pick(s, 4, 2, max(2, modulus // 5))
    crossing = _pick(s, 6, 2, min(rounds - 3, modulus // magnitude - 1))
    # After `crossing + 1` backwards rounds the counter passes below zero, and not
    # before: start - crossing*magnitude is still in [0, magnitude).
    start = crossing * magnitude + _pick(s, 8, 0, magnitude - 1)

    case = Case(start=start, step=-magnitude, rounds=rounds, modulus=modulus)
    values: list[int] = []
    value = case.start % modulus
    for _ in range(rounds):
        value = value + case.step
        # int() truncates toward zero, so a value in (-modulus, 0) is left alone.
        value = value - modulus * int(value / modulus)
        values.append(value)
    return case, values, first_break(values, modulus)


# --------------------------------------------------------------------------- the rule family


def rule_family(seed: str) -> list[Case]:
    """The parameter sets a submitted rule is graded on.

    Built by hand rather than sampled. What separates a rule from a coincidence is the
    edges: a step that runs backwards, a step of zero, a step larger than the modulus,
    a start already outside the window, and no rounds at all. Uniform random draws
    would mostly produce ordinary forward cases, which nearly every wrong rule
    survives.

    Both of this deployment's own cases are in the family, so a rule has to agree with
    the readings the learner makes by hand as well as with the edges.
    """
    case = main_case(seed)
    family: list[Case] = [case, transfer_case(seed)]
    for modulus in sorted({5, 13, case.modulus}):
        for start in (0, 1, modulus - 1, 3 * modulus + 2):
            for step in (-(modulus - 1), -1, 0, 1, modulus - 1, modulus + 3):
                for rounds in (0, 1, 2, 7):
                    family.append(Case(start=start, step=step, rounds=rounds, modulus=modulus))
    return family


def flag(seed: str) -> str:
    """Derived from the per-deploy seed, so it can be neither memorised nor guessed."""
    return f"TC{{bridge_experiment_{hashlib.sha256(f'flag:{seed}'.encode()).hexdigest()[:20]}}}"
