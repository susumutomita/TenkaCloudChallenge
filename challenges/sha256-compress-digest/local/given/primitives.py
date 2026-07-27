"""Given to you, already correct. Do not edit — the checkpoints import these too.

Everything problems 1 and 2 of this series asked you to write: padding, big-endian word
splitting, the four sigma functions, Ch, Maj, and the message schedule. They are here so
this problem stands on its own. If you solved the earlier two, this file should hold no
surprises; if you did not, you can still do all of this one.

The two constant tables are derived rather than pasted, because a mistyped constant in a
64-entry table is close to undebuggable from the outside: the digest is simply wrong, with
nothing to point at. K comes from the cube roots of the first 64 primes and the initial
state from the square roots of the first 8 — the "nothing up my sleeve" construction, which
is worth seeing computed at least once.
"""

from __future__ import annotations

from decimal import Decimal, getcontext

MASK = 0xFFFFFFFF
WORD_BITS = 32
BLOCK_BYTES = 64
LENGTH_FIELD_BYTES = 8
WORDS_PER_BLOCK = 16
SCHEDULE_WORDS = 64
STATE_WORDS = 8

#: Enough precision that the 32 bits we keep are exact.
getcontext().prec = 60


def _primes(count: int) -> list[int]:
    found: list[int] = []
    candidate = 2
    while len(found) < count:
        if all(candidate % prime for prime in found if prime * prime <= candidate):
            found.append(candidate)
        candidate += 1
    return found


def _fractional_bits(value: Decimal) -> int:
    """The first 32 bits of a positive value's fractional part."""
    return int((value - int(value)) * (1 << WORD_BITS))


def _root(number: int, degree: int) -> Decimal:
    """`number ** (1 / degree)` in Decimal, by Newton's method. `Decimal ** Decimal` would
    go through the inexact `ln`/`exp` pair; this stays exact enough for 32 bits."""
    target = Decimal(number)
    guess = Decimal(number) ** Decimal(1) / Decimal(degree) + 1
    for _ in range(200):
        previous = guess
        guess = ((degree - 1) * guess + target / guess ** (degree - 1)) / degree
        if guess == previous:
            break
    return guess


#: The 64 round constants: fractional parts of the cube roots of the first 64 primes.
K: tuple[int, ...] = tuple(_fractional_bits(_root(prime, 3)) for prime in _primes(64))

#: The initial hash state: fractional parts of the square roots of the first 8 primes.
INITIAL_STATE: tuple[int, ...] = tuple(_fractional_bits(_root(prime, 2)) for prime in _primes(8))


def rotr(value: int, amount: int) -> int:
    amount %= WORD_BITS
    return ((value >> amount) | (value << (WORD_BITS - amount))) & MASK


def small_sigma0(word: int) -> int:
    return rotr(word, 7) ^ rotr(word, 18) ^ (word >> 3)


def small_sigma1(word: int) -> int:
    return rotr(word, 17) ^ rotr(word, 19) ^ (word >> 10)


def big_sigma0(word: int) -> int:
    return rotr(word, 2) ^ rotr(word, 13) ^ rotr(word, 22)


def big_sigma1(word: int) -> int:
    return rotr(word, 6) ^ rotr(word, 11) ^ rotr(word, 25)


def choose(e: int, f: int, g: int) -> int:
    return (e & f) ^ (~e & MASK & g)


def majority(a: int, b: int, c: int) -> int:
    return (a & b) ^ (a & c) ^ (b & c)


def pad_message(message: bytes) -> bytes:
    """FIPS 180-4 §5.1.1. Problem 1 of this series."""
    bit_length = len(message) * 8
    padded = bytearray(message)
    padded.append(0x80)
    while len(padded) % BLOCK_BYTES != BLOCK_BYTES - LENGTH_FIELD_BYTES:
        padded.append(0x00)
    padded.extend(bit_length.to_bytes(LENGTH_FIELD_BYTES, "big"))
    return bytes(padded)


def block_words(block: bytes) -> list[int]:
    """Sixteen 32-bit words, most significant byte first. Problem 1 of this series."""
    return [int.from_bytes(block[index : index + 4], "big") for index in range(0, BLOCK_BYTES, 4)]


def expand_schedule(words: list[int]) -> list[int]:
    """Sixteen words into sixty-four. Problem 2 of this series."""
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


def message_schedules(message: bytes) -> list[list[int]]:
    """One 64-word schedule per block of the padded message."""
    padded = pad_message(message)
    return [
        expand_schedule(block_words(padded[offset : offset + BLOCK_BYTES]))
        for offset in range(0, len(padded), BLOCK_BYTES)
    ]
