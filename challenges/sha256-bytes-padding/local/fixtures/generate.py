"""Derive every fixture from the per-deploy FLAG_SEED.

Nothing here ships a committed constant a learner could memorize. Same seed, same
fixtures (so a session is reproducible and debuggable); different seed, different
fixtures (so an answer copied from someone else's run does not carry).

The messages stay short and the lengths stay near the block boundary on purpose: a
learner has to be able to count the bytes by hand, or padding teaches nothing.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

BLOCK_BYTES = 64
LENGTH_FIELD_BYTES = 8

#: Multi-byte characters, so byte length never equals character length. Each of these
#: is 3 bytes in UTF-8.
_MULTIBYTE_ALPHABET = "天下雲鍵符号列語混合検査"
_ASCII_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"


@dataclass(frozen=True)
class TextCase:
    """A string whose byte length differs from its character length."""

    text: str

    @property
    def byte_length(self) -> int:
        return len(self.text.encode("utf-8"))

    @property
    def char_length(self) -> int:
        return len(self.text)


def _stream(seed: str, label: str) -> list[int]:
    """A deterministic byte stream for (seed, label). Not a CSPRNG; it does not need to be."""
    out: list[int] = []
    counter = 0
    while len(out) < 96:
        digest = hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest()
        out.extend(digest)
        counter += 1
    return out


def _pick(stream: list[int], index: int, low: int, high: int) -> int:
    """Uniform-enough choice in [low, high]. The ranges are tiny, so modulo bias is irrelevant."""
    span = high - low + 1
    return low + ((stream[index] * 256 + stream[index + 1]) % span)


def text_case(seed: str) -> TextCase:
    """The mixed ASCII / multi-byte string behind the `byte-length` checkpoint."""
    s = _stream(seed, "text")
    ascii_count = _pick(s, 0, 2, 5)
    multibyte_count = _pick(s, 2, 2, 4)
    chars: list[str] = []
    for index in range(ascii_count):
        chars.append(_ASCII_ALPHABET[_pick(s, 4 + index * 2, 0, len(_ASCII_ALPHABET) - 1)])
    for index in range(multibyte_count):
        chars.append(
            _MULTIBYTE_ALPHABET[_pick(s, 20 + index * 2, 0, len(_MULTIBYTE_ALPHABET) - 1)]
        )
    return TextCase(text="".join(chars))


def padded_length(message_length: int) -> int:
    """The one line of arithmetic the whole problem turns on."""
    with_marker = message_length + 1 + LENGTH_FIELD_BYTES
    blocks = -(-with_marker // BLOCK_BYTES)  # ceiling division
    return blocks * BLOCK_BYTES


def length_quiz(seed: str) -> list[int]:
    """Message lengths for the `padded-length` checkpoint.

    Always includes 55 and 56 — the last length that fits one block and the first that
    does not. A learner who answers those two correctly has understood the rule; one who
    guesses "round up to the next multiple of 64" gets 56 wrong.
    """
    s = _stream(seed, "lengths")
    # Keep the canonical first-block boundary, then translate that same 55/56
    # decision to four seeded block numbers. The arithmetic stays exactly as easy
    # to do by hand, while the six-result answer no longer has only two shapes for
    # the entire course.
    translated = []
    for index in range(4):
        blocks = _pick(s, index * 4, 1, 7)
        side = _pick(s, index * 4 + 2, 0, 1)
        translated.append(blocks * BLOCK_BYTES + (55 if side == 0 else 56))
    return [55, 56, *translated]


def length_field_case(seed: str) -> int:
    """The message length behind the `length-field` checkpoint."""
    s = _stream(seed, "lenfield")
    return _pick(s, 0, 3, 200)


def collision_message(seed: str) -> bytes:
    """The message the learner must collide with under zero-only padding.

    Short enough that appending a zero byte still fits the same block, so a
    counterexample exists and is findable by reasoning rather than by search.
    """
    s = _stream(seed, "collide")
    length = _pick(s, 0, 4, 20)
    return bytes(_pick(s, 2 + (index % 40), 1, 255) for index in range(length))


def broken_pad_zeros_only(message: bytes) -> bytes:
    """Padding with the 0x80 terminator left out — zeros to the next multiple of 64.

    This is the defect the `collision` checkpoint is about. It is not injective: a
    message and that same message followed by a zero byte pad to the identical block.
    """
    remainder = len(message) % BLOCK_BYTES
    if remainder == 0 and message:
        return message
    return message + bytes(BLOCK_BYTES - remainder)


def hidden_lengths(seed: str) -> list[int]:
    """Message lengths the hidden `pad` checks run over.

    Every boundary the rule turns on is here unconditionally — 55/56 (one block or two),
    63/64/65 (a message that is itself a whole block), 119/120 (two blocks or three) — plus
    seeded lengths in each gap so a lookup table keyed on the fixed set does not pass.
    """
    s = _stream(seed, "hidden-lengths")
    boundaries = [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 191, 192]
    gaps = [_pick(s, 0, 2, 53), _pick(s, 2, 66, 118), _pick(s, 4, 129, 300)]
    return boundaries + gaps


def hidden_message(seed: str, length: int) -> bytes:
    """A deterministic message of exactly `length` bytes, including zero bytes and 0x80s."""
    s = _stream(seed, f"hidden-message:{length}")
    return bytes(s[index % len(s)] for index in range(length))


def word_case(seed: str) -> bytes:
    """A 64-byte block for the `words` checkpoint, with no 4-byte group a palindrome.

    Every word's first byte is below 128 and its last is above 127, so reading a word
    little-endian always gives a different value than reading it big-endian. A learner
    who got the byte order backwards cannot pass by luck.
    """
    s = _stream(seed, "words")
    block = bytearray()
    for index in range(BLOCK_BYTES // 4):
        block.extend(
            [
                _pick(s, (index * 2) % 80, 1, 127),
                _pick(s, (index + 7) % 80, 0, 255),
                _pick(s, (index + 11) % 80, 0, 255),
                _pick(s, (index * 2 + 40) % 80, 128, 255),
            ]
        )
    return bytes(block)


def hidden_blocks(seed: str) -> list[bytes]:
    """64-byte blocks for the hidden `words` checks.

    The all-zero and all-0xff blocks read identically in either byte order, so they are
    here to catch an implementation that special-cases its way past `word_case`; the
    ascending block is here because every one of its words is distinct in both orders.
    """
    return [
        word_case(seed),
        word_case(f"{seed}:alt"),
        bytes(BLOCK_BYTES),
        bytes([0xFF]) * BLOCK_BYTES,
        bytes(range(BLOCK_BYTES)),
    ]


def health_token(seed: str) -> str:
    """Proof the learner actually started the container rather than reading the README."""
    case = text_case(seed)
    return hashlib.sha256(f"health:{seed}:{case.text}".encode()).hexdigest()[:16]
