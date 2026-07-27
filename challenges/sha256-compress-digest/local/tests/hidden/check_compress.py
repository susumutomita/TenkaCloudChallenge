"""Hidden tests. Run by /verify against a copy of the learner's file, never shown to them.

Four entry points, one per code checkpoint, each taking the learner's module so a missing
function is a named failure rather than an import error.

They are separated the same way problem 2's are. `feedforward` scores the inverse and does
NOT lean on the learner's forward pass: it inverts a forward pass the checker computed
itself, so a consistent-but-wrong pair cannot satisfy it. `digest` is the only checkpoint
that compares against a full known-answer table.

Failure messages name the property, never the expected value.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path
from types import ModuleType

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    MASK,
    SCHEDULE_WORDS,
    STATE_WORDS,
    hidden_messages,
    hidden_rounds,
    hidden_schedules,
    hidden_states,
)
from given.primitives import (  # noqa: E402
    K,
    big_sigma0,
    big_sigma1,
    choose,
    majority,
)


def _round_step(state: tuple[int, ...], constant: int, word: int) -> tuple[int, ...]:
    """The checker's own round. Never the learner's — that is what is being checked."""
    a, b, c, d, e, f, g, h = state
    t1 = (h + big_sigma1(e) + choose(e, f, g) + constant + word) & MASK
    t2 = (big_sigma0(a) + majority(a, b, c)) & MASK
    return ((t1 + t2) & MASK, a, b, c, (d + t1) & MASK, e, f, g)


def _compress_rounds(state: tuple[int, ...], schedule: list[int]) -> tuple[int, ...]:
    working = tuple(state)
    for index in range(SCHEDULE_WORDS):
        working = _round_step(working, K[index], schedule[index])
    return working


def _resolve(module: ModuleType, names: tuple[str, ...]) -> tuple[list[object], list[str]]:
    found: list[object] = []
    missing: list[str] = []
    for name in names:
        attribute = getattr(module, name, None)
        if not callable(attribute):
            missing.append(f"{name} is missing or is not callable")
        found.append(attribute)
    return found, missing


def _is_state(value: object) -> bool:
    if not isinstance(value, (tuple, list)) or len(value) != STATE_WORDS:
        return False
    return all(
        isinstance(word, int) and not isinstance(word, bool) and 0 <= word <= MASK for word in value
    )


def _guard(label: str, action) -> tuple[object, list[str]]:
    try:
        return action(), []
    except Exception as error:  # noqa: BLE001 - a raising implementation is a failing one
        return None, [f"raised {type(error).__name__} while checking {label}"]


def run_round(module: ModuleType, seed: str) -> list[str]:
    """Failures for `round_step`. Empty means the checkpoint passes."""
    (round_step,), missing = _resolve(module, ("round_step",))
    if missing:
        return missing
    for index, case in enumerate(hidden_rounds(seed)):
        constant = K[case.round_index]
        result, error = _guard("round_step", lambda: round_step(case.state, constant, case.schedule_word))
        if error:
            return error
        if not _is_state(result):
            return [f"case {index}: round_step did not return eight 32-bit words"]
        expected = _round_step(tuple(case.state), constant, case.schedule_word)
        if tuple(result) != expected:
            # Say which half is wrong, since the two computed words come from different
            # expressions and knowing which one narrows the search a lot.
            if tuple(result)[1:4] != expected[1:4] or tuple(result)[5:8] != expected[5:8]:
                return [f"case {index}: the six shifted words are not the previous a, b, c and e, f, g"]
            if result[4] != expected[4]:
                return [f"case {index}: the new e does not equal the old d plus T1"]
            return [f"case {index}: the new a does not equal T1 plus T2"]
        # The round must not depend on the caller's tuple staying alive unmodified.
        if tuple(case.state) != tuple(hidden_rounds(seed)[index].state):
            return [f"case {index}: round_step modified the state it was given"]
    return []


def run_compress(module: ModuleType, seed: str) -> list[str]:
    """Failures for `compress_rounds` and `compress_block`. Empty means it passes."""
    names = ("compress_rounds", "compress_block")
    (compress_rounds, compress_block), missing = _resolve(module, names)
    if missing:
        return missing
    for index, state in enumerate(hidden_states(seed)):
        for schedule in hidden_schedules(seed):
            rounds, error = _guard("compress_rounds", lambda: compress_rounds(tuple(state), list(schedule)))
            if error:
                return error
            if not _is_state(rounds):
                return [f"state {index}: compress_rounds did not return eight 32-bit words"]
            expected_rounds = _compress_rounds(tuple(state), list(schedule))
            if tuple(rounds) != expected_rounds:
                return [
                    f"state {index}: compress_rounds does not match 64 rounds using K[i] and "
                    "schedule[i] in order"
                ]

            block, error = _guard("compress_block", lambda: compress_block(tuple(state), list(schedule)))
            if error:
                return error
            if not _is_state(block):
                return [f"state {index}: compress_block did not return eight 32-bit words"]
            expected_block = tuple(
                (before + after) & MASK for before, after in zip(state, expected_rounds)
            )
            if tuple(block) != expected_block:
                if tuple(block) == expected_rounds:
                    return [
                        f"state {index}: compress_block returned the round output without adding "
                        "the incoming state back in"
                    ]
                return [f"state {index}: compress_block does not add the incoming state to the round output"]
    return []


def run_feedforward(module: ModuleType, seed: str) -> list[str]:
    """Failures for `invert_round` and `invert_rounds`.

    The forward pass used here is the CHECKER's, so an inverse that only matches the
    learner's own broken forward pass fails. The last property is the point of the
    checkpoint: adding the incoming state back destroys the invertibility the rounds have.
    """
    names = ("invert_round", "invert_rounds")
    (invert_round, invert_rounds), missing = _resolve(module, names)
    if missing:
        return missing

    for index, case in enumerate(hidden_rounds(seed)):
        constant = K[case.round_index]
        forward = _round_step(tuple(case.state), constant, case.schedule_word)
        back, error = _guard("invert_round", lambda: invert_round(forward, constant, case.schedule_word))
        if error:
            return error
        if not _is_state(back):
            return [f"case {index}: invert_round did not return eight 32-bit words"]
        if tuple(back) != tuple(case.state):
            return [f"case {index}: inverting one round did not restore the state it started from"]

    for index, state in enumerate(hidden_states(seed)):
        for schedule in hidden_schedules(seed):
            forward = _compress_rounds(tuple(state), list(schedule))
            back, error = _guard("invert_rounds", lambda: invert_rounds(forward, list(schedule)))
            if error:
                return error
            if not _is_state(back):
                return [f"state {index}: invert_rounds did not return eight 32-bit words"]
            if tuple(back) != tuple(state):
                return [f"state {index}: inverting all 64 rounds did not restore the input state"]

            # The counterexample. With the feed-forward addition in place, running the
            # inverse on a compressed block must NOT give the input state back -- if it
            # does, the submitted inverse is not inverting the rounds at all.
            compressed = tuple((a + b) & MASK for a, b in zip(state, forward))
            if compressed == forward:
                continue  # the all-zero state is its own feed-forward; nothing to observe
            spoiled, error = _guard("the feed-forward property", lambda: invert_rounds(compressed, list(schedule)))
            if error:
                return error
            if tuple(spoiled) == tuple(state):
                return [
                    f"state {index}: inverting a fed-forward block still recovered the input "
                    "state, so the inverse is not undoing the rounds"
                ]
    return []


def run_digest(module: ModuleType, seed: str) -> list[str]:
    """Failures for `sha256_hex`. The one known-answer checkpoint in this problem."""
    (sha256_hex,), missing = _resolve(module, ("sha256_hex",))
    if missing:
        return missing
    for index, message in enumerate(hidden_messages(seed)):
        digest, error = _guard("sha256_hex", lambda: sha256_hex(message))
        if error:
            return error
        if not isinstance(digest, str):
            return [f"message {index}: sha256_hex did not return a string"]
        if len(digest) != 64 or digest != digest.lower():
            return [f"message {index}: the digest is not 64 lower-case hex characters"]
        try:
            int(digest, 16)
        except ValueError:
            return [f"message {index}: the digest is not hexadecimal"]
        if digest != hashlib.sha256(message).hexdigest():
            if len(message) > 55:
                return [
                    f"message of {len(message)} bytes: the digest is wrong, and this message "
                    "needs more than one block"
                ]
            return [f"message of {len(message)} bytes: the digest is wrong"]
    return []
