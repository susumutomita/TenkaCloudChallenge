"""The only file you edit in this problem.

Two functions, both about getting a message into the shape SHA-256 can consume:
`pad_message` stretches it to a whole number of 512-bit blocks, and `block_words`
reads one of those blocks as sixteen 32-bit integers.

Run `make inspect` to see your fixtures, `make test` to check yourself.
"""

from __future__ import annotations

BLOCK_BYTES = 64
LENGTH_FIELD_BYTES = 8


def pad_message(message: bytes) -> bytes:
    """Return `message` padded to a whole number of 64-byte blocks.

    Contract (FIPS 180-4 §5.1.1):
      - Append a single 1 bit. On a byte boundary that is the byte 0x80.
      - Append the fewest 0x00 bytes that leave exactly 8 bytes of room in the
        final block.
      - Append the length of the ORIGINAL message, in **bits**, as an 8-byte
        big-endian integer.
      - `len(result)` is always a positive multiple of 64, for every input
        including `b""`.
      - The padding is never empty: a message that is already a multiple of 64
        bytes still gains a whole block.

    The starter below stops after the 0x80 and pads with zeros to the next
    multiple of 64. It never writes the length, so two different messages can
    come out identical — which is the point of the `collision` checkpoint.
    """
    padded = bytearray(message)
    padded.append(0x80)
    while len(padded) % BLOCK_BYTES != 0:
        padded.append(0x00)
    return bytes(padded)


def block_words(block: bytes) -> list[int]:
    """Read a 64-byte block as sixteen 32-bit words.

    Contract:
      - Exactly 16 entries, each in [0, 2**32).
      - Big-endian: the first byte of a 4-byte group is its MOST significant byte,
        so the bytes 61 62 63 80 become 0x61626380.

    The starter below reads each group little-endian, which is what you get for
    free on most CPUs and is wrong here.
    """
    return [
        int.from_bytes(block[index : index + 4], "little") for index in range(0, BLOCK_BYTES, 4)
    ]
