"""Reference implementation. Lives inside the image only; never mounted to the host.

Used by two things: the mutation suite (which breaks copies of this file and asserts
the hidden tests catch each break), and the `reference-test` CI target.
"""

from __future__ import annotations

BLOCK_BYTES = 64
LENGTH_FIELD_BYTES = 8


def pad_message(message: bytes) -> bytes:
    """FIPS 180-4 §5.1.1: one 1 bit, then zeros, then the 64-bit big-endian bit length."""
    bit_length = len(message) * 8
    padded = bytearray(message)
    padded.append(0x80)
    while len(padded) % BLOCK_BYTES != BLOCK_BYTES - LENGTH_FIELD_BYTES:
        padded.append(0x00)
    padded.extend(bit_length.to_bytes(LENGTH_FIELD_BYTES, "big"))
    return bytes(padded)


def block_words(block: bytes) -> list[int]:
    """Read a 64-byte block as sixteen 32-bit words, most significant byte first."""
    return [int.from_bytes(block[index : index + 4], "big") for index in range(0, BLOCK_BYTES, 4)]
