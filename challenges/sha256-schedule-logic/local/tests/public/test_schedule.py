"""Public tests: they show you the shape of the answer. They do not prove it.

Read them, then read `misconception.public-tests-are-complete` in the README. These
tests pass for at least one implementation that the hidden tests reject — for example,
a schedule that xors its four terms instead of adding them passes every test here,
because the only block they use is the all-zero one, where xor and addition agree.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import mux_case, rotate_case  # noqa: E402
from starter.schedule import (  # noqa: E402
    MASK,
    SCHEDULE_WORDS,
    WORDS_PER_BLOCK,
    big_sigma0,
    big_sigma1,
    choose,
    expand_schedule,
    majority,
    rotr,
    small_sigma0,
    small_sigma1,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

SIGMAS = (small_sigma0, small_sigma1, big_sigma0, big_sigma1)


def test_rotation_stays_inside_a_word() -> None:
    case = rotate_case(SEED)
    assert 0 <= rotr(case.word, case.rotate_by) <= MASK


def test_rotation_by_zero_changes_nothing() -> None:
    case = rotate_case(SEED)
    assert rotr(case.word, 0) == case.word


def test_rotation_loses_no_bits() -> None:
    # A rotation is a permutation of the 32 positions, so the population count is fixed.
    case = rotate_case(SEED)
    assert bin(rotr(case.word, case.rotate_by)).count("1") == bin(case.word).count("1")


def test_every_sigma_returns_a_word() -> None:
    case = rotate_case(SEED)
    for sigma in SIGMAS:
        assert 0 <= sigma(case.word) <= MASK


def test_sigma_of_zero_is_zero() -> None:
    # Rotations and shifts of zero are zero, so every sigma has to agree here.
    for sigma in SIGMAS:
        assert sigma(0) == 0


def test_choose_takes_f_where_the_selector_is_all_ones() -> None:
    case = mux_case(SEED)
    assert choose(MASK, case.f, case.g) == case.f


def test_choose_takes_g_where_the_selector_is_all_zero() -> None:
    case = mux_case(SEED)
    assert choose(0, case.f, case.g) == case.g


def test_majority_of_three_equal_words_is_that_word() -> None:
    case = mux_case(SEED)
    assert majority(case.f, case.f, case.f) == case.f


def test_schedule_has_sixty_four_words_and_keeps_the_first_sixteen() -> None:
    case = mux_case(SEED)
    words = [case.e, case.f, case.g] * 5 + [rotate_case(SEED).word]
    schedule = expand_schedule(words)
    assert len(schedule) == SCHEDULE_WORDS
    assert schedule[:WORDS_PER_BLOCK] == words


def test_schedule_of_an_all_zero_block_is_all_zero() -> None:
    assert expand_schedule([0] * WORDS_PER_BLOCK) == [0] * SCHEDULE_WORDS


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
    print("Passing these does not mean you are done. They never compare a sigma")
    print("against its specified rotation amounts, they never distinguish Ch from")
    print("Maj on a mixed selector, and the only block they expand is all zeros —")
    print("where xor and addition give the same answer.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
