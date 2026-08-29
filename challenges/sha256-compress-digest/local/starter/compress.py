"""The only file you edit in this problem.

The compression function, and the digest on top of it. Padding, word splitting, the
sigma functions, Ch, Maj and the message schedule are already written for you in
`local/given/primitives.py` — problems 1 and 2 of this series. Do not edit that file.

Six functions here, all six wrong on purpose, one line each. Every docstring states
the contract and says how the starter gets it wrong.

`make inspect` shows your fixtures; `make test` checks yourself.
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

#: Eight 32-bit words, conventionally named a b c d e f g h.
State = tuple


def round_step(state: State, round_constant: int, schedule_word: int) -> State:
    """One of the 64 rounds.

    Contract (FIPS 180-4 §6.2.2):
      - `T1 = h + Sigma1(e) + Ch(e, f, g) + K[i] + W[i]`, modulo 2**32.
      - `T2 = Sigma0(a) + Maj(a, b, c)`, modulo 2**32.
      - The new state is `(T1 + T2, a, b, c, d + T1, e, f, g)`.
      - Every word of the result is in [0, 2**32).

    Look at what that assignment actually does. Only two of the eight words are
    computed — the new `a` and the new `e`. The other six are the old a, b, c and
    e, f, g shifted one position along, and the old `d` and `h` are gone. A round
    is one narrow injection of new material into a sliding window.

    The starter below leaves out `K[i]` from T1. That is one term of five, it never
    raises, and it produces a digest that is wrong for every input.
    """
    a, b, c, d, e, f, g, h = state
    t1 = (h + big_sigma1(e) + choose(e, f, g) + schedule_word) & MASK
    t2 = (big_sigma0(a) + majority(a, b, c)) & MASK
    return ((t1 + t2) & MASK, a, b, c, (d + t1) & MASK, e, f, g)


def compress_rounds(state: State, schedule: list[int]) -> State:
    """All 64 rounds, and nothing else — no feed-forward addition.

    Contract:
      - Round i uses `K[i]` and `schedule[i]`, in order, for i in 0..63.
      - Returns the state after the last round.

    This function is a permutation of the eight-word state: for a fixed schedule it
    is a bijection, which is what `invert_rounds` below exploits.

    The starter below runs 63 rounds instead of 64.
    """
    working = tuple(state)
    for index in range(SCHEDULE_WORDS - 1):
        working = round_step(working, K[index], schedule[index])
    return working


def compress_block(state: State, schedule: list[int]) -> State:
    """One block's compression: the 64 rounds, then the incoming state added back.

    Contract:
      - `result[i] = (state[i] + compress_rounds(state, schedule)[i]) mod 2**32`.

    That final addition is the Davies-Meyer feed-forward, and it is the whole reason
    a hash built on this is one-way. Without it the block function is invertible, so
    anybody could run it backwards from a digest.

    The starter below returns the round output directly, skipping the addition.
    """
    return compress_rounds(state, schedule)


def invert_round(state: State, round_constant: int, schedule_word: int) -> State:
    """Undo one round.

    Contract: `invert_round(round_step(s, k, w), k, w) == s` for every state s.

    Work backwards from the assignment in `round_step`. Six words come back by
    shifting the other way. `d` and `h` are the interesting ones: they only appear
    inside T1, so you have to recover T1 first — and you can, because T2 depends
    only on words you have already recovered.

    The starter below shifts the six words correctly and then gives up on the other
    two, leaving `d` as the word next to it and `h` as zero.
    """
    a_after, b_after, c_after, d_after, e_after, f_after, g_after, h_after = state
    a, b, c = b_after, c_after, d_after
    e, f, g = f_after, g_after, h_after
    return (a, b, c, e_after, e, f, g, 0)


def invert_rounds(state: State, schedule: list[int]) -> State:
    """Undo all 64 rounds.

    Contract: `invert_rounds(compress_rounds(s, schedule), schedule) == s`.

    The starter below walks the rounds forwards, so it undoes them in the wrong
    order and uses the wrong constant at every step.
    """
    working = tuple(state)
    for index in range(SCHEDULE_WORDS):
        working = invert_round(working, K[index], schedule[index])
    return working


def sha256_hex(message: bytes) -> str:
    """The whole digest: 64 lower-case hex characters.

    Contract:
      - Start from `INITIAL_STATE`.
      - Compress EVERY block of the padded message, feeding each block's output
        state in as the next block's input state.
      - Return the eight final words as 8 hex characters each, in order.

    The starter below compresses only the first block, so it is right for short
    messages and wrong for anything past 55 bytes. That is the most annoying class
    of bug in this problem: it agrees with the published test vectors for `abc`.
    """
    schedules = message_schedules(message)
    state = compress_block(tuple(INITIAL_STATE), schedules[0])
    return "".join(f"{word:08x}" for word in state)
