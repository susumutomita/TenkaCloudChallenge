"""Derive every fixture from the per-deploy FLAG_SEED.

Nothing in this problem ships a committed constant a learner could memorize. Same
seed, same fixtures (so a session is reproducible and debuggable); different seed,
different fixtures (so a hard-coded answer from someone else's run does not carry).

Parameters stay small on purpose: a learner has to be able to work an example
through on paper, or the trace teaches nothing.
"""

from __future__ import annotations

import hashlib
import sys
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


#: Prime, and small enough to work on paper. A composite modulus lets `step` share a
#: factor with it, which collapses the walk onto a short sub-cycle: fewer distinct values
#: to land on, and a `predict` answer that can be guessed instead of computed.
_PUBLIC_MODULI = (7, 11, 13, 17, 19, 23)


def public_case(seed: str) -> Case:
    """The one case the learner can see, via `make inspect`."""
    s = _stream(seed, "public")
    modulus = _PUBLIC_MODULI[_pick(s, 0, 0, len(_PUBLIC_MODULI) - 1)]
    start = _pick(s, 2, 0, modulus - 1)
    step = _pick(s, 4, 1, modulus - 1)
    rounds = _pick(s, 6, 4, 9)
    # `predict` is the checkpoint that carries the point of the problem, so the walk has
    # to end somewhere other than where it started. It returns to `start` exactly when
    # `step * rounds` is a whole number of laps; with a prime modulus that needs
    # `rounds` to be a multiple of it, which one nudge always escapes.
    while step * rounds % modulus == 0:
        rounds += 1
    return Case(start=start, step=step, rounds=rounds, modulus=modulus)


#: Prime moduli only, so every step in [2, modulus-1] has something to multiply it back
#: to 1 and the walk-back below always exists.
_WALKBACK_MODULI = (11, 13, 17, 19, 23, 29, 31)


def walkback_case(seed: str) -> dict[str, int]:
    """A second walk, shown with every number including its final value.

    Nothing here is a checkpoint, which is why the final value can be printed: the
    point of this case is that the walk runs backwards. Knowing where it ended, the
    number of steps comes back out by multiplying by whatever takes `step` to 1.

    That is the whole reason this problem exists as the track's first one. Reducing
    mod something removes the clue a plain integer leaks — its size — but it does not
    hide the number of steps, so this is not yet a group anyone can build a signature
    on. Week 3 keeps the walk and changes the thing being walked on.
    """
    s = _stream(seed, "walkback")
    modulus = _WALKBACK_MODULI[_pick(s, 0, 0, len(_WALKBACK_MODULI) - 1)]
    step = _pick(s, 2, 2, modulus - 1)
    rounds = _pick(s, 4, 3, modulus - 2)
    # Non-zero, so the printed `(final - start)` is a subtraction the reader can see
    # doing something rather than a term that vanishes.
    start = _pick(s, 6, 1, modulus - 1)
    final = (start + step * rounds) % modulus
    undo_step = pow(step, -1, modulus)
    return {
        "start": start,
        "step": step,
        "rounds": rounds,
        "modulus": modulus,
        "final": final,
        "undoStep": undo_step,
        "recoveredRounds": ((final - start) * undo_step) % modulus,
    }


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


def corrupted_trace(seed: str) -> tuple[Case, list[int]]:
    """A trace with the modulus skipped on exactly one round.

    Returns the case and the corrupted trace -- exactly the evidence `show.py` and the
    Workbench's `inspect` view print. It deliberately stops there: which position is
    the answer to the `first-broken` checkpoint, and this function ships in the
    participant image (see ../Dockerfile), so it must never be able to name that
    position itself. `verifier/expected.py`'s `first_broken_index` holds that
    derivation instead, and that module never leaves the verifier-only Docker stage
    (Issue 543/537 -- the class this problem was scaffolded from before that fix:
    `corrupted_trace` used to return the broken index as a third tuple element, and
    that alone made the checkpoint's answer one `import` away inside a learner's own
    container, `show.py`'s call site notwithstanding).

    The checkpoint asks which entry first leaves `[0, modulus)`, so the trace has to
    contain such an entry. Skipping the reduction only produces one on a round that
    would have wrapped: if `value + step` was already below `modulus`, reducing or not
    reducing gives the same number and the corruption is invisible. Picking the round
    blind therefore left roughly half of all seeds shipping a trace whose every entry
    was in range, with no answerable "first broken index" at all. So the round is
    picked from the rounds that actually wrap.
    """
    s = _stream(seed, "corrupt")
    modulus = _pick(s, 0, 6, 19)
    step = _pick(s, 4, 2, modulus - 1)
    rounds = _pick(s, 6, 6, 11)

    # Rotating `start` walks `values_before[index]` over every residue mod `modulus`,
    # and `step >= 2` means at least two residues wrap, so some rotation always yields
    # a wrapping round. The loop terminates on the first one rather than searching.
    base_start = _pick(s, 2, 0, modulus - 1)
    # Late enough that the trace has already run for a while, so the break reads as an
    # observation about a wrap rather than "round 0 looked odd".
    candidate_rounds = range(2, rounds - 1)
    start = base_start
    wrapping: list[int] = []
    for rotation in range(modulus):
        start = (base_start + rotation) % modulus
        values_before = _values_before_each_round(start, step, rounds, modulus)
        wrapping = [index for index in candidate_rounds if values_before[index] + step >= modulus]
        if wrapping:
            break

    case = Case(start=start, step=step, rounds=rounds, modulus=modulus)
    skip_at = wrapping[_pick(s, 8, 0, len(wrapping) - 1)]

    trace: list[int] = []
    value = case.start % modulus
    for index in range(case.rounds):
        value = value + case.step
        if index != skip_at:
            value = value % modulus
        trace.append(value)
    return case, trace


def _values_before_each_round(start: int, step: int, rounds: int, modulus: int) -> list[int]:
    """The uncorrupted value entering each round, so a caller can ask which rounds wrap."""
    values: list[int] = []
    value = start % modulus
    for _ in range(rounds):
        values.append(value)
        value = (value + step) % modulus
    return values


def health_token(seed: str) -> str:
    """Proof that the learner actually started the container, rather than reading the README."""
    case = public_case(seed)
    payload = f"{case.start}:{case.step}:{case.rounds}:{case.modulus}"
    return hashlib.sha256(f"health:{seed}:{payload}".encode()).hexdigest()[:16]


def public_payload(seed: str) -> dict[str, object]:
    """Every piece of evidence a learner is shown for this deployment -- nothing more.

    `show.py` and the Workbench's `inspect` view are built from exactly this dict, which
    is also every field this function's own module ships to. It never carries `predict`'s
    final value or `first-broken`'s index; those are the answers, not the evidence.

    Issue 543/537: `fixtures/` -- this module -- does not ship in the participant Docker
    stage at all (see ../Dockerfile). The `participant` Workbench fetches this payload
    from the verifier at runtime instead of building it locally; see
    `participant/server.py`'s `fetch_public` and `verifier/server.py`'s `/public` route.
    The version below runs inside the verifier, which is the one process this catalog's
    seed-derived fixtures may still execute in.
    """
    case = public_case(seed)
    bad_case, trace = corrupted_trace(seed)
    return {
        "environment": {
            "python": sys.version.split()[0],
            "healthToken": health_token(seed),
        },
        "predict": case.as_dict(),
        "walkback": walkback_case(seed),
        "firstBroken": {**bad_case.as_dict(), "trace": trace},
    }
