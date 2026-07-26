"""Public tests: they show you the shape of the answer. They do not prove it.

Read them, then read `misconception.public-tests-are-complete` in the README. These tests
pass for at least one implementation the hidden tests reject — most importantly, one that
compresses only the first block, because every message here fits in one block.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import round_case  # noqa: E402
from given.primitives import INITIAL_STATE, K, MASK, message_schedules  # noqa: E402
from starter.compress import (  # noqa: E402
    compress_block,
    compress_rounds,
    invert_round,
    invert_rounds,
    round_step,
    sha256_hex,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

ABC_DIGEST = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


def test_a_round_returns_eight_words() -> None:
    case = round_case(SEED)
    result = round_step(case.state, K[case.round_index], case.schedule_word)
    assert len(result) == 8
    for word in result:
        assert 0 <= word <= MASK


def test_a_round_shifts_six_words_along() -> None:
    # b, c, d and f, g, h of the result are just a, b, c and e, f, g of the input.
    case = round_case(SEED)
    a, b, c, _d, e, f, g, _h = case.state
    result = round_step(case.state, K[case.round_index], case.schedule_word)
    assert tuple(result[1:4]) == (a, b, c)
    assert tuple(result[5:8]) == (e, f, g)


def test_sixty_four_rounds_keep_the_state_a_state() -> None:
    case = round_case(SEED)
    schedule = message_schedules(b"abc")[0]
    result = compress_rounds(case.state, schedule)
    assert len(result) == 8
    for word in result:
        assert 0 <= word <= MASK


def test_inverting_one_round_restores_the_state() -> None:
    case = round_case(SEED)
    forward = round_step(case.state, K[case.round_index], case.schedule_word)
    back = invert_round(forward, K[case.round_index], case.schedule_word)
    assert tuple(back) == tuple(case.state)


def test_inverting_the_rounds_restores_the_state() -> None:
    case = round_case(SEED)
    schedule = message_schedules(b"abc")[0]
    forward = compress_rounds(case.state, schedule)
    assert tuple(invert_rounds(forward, schedule)) == tuple(case.state)


def test_a_block_compression_returns_eight_words() -> None:
    schedule = message_schedules(b"abc")[0]
    result = compress_block(tuple(INITIAL_STATE), schedule)
    assert len(result) == 8
    for word in result:
        assert 0 <= word <= MASK


def test_the_digest_is_sixty_four_lower_case_hex_characters() -> None:
    digest = sha256_hex(b"abc")
    assert len(digest) == 64
    assert digest == digest.lower()
    int(digest, 16)


def test_the_published_abc_vector() -> None:
    # FIPS 180-4's own worked example. One block, so the starter's "first block only"
    # defect passes it -- which is exactly why this test alone proves nothing.
    assert sha256_hex(b"abc") == ABC_DIGEST


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
        except Exception as error:  # noqa: BLE001 - a raising implementation is a failing one
            failures += 1
            print(f"FAIL {name}: raised {type(error).__name__}")
    print()
    if selected == 0:
        print(f"no public test matched --only {only!r}")
        return 1
    print("public tests:", "all passed" if failures == 0 else f"{failures} failed")
    print()
    print("Passing these does not mean you are done. Every message here fits in one")
    print("block, so an implementation that compresses only the first block passes")
    print("all of them -- including the published `abc` vector.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
