"""Mutation suite: break the reference on purpose and assert the hidden tests notice.

This is the check that keeps the hidden suite honest. A green test run against a
correct solution proves nothing about whether the tests would catch a wrong one.

Each mutation replaces ONE function of the reference and leaves the rest intact, so a
failure is attributable.

Run inside the image (or in CI):  python mutation.py
Exit code 0 means every mutation was killed.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import ModuleType

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import DIGEST_BITS, property_quiz, quiz_answer, storage_quiz
from tests.hidden.check_compress import (
    run_compress,
    run_digest,
    run_feedforward,
    run_round,
)

SEED = "mutation-suite-seed"

REFERENCE = Path(__file__).resolve().parent / "reference" / "compress.py"

# (suite, name, function name, replacement source).
#
# Equivalent mutants are deliberately absent. Five obvious-looking candidates are
# mathematically identical to the reference and no correct test can distinguish them:
#   - masking T1 and T2 once at the end instead of after each addition, since addition
#     modulo 2**32 is associative;
#   - building the new state as a list and converting, rather than as a tuple;
#   - `(d + t1) & MASK` written as `(t1 + d) & MASK`;
#   - in `invert_round`, subtracting the five T1 terms in any other order;
#   - passing `round_step` the schedule word and the round constant the other way round.
#     That last one was in this list until it survived a run, and it deserves the space:
#     T1 only ever ADDS the two, so no output distinguishes them. A learner who swaps them
#     has written correct code, and a test that failed them would be the wrong test.
# Listing an equivalent mutant produces a permanent "survived" that trains authors to
# ignore the suite. Before adding one, convince yourself it changes an observable output.
MUTATIONS: list[tuple[str, str, str, str]] = [
    (
        "round",
        "T1 leaves out the round constant",
        "round_step",
        """
def round_step(state, round_constant, schedule_word):
    a, b, c, d, e, f, g, h = state
    t1 = (h + big_sigma1(e) + choose(e, f, g) + schedule_word) & MASK
    t2 = (big_sigma0(a) + majority(a, b, c)) & MASK
    return ((t1 + t2) & MASK, a, b, c, (d + t1) & MASK, e, f, g)
""",
    ),
    (
        "round",
        "T1 leaves out the schedule word",
        "round_step",
        """
def round_step(state, round_constant, schedule_word):
    a, b, c, d, e, f, g, h = state
    t1 = (h + big_sigma1(e) + choose(e, f, g) + round_constant) & MASK
    t2 = (big_sigma0(a) + majority(a, b, c)) & MASK
    return ((t1 + t2) & MASK, a, b, c, (d + t1) & MASK, e, f, g)
""",
    ),
    (
        "round",
        "the new e is built from the old e instead of the old d",
        "round_step",
        """
def round_step(state, round_constant, schedule_word):
    a, b, c, d, e, f, g, h = state
    t1 = (h + big_sigma1(e) + choose(e, f, g) + round_constant + schedule_word) & MASK
    t2 = (big_sigma0(a) + majority(a, b, c)) & MASK
    return ((t1 + t2) & MASK, a, b, c, (e + t1) & MASK, e, f, g)
""",
    ),
    (
        "round",
        "the two computed words are swapped",
        "round_step",
        """
def round_step(state, round_constant, schedule_word):
    a, b, c, d, e, f, g, h = state
    t1 = (h + big_sigma1(e) + choose(e, f, g) + round_constant + schedule_word) & MASK
    t2 = (big_sigma0(a) + majority(a, b, c)) & MASK
    return ((d + t1) & MASK, a, b, c, (t1 + t2) & MASK, e, f, g)
""",
    ),
    (
        "round",
        "Sigma0 and Sigma1 are applied to each other's word",
        "round_step",
        """
def round_step(state, round_constant, schedule_word):
    a, b, c, d, e, f, g, h = state
    t1 = (h + big_sigma0(e) + choose(e, f, g) + round_constant + schedule_word) & MASK
    t2 = (big_sigma1(a) + majority(a, b, c)) & MASK
    return ((t1 + t2) & MASK, a, b, c, (d + t1) & MASK, e, f, g)
""",
    ),
    (
        "round",
        "the six shifted words shift the wrong way",
        "round_step",
        """
def round_step(state, round_constant, schedule_word):
    a, b, c, d, e, f, g, h = state
    t1 = (h + big_sigma1(e) + choose(e, f, g) + round_constant + schedule_word) & MASK
    t2 = (big_sigma0(a) + majority(a, b, c)) & MASK
    return ((t1 + t2) & MASK, c, d, b, (d + t1) & MASK, g, h, f)
""",
    ),
    (
        "round",
        "the round output is never wrapped, so words grow past 32 bits",
        "round_step",
        """
