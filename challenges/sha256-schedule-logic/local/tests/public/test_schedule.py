"""Public tests: they show you the shape of the answer. They do not prove it.

Read them, then read `misconception.public-tests-are-complete` in the README. These
tests pass for at least one implementation that the hidden tests reject — for example,
a schedule that xors its four terms instead of adding them passes every test here,
because the only block they use is the all-zero one, where xor and addition agree.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

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


def _load_public_evidence() -> dict[str, object]:
    """This deployment's rotate/mux cases -- the same things `show.py` prints.

    Issue 537/538: this file used to import `fixtures.generate` directly. That module
    also derives `dependency`'s and `verifier/server.py`'s comparisons, so it does not
    ship in the `participant` Docker stage at all any more (see ../../Dockerfile). This
    deployment's own verifier is the only source for the public half now:
    `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched it, or
    `VERIFIER_PUBLIC_URL` fetched directly when it has not.
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
    # scripts/sha256-schedule-logic.test.ts) and the verifier/author Docker stages, and
    # never inside a built `participant` image -- so this branch does not reopen the
    # leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _load_public_evidence()


def _rotate() -> SimpleNamespace:
    rotate = PUBLIC["rotate"]
    return SimpleNamespace(
        word=rotate["word"], rotate_by=rotate["rotateBy"], shift_by=rotate["shiftBy"]
    )


def _mux() -> SimpleNamespace:
    return SimpleNamespace(**PUBLIC["mux"])


def test_rotation_stays_inside_a_word() -> None:
    case = _rotate()
    assert 0 <= rotr(case.word, case.rotate_by) <= MASK


def test_rotation_by_zero_changes_nothing() -> None:
    case = _rotate()
    assert rotr(case.word, 0) == case.word


def test_rotation_loses_no_bits() -> None:
    # A rotation is a permutation of the 32 positions, so the population count is fixed.
    case = _rotate()
    assert bin(rotr(case.word, case.rotate_by)).count("1") == bin(case.word).count("1")


def test_every_sigma_returns_a_word() -> None:
    case = _rotate()
    for sigma in SIGMAS:
        assert 0 <= sigma(case.word) <= MASK


def test_sigma_of_zero_is_zero() -> None:
    # Rotations and shifts of zero are zero, so every sigma has to agree here.
    for sigma in SIGMAS:
        assert sigma(0) == 0


def test_choose_takes_f_where_the_selector_is_all_ones() -> None:
    case = _mux()
    assert choose(MASK, case.f, case.g) == case.f


def test_choose_takes_g_where_the_selector_is_all_zero() -> None:
    case = _mux()
    assert choose(0, case.f, case.g) == case.g


def test_majority_of_three_equal_words_is_that_word() -> None:
    case = _mux()
    assert majority(case.f, case.f, case.f) == case.f


def test_schedule_has_sixty_four_words_and_keeps_the_first_sixteen() -> None:
    case = _mux()
    words = [case.e, case.f, case.g] * 5 + [_rotate().word]
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
