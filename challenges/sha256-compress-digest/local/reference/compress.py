"""Reference implementation. Enters the image's `author` stage only.

Used by two things: the mutation suite (which breaks copies of this file and asserts
the hidden tests catch each break), and the `reference-test` CI target.
"""

from __future__ import annotations

from given.primitives import (
    INITIAL_STATE,
    K,
    MASK,
    SCHEDULE_WORDS,
    big_sigma0,
    big_sigma1,
    choose,
    majority,
    message_schedules,
)

State = tuple


def round_step(state: State, round_constant: int, schedule_word: int) -> State:
    """One of the 64 rounds. Two words are computed; the other six shift along."""
    a, b, c, d, e, f, g, h = state
    t1 = (h + big_sigma1(e) + choose(e, f, g) + round_constant + schedule_word) & MASK
    t2 = (big_sigma0(a) + majority(a, b, c)) & MASK
    return ((t1 + t2) & MASK, a, b, c, (d + t1) & MASK, e, f, g)


def compress_rounds(state: State, schedule: list[int]) -> State:
    """The 64 rounds alone, without the feed-forward addition. A permutation of the state."""
    working = tuple(state)
    for index in range(SCHEDULE_WORDS):
        working = round_step(working, K[index], schedule[index])
    return working


def compress_block(state: State, schedule: list[int]) -> State:
    """One block's compression: 64 rounds, then add the incoming state back in.

    The addition is the Davies-Meyer feed-forward. Without it this function would be
    invertible, and a hash built on it would not be one-way.
    """
    working = compress_rounds(state, schedule)
    return tuple((before + after) & MASK for before, after in zip(state, working))


def invert_round(state: State, round_constant: int, schedule_word: int) -> State:
    """Undo one round. Possible because nothing is discarded — only mixed."""
    a_after, b_after, c_after, d_after, e_after, f_after, g_after, h_after = state
    a, b, c = b_after, c_after, d_after
    e, f, g = f_after, g_after, h_after
    t2 = (big_sigma0(a) + majority(a, b, c)) & MASK
    t1 = (a_after - t2) & MASK
    d = (e_after - t1) & MASK
    h = (t1 - big_sigma1(e) - choose(e, f, g) - round_constant - schedule_word) & MASK
    return (a, b, c, d, e, f, g, h)


def invert_rounds(state: State, schedule: list[int]) -> State:
    """Undo all 64 rounds, in reverse order."""
    working = tuple(state)
    for index in reversed(range(SCHEDULE_WORDS)):
        working = invert_round(working, K[index], schedule[index])
    return working


def sha256_hex(message: bytes) -> str:
    """The whole thing: pad, split, expand, compress every block, print 64 hex characters."""
    state = tuple(INITIAL_STATE)
    for schedule in message_schedules(message):
        state = compress_block(state, schedule)
    return "".join(f"{word:08x}" for word in state)
