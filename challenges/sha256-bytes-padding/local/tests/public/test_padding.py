"""Public tests: they show you the shape of the answer. They do not prove it.

Read them, then read `misconception.public-tests-are-complete` in the README. These
tests pass for at least one implementation that the hidden tests reject — for example,
one that writes the length field as eight zero bytes.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from starter.padding import BLOCK_BYTES, block_words, pad_message  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict[str, object]:
    """This deployment's string and 64-byte block -- the same things `show.py` and the
    Portal print.

    Issue 543/537: this file used to import `fixtures.generate` directly. That module
    also defines `padded_length` and `broken_pad_zeros_only`, which are the answers to
    the `padded-length` and `collision` checkpoints, so it does not ship in the
    `participant` Docker stage at all any more (see ../../Dockerfile). This deployment's
    own verifier is the only source for the public half now: `PUBLIC_EVIDENCE_JSON` when
    the Portal has already fetched it, or `VERIFIER_PUBLIC_URL` fetched directly when it
    has not.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.request import urlopen

        with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    # Neither is set: this only resolves when `fixtures/` is actually on disk, which is
    # true for a checkout (this file run directly, e.g. by
    # scripts/sha256-bytes-padding.test.ts) and the verifier/author Docker stages, and
    # never inside a built `participant` image -- so this branch existing does not
    # reopen Issue 543/537's leak.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _load_public_evidence()
MESSAGE = str(PUBLIC["text"]).encode("utf-8")
WORD_BLOCK = bytes.fromhex(str(PUBLIC["wordBlockHex"]))


def test_padded_length_is_a_multiple_of_the_block() -> None:
    padded = pad_message(MESSAGE)
    assert len(padded) % BLOCK_BYTES == 0
    assert len(padded) > 0


def test_padding_keeps_the_message_as_its_prefix() -> None:
    assert pad_message(MESSAGE).startswith(MESSAGE)


def test_the_first_padding_byte_is_the_one_bit() -> None:
    assert pad_message(MESSAGE)[len(MESSAGE)] == 0x80


def test_the_empty_message_still_gets_a_block() -> None:
    assert len(pad_message(b"")) == BLOCK_BYTES


def test_block_words_returns_sixteen_32_bit_values() -> None:
    words = block_words(WORD_BLOCK)
    assert len(words) == 16
    for word in words:
        assert 0 <= word < 2**32


def test_block_words_reads_the_first_byte_as_most_significant() -> None:
    block = WORD_BLOCK
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
