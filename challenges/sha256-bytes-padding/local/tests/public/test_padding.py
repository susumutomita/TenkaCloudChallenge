"""Public tests: they show you the shape of the answer. They do not prove it.

Read them, then read `misconception.public-tests-are-complete` in the README. These
tests pass for at least one implementation that the hidden tests reject — for example,
one that writes the length field as eight zero bytes.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import text_case, word_case  # noqa: E402
from starter.padding import BLOCK_BYTES, block_words, pad_message  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def test_padded_length_is_a_multiple_of_the_block() -> None:
    message = text_case(SEED).text.encode("utf-8")
    padded = pad_message(message)
    assert len(padded) % BLOCK_BYTES == 0
    assert len(padded) > 0


def test_padding_keeps_the_message_as_its_prefix() -> None:
    message = text_case(SEED).text.encode("utf-8")
    assert pad_message(message).startswith(message)


def test_the_first_padding_byte_is_the_one_bit() -> None:
    message = text_case(SEED).text.encode("utf-8")
    assert pad_message(message)[len(message)] == 0x80


def test_the_empty_message_still_gets_a_block() -> None:
    assert len(pad_message(b"")) == BLOCK_BYTES


def test_block_words_returns_sixteen_32_bit_values() -> None:
    words = block_words(word_case(SEED))
    assert len(words) == 16
    for word in words:
        assert 0 <= word < 2**32


def test_block_words_reads_the_first_byte_as_most_significant() -> None:
    block = word_case(SEED)
    first = block_words(block)[0]
    assert first >> 24 == block[0]


def main() -> int:
    # `--only <substring>` backs `make test-one ID=...`: iterate on one behaviour
    # without re-reading the whole run.
    only = ""
    if "--only" in sys.argv:
        index = sys.argv.index("--only")
        only = sys.argv[index + 1] if index + 1 < len(sys.argv) else ""

    failures = 0
    selected = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        if only and only not in name:
            continue
        selected += 1
        try:
            fn()
            print(f"PASS {name}")
        except AssertionError as error:
            failures += 1
            print(f"FAIL {name}: {error or 'assertion failed'}")
    print()
    if selected == 0:
        print(f"no public test matched --only {only!r}")
        return 1
    print("public tests:", "all passed" if failures == 0 else f"{failures} failed")
    print()
    print("Passing these does not mean you are done. They never check the length")
    print("field's value, they only use one message length, and they only look at")
    print("the first of the sixteen words.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
