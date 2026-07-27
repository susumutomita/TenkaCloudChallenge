"""Hidden tests. Run by /verify against a copy of the learner's file, never shown to them.

Three jobs:
  1. Inputs the public tests never use — the empty message, both sides of 55/56, a message
     that is already exactly one block, a message spanning three blocks, and a message made
     only of 0x80 and 0x00 bytes so an implementation that finds the marker by scanning for
     0x80 breaks.
  2. Metamorphic properties, so memorizing one output cannot pass: padding is injective and
     minimal, and re-joining a block's words most significant byte first gives the block back.
  3. Negative properties, so an implementation whose padded length happens to be right still
     fails when the bytes in between are not zero.

Failure messages name the property, never the expected value.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    BLOCK_BYTES,
    LENGTH_FIELD_BYTES,
    hidden_blocks,
    hidden_lengths,
    hidden_message,
    padded_length,
    text_case,
)

Pad = Callable[[bytes], bytes]
Words = Callable[[bytes], "list[int]"]

WORDS_PER_BLOCK = BLOCK_BYTES // 4


def _messages(seed: str) -> list[bytes]:
    """One message per hidden length, plus two the length sweep would not produce."""
    messages = [hidden_message(seed, length) for length in hidden_lengths(seed)]
    # The multi-byte string from `make inspect`, so the hidden set includes real UTF-8.
    messages.append(text_case(seed).text.encode("utf-8"))
    # Only the two bytes that padding itself writes. An implementation that locates the
    # marker by searching for 0x80, or the length field by finding the last non-zero byte,
    # gets this one wrong.
    messages.append(bytes([0x80, 0x00] * 30))
    return messages


def _check_pad_shape(pad: Pad, message: bytes) -> list[str]:
    try:
        result = pad(message)
    except Exception as error:  # noqa: BLE001 - a raising solution is a failing solution
        return [f"raised {type(error).__name__} on a valid message"]

    if not isinstance(result, (bytes, bytearray)):
        return ["did not return bytes"]
    padded = bytes(result)

    if len(padded) == 0 or len(padded) % BLOCK_BYTES != 0:
        return ["padded length is not a positive multiple of the block size"]
    if len(padded) != padded_length(len(message)):
        # Both directions matter. Too short means the length field did not get its own
        # room; too long means a whole block of padding nobody asked for.
        return ["padded length is not the fewest whole blocks that fit message, marker and length"]
    if not padded.startswith(message):
        return ["the original message is not a prefix of the result"]

    failures: list[str] = []
    if padded[len(message)] != 0x80:
        failures.append("the byte just after the message is not the single 1 bit")
    filler = padded[len(message) + 1 : len(padded) - LENGTH_FIELD_BYTES]
    if any(byte != 0x00 for byte in filler):
        failures.append("the bytes between the 1 bit and the length field are not all zero")
    if int.from_bytes(padded[-LENGTH_FIELD_BYTES:], "big") != len(message) * 8:
        failures.append("the trailing 8 bytes are not the message length in bits, big-endian")
    return failures


def _check_pad_injective(pad: Pad, message: bytes) -> list[str]:
    """A message and that message plus a zero byte must never pad to the same bytes.

    This is what the 1 bit buys. Zero-only padding satisfies several of the length
    properties above and fails right here.
    """
    try:
        base = bytes(pad(message))
        extended = bytes(pad(message + b"\x00"))
    except Exception as error:  # noqa: BLE001
        return [f"raised {type(error).__name__} while checking injectivity"]
    if base == extended:
        return ["two different messages padded to the same bytes"]
    return []


def _check_pad_deterministic(pad: Pad, message: bytes) -> list[str]:
    """Same input, same output — and the caller's bytes come back unmodified."""
    original = bytes(message)
    try:
        first = bytes(pad(message))
        second = bytes(pad(message))
    except Exception as error:  # noqa: BLE001
        return [f"raised {type(error).__name__} while checking determinism"]
    failures: list[str] = []
    if first != second:
        failures.append("padding the same message twice gave different results")
    if bytes(message) != original:
        failures.append("padding modified the message it was given")
    return failures


def _check_words_shape(words_of: Words, block: bytes) -> list[str]:
    try:
        words = words_of(block)
    except Exception as error:  # noqa: BLE001
        return [f"raised {type(error).__name__} on a valid block"]

    if not isinstance(words, list):
        return ["did not return a list"]
    if len(words) != WORDS_PER_BLOCK:
        return ["did not return one word per four bytes of the block"]
    if any(isinstance(word, bool) or not isinstance(word, int) for word in words):
        return ["a word is not an integer"]
    if any(not 0 <= word < 2**32 for word in words):
        return ["a word is outside the range of a 32-bit unsigned integer"]

    # One property that pins both the byte order and the grouping: re-serializing every
    # word most significant byte first has to reproduce the block exactly.
    rebuilt = b"".join(word.to_bytes(4, "big") for word in words)
    if rebuilt != block:
        return ["re-joining the words most significant byte first does not give the block back"]
    return []


def _bumpable_position(block: bytes) -> int | None:
    """The last byte of the first group whose last byte is not already 0xff."""
    for slot in range(WORDS_PER_BLOCK):
        position = slot * 4 + 3
        if block[position] != 0xFF:
            return position
    return None


def _check_words_low_byte(words_of: Words, block: bytes) -> list[str]:
    """Adding 1 to the LAST byte of a group must add 1 to that word and touch no other.

    Little-endian puts that byte at the top of the word instead, so this fails loudly for a
    byte order that happened to survive a block whose words read the same either way.
    """
    position = _bumpable_position(block)
    if position is None:
        return []
    bumped = bytearray(block)
    bumped[position] += 1
    try:
        base = words_of(bytes(block))
        after = words_of(bytes(bumped))
    except Exception as error:  # noqa: BLE001
        return [f"raised {type(error).__name__} while checking the low-byte property"]
    if not isinstance(base, list) or not isinstance(after, list) or len(base) != len(after):
        return ["the word list changed shape when a single byte changed"]
    changed = [slot for slot, (before, now) in enumerate(zip(base, after)) if before != now]
    if changed != [position // 4]:
        return ["changing one byte did not change exactly the word that contains it"]
    if after[position // 4] - base[position // 4] != 1:
        return ["adding 1 to a group's last byte did not add 1 to its word"]
    return []


def run_pad(pad: Pad, seed: str) -> list[str]:
    """Return a list of human-readable failures for `pad_message`. Empty means it passes."""
    failures: list[str] = []
    for index, message in enumerate(_messages(seed)):
        label = f"message of {len(message)} bytes (case {index})"
        for check in (_check_pad_shape, _check_pad_injective, _check_pad_deterministic):
            failures.extend(f"{label}: {detail}" for detail in check(pad, message))
    return failures


def run_words(words_of: Words, seed: str) -> list[str]:
    """Return a list of human-readable failures for `block_words`. Empty means it passes."""
    failures: list[str] = []
    for index, block in enumerate(hidden_blocks(seed)):
        for check in (_check_words_shape, _check_words_low_byte):
            failures.extend(f"block {index}: {detail}" for detail in check(words_of, block))
    return failures
