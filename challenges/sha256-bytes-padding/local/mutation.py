"""Mutation suite: break the reference on purpose and assert the hidden tests notice.

This is the check that keeps the hidden suite honest. A green test run against a
correct solution proves nothing about whether the tests would catch a wrong one.

Run inside the image (or in CI):  python mutation.py
Exit code 0 means every mutation was killed.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import collision_message, length_field_case, text_case
from tests.hidden.check_padding import run_pad, run_words

SEED = "mutation-suite-seed"

# Each entry is (name, source). The source defines `pad_message` with one defect.
#
# Equivalent mutants are deliberately absent. Two obvious-looking candidates —
# `message + b"\x80"` in place of a bytearray append, and reading the bit length from
# `len(message)` before rather than after copying the message into the buffer — produce
# byte-for-byte identical output, so no correct test can distinguish them. Listing them
# would produce a permanent "survived" that trains authors to ignore the suite. Before
# adding a mutation, convince yourself it changes an observable output for some input.
PAD_MUTATIONS: list[tuple[str, str]] = [
    (
        "zero-only padding: the 1 bit is never written",
        """
def pad_message(message):
    padded = bytearray(message)
    while len(padded) % 64 != 56:
        padded.append(0x00)
    padded.extend((len(message) * 8).to_bytes(8, "big"))
    return bytes(padded)
""",
    ),
    (
        "the length field is little-endian",
        """
def pad_message(message):
    padded = bytearray(message)
    padded.append(0x80)
    while len(padded) % 64 != 56:
        padded.append(0x00)
    padded.extend((len(message) * 8).to_bytes(8, "little"))
    return bytes(padded)
""",
    ),
    (
        "the length field counts bytes, not bits",
        """
def pad_message(message):
    padded = bytearray(message)
    padded.append(0x80)
    while len(padded) % 64 != 56:
        padded.append(0x00)
    padded.extend(len(message).to_bytes(8, "big"))
    return bytes(padded)
""",
    ),
    (
        "the length field is never written (the shipped starter's first defect)",
        """
def pad_message(message):
    padded = bytearray(message)
    padded.append(0x80)
    while len(padded) % 64 != 0:
        padded.append(0x00)
    return bytes(padded)
""",
    ),
    (
        "the length sits next to the 1 bit instead of at the end",
        """
def pad_message(message):
    padded = bytearray(message)
    padded.append(0x80)
    padded.extend((len(message) * 8).to_bytes(8, "big"))
    while len(padded) % 64 != 0:
        padded.append(0x00)
    return bytes(padded)
""",
    ),
    (
        "a message that already fills whole blocks gets no padding",
        """
def pad_message(message):
    if message and len(message) % 64 == 0:
        return bytes(message)
    padded = bytearray(message)
    padded.append(0x80)
    while len(padded) % 64 != 56:
        padded.append(0x00)
    padded.extend((len(message) * 8).to_bytes(8, "big"))
    return bytes(padded)
""",
    ),
    (
        "off by one: seven bytes reserved for the length instead of eight",
        """
def pad_message(message):
    padded = bytearray(message)
    padded.append(0x80)
    while len(padded) % 64 != 57:
        padded.append(0x00)
    padded.extend((len(message) * 8).to_bytes(8, "big"))
    return bytes(padded)
""",
    ),
    (
        "hard-coded: one block of zeros whatever the message",
        """
def pad_message(message):
    return bytes(64)
""",
    ),
    (
        "the filler is 0xff instead of 0x00",
        """
def pad_message(message):
    padded = bytearray(message)
    padded.append(0x80)
    while len(padded) % 64 != 56:
        padded.append(0xFF)
    padded.extend((len(message) * 8).to_bytes(8, "big"))
    return bytes(padded)
""",
    ),
]

#: Each entry defines `block_words` with one defect.
WORD_MUTATIONS: list[tuple[str, str]] = [
    (
        "little-endian words (the shipped starter's second defect)",
        """
def block_words(block):
    return [int.from_bytes(block[i:i + 4], "little") for i in range(0, 64, 4)]