def round_step(state, round_constant, schedule_word):
    a, b, c, d, e, f, g, h = state
    t1 = h + big_sigma1(e) + choose(e, f, g) + round_constant + schedule_word
    t2 = big_sigma0(a) + majority(a, b, c)
    return (t1 + t2, a, b, c, d + t1, e, f, g)
""",
    ),
    (
        "compress",
        "the feed-forward addition is missing",
        "compress_block",
        """
def compress_block(state, schedule):
    return compress_rounds(state, schedule)
""",
    ),
    (
        "compress",
        "the feed-forward xors instead of adding",
        "compress_block",
        """
def compress_block(state, schedule):
    working = compress_rounds(state, schedule)
    return tuple(before ^ after for before, after in zip(state, working))
""",
    ),
    (
        "compress",
        "the feed-forward adds the state to itself instead of to the round output",
        "compress_block",
        """
def compress_block(state, schedule):
    compress_rounds(state, schedule)
    return tuple((word + word) & MASK for word in state)
""",
    ),
    (
        "compress",
        "63 rounds instead of 64",
        "compress_rounds",
        """
def compress_rounds(state, schedule):
    working = tuple(state)
    for index in range(SCHEDULE_WORDS - 1):
        working = round_step(working, K[index], schedule[index])
    return working
""",
    ),
    (
        "compress",
        "the rounds run in reverse order",
        "compress_rounds",
        """
def compress_rounds(state, schedule):
    working = tuple(state)
    for index in reversed(range(SCHEDULE_WORDS)):
        working = round_step(working, K[index], schedule[index])
    return working
""",
    ),
    (
        "compress",
        "the schedule is consumed back to front",
        "compress_rounds",
        """
def compress_rounds(state, schedule):
    working = tuple(state)
    for index in range(SCHEDULE_WORDS):
        working = round_step(working, K[index], schedule[SCHEDULE_WORDS - 1 - index])
    return working
""",
    ),
    (
        "feedforward",
        "the inverse gives up on h and leaves it zero",
        "invert_round",
        """
def invert_round(state, round_constant, schedule_word):
    a_after, b_after, c_after, d_after, e_after, f_after, g_after, h_after = state
    a, b, c = b_after, c_after, d_after
    e, f, g = f_after, g_after, h_after
    return (a, b, c, e_after, e, f, g, 0)
""",
    ),
    (
        "feedforward",
        "the inverse recovers T1 from the new e instead of the new a",
        "invert_round",
        """
def invert_round(state, round_constant, schedule_word):
    a_after, b_after, c_after, d_after, e_after, f_after, g_after, h_after = state
    a, b, c = b_after, c_after, d_after
    e, f, g = f_after, g_after, h_after
    t1 = e_after & MASK
    d = (e_after - t1) & MASK
    h = (t1 - big_sigma1(e) - choose(e, f, g) - round_constant - schedule_word) & MASK
    return (a, b, c, d, e, f, g, h)
""",
    ),
    (
        "feedforward",
        "the inverse adds where it should subtract",
        "invert_round",
        """
def invert_round(state, round_constant, schedule_word):
    a_after, b_after, c_after, d_after, e_after, f_after, g_after, h_after = state
    a, b, c = b_after, c_after, d_after
    e, f, g = f_after, g_after, h_after
    t2 = (big_sigma0(a) + majority(a, b, c)) & MASK
    t1 = (a_after + t2) & MASK
    d = (e_after - t1) & MASK
    h = (t1 - big_sigma1(e) - choose(e, f, g) - round_constant - schedule_word) & MASK
    return (a, b, c, d, e, f, g, h)
""",
    ),
    (
        "feedforward",
        "the rounds are undone in forward order",
        "invert_rounds",
        """
def invert_rounds(state, schedule):
    working = tuple(state)
    for index in range(SCHEDULE_WORDS):
        working = invert_round(working, K[index], schedule[index])
    return working
""",
    ),
    (
        "feedforward",
        "the inverse returns its input unchanged",
        "invert_rounds",
        """
def invert_rounds(state, schedule):
    return tuple(state)
""",
    ),
    (
        "digest",
        "only the first block is compressed",
        "sha256_hex",
        """
def sha256_hex(message):
    schedules = message_schedules(message)
    state = compress_block(tuple(INITIAL_STATE), schedules[0])
    return "".join(f"{word:08x}" for word in state)
""",
    ),
    (
        "digest",
        "every block starts from the initial state instead of chaining",
        "sha256_hex",
        """
def sha256_hex(message):
    state = tuple(INITIAL_STATE)
    for schedule in message_schedules(message):
        state = compress_block(tuple(INITIAL_STATE), schedule)
    return "".join(f"{word:08x}" for word in state)
