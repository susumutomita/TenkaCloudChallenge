"""Reference implementation. Enters the image's `author` stage only.

Used by two things: the mutation suite (which breaks copies of this file and asserts
the hidden tests catch each break), and the `reference-test` CI target.
"""

from __future__ import annotations

MASK = 0xFFFFFFFF
WORD_BITS = 32
WORDS_PER_BLOCK = 16
SCHEDULE_WORDS = 64


def rotr(value: int, amount: int) -> int:
    """Rotate a 32-bit word right. Bits leaving the bottom re-enter at the top."""
    amount %= WORD_BITS
    return ((value >> amount) | (value << (WORD_BITS - amount))) & MASK


def small_sigma0(word: int) -> int:
    """FIPS 180-4 §4.1.2: ROTR^7 xor ROTR^18 xor SHR^3."""
    return rotr(word, 7) ^ rotr(word, 18) ^ (word >> 3)


def small_sigma1(word: int) -> int:
    """FIPS 180-4 §4.1.2: ROTR^17 xor ROTR^19 xor SHR^10."""
    return rotr(word, 17) ^ rotr(word, 19) ^ (word >> 10)


def big_sigma0(word: int) -> int:
    """FIPS 180-4 §4.1.2: ROTR^2 xor ROTR^13 xor ROTR^22. Three rotations, no shift."""
    return rotr(word, 2) ^ rotr(word, 13) ^ rotr(word, 22)


def big_sigma1(word: int) -> int:
    """FIPS 180-4 §4.1.2: ROTR^6 xor ROTR^11 xor ROTR^25. Three rotations, no shift."""
    return rotr(word, 6) ^ rotr(word, 11) ^ rotr(word, 25)


def choose(e: int, f: int, g: int) -> int:
    """Ch(e, f, g): a bitwise multiplexer. Where e is 1 take f's bit, where e is 0 take g's."""
    return (e & f) ^ (~e & MASK & g)


def majority(a: int, b: int, c: int) -> int:
    """Maj(a, b, c): per bit position, the value at least two of the three agree on."""
    return (a & b) ^ (a & c) ^ (b & c)


def expand_schedule(words: list[int]) -> list[int]:
    """Grow the 16 message words into the 64-word schedule.

    W[i] = W[i-16] + sigma0(W[i-15]) + W[i-7] + sigma1(W[i-2]), added modulo 2**32.
    """
    if len(words) != WORDS_PER_BLOCK:
        raise ValueError(f"expected {WORDS_PER_BLOCK} words, got {len(words)}")
    schedule = list(words)
    for index in range(WORDS_PER_BLOCK, SCHEDULE_WORDS):
        total = (
            schedule[index - 16]
            + small_sigma0(schedule[index - 15])
            + schedule[index - 7]
            + small_sigma1(schedule[index - 2])
        )
        schedule.append(total & MASK)
    return schedule
