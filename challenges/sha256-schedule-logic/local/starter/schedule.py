"""The only file you edit in this problem.

Eight functions, all of SHA-256's bit plumbing except the compression loop itself:
the rotation everything is built from, the four sigma functions, the two logic
functions, and the message schedule that turns 16 words into 64.

Six of the eight are wrong on purpose. Each defect is one line, each is a mistake
people actually make, and each docstring states the contract you are implementing
against. The two written correctly are there to compare against — though both are
built on `rotr`, so they produce wrong answers until you fix that one.

`make inspect` shows your fixtures; `make test` checks yourself.
"""

from __future__ import annotations

MASK = 0xFFFFFFFF
WORD_BITS = 32
WORDS_PER_BLOCK = 16
SCHEDULE_WORDS = 64


def rotr(value: int, amount: int) -> int:
    """Rotate a 32-bit word right by `amount` bits.

    Contract:
      - Result is in [0, 2**32).
      - Rotation, not shift: the `amount` low bits come back at the TOP, so no bit
        is ever lost. `rotr(0x00000001, 1)` is `0x80000000`.
      - `rotr(x, 0)` is `x`, and `rotr(x, 32)` is `x`.

    The starter below shifts both ways and ors them, which is the right idea, but
    it never trims the result back to 32 bits — so the left shift leaves bits
    above bit 31 and the value stops being a word. Every sigma function is built
    on this one, so it is the first thing to fix.
    """
    return (value >> amount) | (value << (WORD_BITS - amount))


def small_sigma0(word: int) -> int:
    """sigma0 from the message schedule: ROTR^7 xor ROTR^18 xor SHR^3.

    Two rotations and one *shift*. This one is written correctly — compare it
    against `small_sigma1` below.
    """
    return rotr(word, 7) ^ rotr(word, 18) ^ (word >> 3)


def small_sigma1(word: int) -> int:
    """sigma1 from the message schedule: ROTR^17 xor ROTR^19 xor SHR^10.

    The starter below rotates by 10 where the specification shifts by 10. Rotating
    keeps the low bits; shifting drops them and feeds in zeros at the top. That
    difference is what makes the schedule irreversible rather than a permutation.
    """
    return rotr(word, 17) ^ rotr(word, 19) ^ rotr(word, 10)


def big_sigma0(word: int) -> int:
    """Sigma0 from the compression round: ROTR^2 xor ROTR^13 xor ROTR^22.

    Three rotations, no shift at all — that is what separates the big sigmas from
    the small ones. The starter below has Sigma1's rotation amounts.
    """
    return rotr(word, 6) ^ rotr(word, 11) ^ rotr(word, 25)


def big_sigma1(word: int) -> int:
    """Sigma1 from the compression round: ROTR^6 xor ROTR^11 xor ROTR^25.

    Written correctly. Four sigma functions, four different sets of amounts, and
    two of them use a shift for the third term: worth a minute with the spec table
    before you trust your memory of which is which.
    """
    return rotr(word, 6) ^ rotr(word, 11) ^ rotr(word, 25)


def choose(e: int, f: int, g: int) -> int:
    """Ch(e, f, g) = (e AND f) XOR (NOT e AND g).

    Contract: a bitwise multiplexer. In each of the 32 positions, where e's bit is
    1 the result takes f's bit, and where e's bit is 0 it takes g's. e chooses; f
    and g are the choices.

    The starter below drops the NOT, so both branches read e. Work out what that
    computes for a single bit position and you will see why it is not a mux.

    One Python note. `~x` is not a 32-bit complement: it is arbitrary-precision
    two's complement, so `~5` is `-6`. Here it happens not to bite — `(~e) & g`
    keeps only bits `g` already had, and `g` is a word — but it bites anywhere the
    complement is not immediately ANDed with a word, so masking it is the habit.
    """
    return (e & f) ^ (e & g)


def majority(a: int, b: int, c: int) -> int:
    """Maj(a, b, c) = (a AND b) XOR (a AND c) XOR (b AND c).

    Contract: per bit position, the value that at least two of the three agree on.
    Three inputs, so there is always a strict majority.

    The starter below returns the parity instead. On single bits, parity and
    majority agree on exactly two of the eight input combinations -- all zeros and
    all ones -- and disagree on the other six. That is close enough to look right
    and wrong often enough to matter.
    """
    return a ^ b ^ c


def expand_schedule(words: list[int]) -> list[int]:
    """Grow the 16 message words into the 64-word schedule.

    Contract:
      - Returns exactly 64 words, each in [0, 2**32).
      - The first 16 are `words` unchanged.
      - For i in 16..63:
            W[i] = W[i-16] + sigma0(W[i-15]) + W[i-7] + sigma1(W[i-2])
        The four terms are ADDED modulo 2**32, not xored.
      - `words` always has exactly 16 entries.

    The starter below xors the four terms. Xor is the cheap-looking substitute for
    addition here and it is wrong for a reason worth knowing: xor has no carries,
    so a bit in one position can never influence a higher position, and the
    diffusion the schedule exists to provide never happens.
    """
    schedule = list(words)
    for index in range(WORDS_PER_BLOCK, SCHEDULE_WORDS):
        schedule.append(
            schedule[index - 16]
            ^ small_sigma0(schedule[index - 15])
            ^ schedule[index - 7]
            ^ small_sigma1(schedule[index - 2])
        )
    return schedule