""",
    ),
    (
        "digest",
        "the eight words are printed in reverse order",
        "sha256_hex",
        """
def sha256_hex(message):
    state = tuple(INITIAL_STATE)
    for schedule in message_schedules(message):
        state = compress_block(state, schedule)
    return "".join(f"{word:08x}" for word in reversed(state))
""",
    ),
    (
        "digest",
        "the digest is upper case",
        "sha256_hex",
        """
def sha256_hex(message):
    state = tuple(INITIAL_STATE)
    for schedule in message_schedules(message):
        state = compress_block(state, schedule)
    return "".join(f"{word:08X}" for word in state)
""",
    ),
    (
        "digest",
        "the leading zeros of each word are dropped",
        "sha256_hex",
        """
def sha256_hex(message):
    state = tuple(INITIAL_STATE)
    for schedule in message_schedules(message):
        state = compress_block(state, schedule)
    return "".join(f"{word:x}" for word in state)
""",
    ),
]

SUITES = {
    "round": run_round,
    "compress": run_compress,
    "feedforward": run_feedforward,
    "digest": run_digest,
}


def _load(replacement: str = "", symbol: str = "") -> ModuleType:
    """A fresh module from the reference source, with one function optionally replaced."""
    source = REFERENCE.read_text(encoding="utf-8")
    module = ModuleType("mutant")
    exec(compile(source, "<reference>", "exec"), module.__dict__)  # noqa: S102 - our own file
    if replacement:
        exec(compile(replacement, "<mutation>", "exec"), module.__dict__)  # noqa: S102
        if symbol not in module.__dict__:
            raise KeyError(f"mutation did not define {symbol}")
    return module


def _flip(answer: str, position: int) -> str:
    """One verdict of a quiz answer, inverted."""
    letters = list(answer)
    letters[position] = "F" if letters[position] == "T" else "T"
    return "".join(letters)


def _verifier_mutations() -> list[tuple[str, bool]]:
    """(name, accepted) for each wrong answer the verifier must reject.

    This covers the defect that cannot be written as a broken submission: a verifier that
    answers `correct: true` unconditionally, or one that compares the wrong quantity.
    """
    from verifier.server import avalanche_distance, evaluate  # noqa: PLC0415 - after sys.path

    distance = avalanche_distance()
    properties = quiz_answer(property_quiz(SEED))
    storage = quiz_answer(storage_quiz(SEED))
    checks = [
        ("verifier accepts the avalanche distance off by one", evaluate("avalanche", str(distance + 1))),
        ("verifier accepts every bit differing", evaluate("avalanche", str(DIGEST_BITS))),
        ("verifier accepts no bits differing", evaluate("avalanche", "0")),
        ("verifier accepts a non-numeric avalanche answer", evaluate("avalanche", "about half")),
        ("verifier accepts all-true for the properties quiz", evaluate("properties", "T" * len(properties))),
        ("verifier accepts all-false for the properties quiz", evaluate("properties", "F" * len(properties))),
        ("verifier accepts a properties answer of the wrong length", evaluate("properties", properties[:-1])),
        ("verifier accepts all-true for the storage quiz", evaluate("storage", "T" * len(storage))),
        ("verifier accepts a storage answer with one letter wrong", evaluate("storage", _flip(storage, 0))),
        ("verifier accepts a storage answer of unreadable letters", evaluate("storage", "?" * len(storage))),
        ("verifier accepts an unknown checkpoint", evaluate("no-such-checkpoint", "anything")),
        ("verifier accepts an empty code submission", evaluate("digest", "   ")),
        ("verifier accepts a submission the hidden digest suite rejects", evaluate("digest", MUTATIONS[-4][3])),
    ]
    # Every single-letter flip of each quiz must be rejected, not just the first: a verifier
    # that compared only a prefix would pass the checks above.
    for position in range(len(properties)):
        checks.append(
            (
                f"verifier accepts the properties quiz with letter {position + 1} flipped",
                evaluate("properties", _flip(properties, position)),
            )
        )
    return checks


def main() -> int:
    survivors: list[str] = []

    reference = _load()
    for suite, run in SUITES.items():
        failures = run(reference, SEED)
        if failures:
            print(f"FAIL reference does not pass the hidden {suite} suite: {failures[0]}")
            return 1
    print("PASS reference implementation passes all four hidden suites")

    for suite, name, symbol, source in MUTATIONS:
        mutant = _load(source, symbol)
        failures = SUITES[suite](mutant, SEED)
        if failures:
            print(f"KILLED [{suite}] {name} ({failures[0]})")
        else:
            survivors.append(f"[{suite}] {name}")
            print(f"SURVIVED [{suite}] {name}")

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
    print(f"All {len(MUTATIONS) + len(verifier_checks)} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