""",
    ),
    (
        "overlapping groups: stride 1 instead of 4",
        """
def block_words(block):
    return [int.from_bytes(block[i:i + 4], "big") for i in range(0, 64)]
""",
    ),
    (
        "the words come back in reverse order",
        """
def block_words(block):
    words = [int.from_bytes(block[i:i + 4], "big") for i in range(0, 64, 4)]
    return list(reversed(words))
""",
    ),
    (
        "each 16-bit half is byte-swapped",
        """
def block_words(block):
    words = []
    for i in range(0, 64, 4):
        group = block[i:i + 4]
        words.append(int.from_bytes(bytes([group[1], group[0], group[3], group[2]]), "big"))
    return words
""",
    ),
    (
        "hard-coded: sixteen zeros",
        """
def block_words(block):
    return [0] * 16
""",
    ),
    (
        "words are 8 bytes wide, so only eight come back",
        """
def block_words(block):
    return [int.from_bytes(block[i:i + 8], "big") for i in range(0, 64, 8)]
""",
    ),
]


def _load(source: str, symbol: str):
    namespace: dict[str, object] = {}
    exec(compile(source, "<mutation>", "exec"), namespace)  # noqa: S102 - our own fixtures
    return namespace[symbol]


def _verifier_mutations() -> list[tuple[str, bool]]:
    """(name, accepted) for each wrong answer the verifier must reject.

    This covers the defect that cannot be written as a broken submission: a verifier that
    answers `correct: true` unconditionally, or one that compares the wrong quantity. The
    `pad` and `words` checkpoints import one symbol each, so a source carrying only that
    function is a complete submission for them.
    """
    from verifier.server import evaluate  # noqa: PLC0415 - imported late, after sys.path

    case = text_case(SEED)
    bit_length = length_field_case(SEED) * 8
    return [
        ("verifier accepts zero-only padding for `pad`", evaluate("pad", PAD_MUTATIONS[0][1])),
        ("verifier accepts little-endian words", evaluate("words", WORD_MUTATIONS[0][1])),
        (
            "verifier accepts a character count for `byte-length`",
            evaluate("byte-length", case.char_length),
        ),
        (
            "verifier accepts a byte count for `length-field`",
            evaluate("length-field", length_field_case(SEED).to_bytes(8, "big").hex()),
        ),
        (
            "verifier accepts a little-endian `length-field`",
            evaluate("length-field", bit_length.to_bytes(8, "little").hex()),
        ),
        (
            "verifier accepts the original message as its own collision",
            evaluate("collision", collision_message(SEED).hex()),
        ),
        ("verifier accepts an empty `collision`", evaluate("collision", "")),
        ("verifier accepts an unknown checkpoint", evaluate("no-such-checkpoint", "anything")),
    ]


def main() -> int:
    survivors: list[str] = []

    reference_source = (Path(__file__).resolve().parent / "reference" / "padding.py").read_text(
        encoding="utf-8"
    )
    if run_pad(_load(reference_source, "pad_message"), SEED):
        print("FAIL reference `pad_message` does not pass the hidden tests")
        return 1
    if run_words(_load(reference_source, "block_words"), SEED):
        print("FAIL reference `block_words` does not pass the hidden tests")
        return 1
    print("PASS reference implementation passes both hidden suites")

    for name, source in PAD_MUTATIONS:
        failures = run_pad(_load(source, "pad_message"), SEED)
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            survivors.append(name)
            print(f"SURVIVED {name}")

    for name, source in WORD_MUTATIONS:
        failures = run_words(_load(source, "block_words"), SEED)
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            survivors.append(name)
            print(f"SURVIVED {name}")

    verifier_checks = _verifier_mutations()
    for name, accepted in verifier_checks:
        if accepted:
            survivors.append(name)
            print(f"SURVIVED {name}")
        else:
            print(f"KILLED {name}")

    print()
    if survivors:
        print(f"{len(survivors)} mutation(s) survived:")
        for name in survivors:
            print(f"  - {name}")
        return 1
    total = len(PAD_MUTATIONS) + len(WORD_MUTATIONS) + len(verifier_checks)
    print(f"All {total} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
