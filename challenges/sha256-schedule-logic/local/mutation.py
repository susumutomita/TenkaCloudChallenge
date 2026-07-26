"""Mutation suite: break the reference on purpose and assert the hidden tests notice.

This is the check that keeps the hidden suite honest. A green test run against a
correct solution proves nothing about whether the tests would catch a wrong one.

Each mutation replaces ONE function of the reference and leaves the rest intact, so a
failure is attributable. That also means the three suites stay honestly separated: a
broken sigma must be killed by `run_sigma` and must NOT be reported by `run_schedule`,
which is asserted below rather than assumed.

Run inside the image (or in CI):  python mutation.py
Exit code 0 means every mutation was killed.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import ModuleType

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import MASK, dependency_case, mux_case, rotate_case
from tests.hidden.check_schedule import run_logic, run_schedule, run_sigma

SEED = "mutation-suite-seed"

REFERENCE = Path(__file__).resolve().parent / "reference" / "schedule.py"

# (suite, name, function name, replacement source). The replacement is spliced over that
# one name in a fresh copy of the reference module.
#
# Equivalent mutants are deliberately absent. Five obvious-looking candidates are
# mathematically identical to the reference, so no correct test can distinguish them:
#   - `rotr` without the `amount %= 32` normalization, since every call site passes an
#     amount in 1..31 already;
#   - Maj written as `(a & b) | (a & c) | (b & c)`, which equals the xor form for exactly
#     the reason Maj works at all: at most one of the three pairwise terms can be the odd
#     one out, so no position ever has two terms to cancel;
#   - Ch written with `|` instead of `^` between its two halves, because `e & f` and
#     `~e & g` are disjoint by construction — the selector cannot be 1 and 0 at once;
#   - Ch written as `(e & f) ^ (~e & g)`, dropping the mask on the complement. `~e` really
#     is negative in Python, but `g` is a non-negative word, and `(~e) & g` keeps only bits
#     `g` already had — so the mask changes nothing HERE. It would matter the moment the
#     complement met anything other than an immediate `&` with a word;
#   - masking the schedule sum once at the end of the four additions rather than after
#     each one, which agrees because addition modulo 2**32 is associative.
# The third and fourth were in this list until they survived a run. Listing an equivalent
# mutant produces a permanent "survived" that trains authors to ignore the suite; before
# adding one, convince yourself it changes an observable output for some input.
MUTATIONS: list[tuple[str, str, str, str]] = [
    (
        "sigma",
        "rotr shifts instead of rotating",
        "rotr",
        """
def rotr(value, amount):
    return (value >> (amount % 32)) & 0xFFFFFFFF
""",
    ),
    (
        "sigma",
        "rotr rotates left",
        "rotr",
        """
def rotr(value, amount):
    amount %= 32
    return ((value << amount) | (value >> (32 - amount))) & 0xFFFFFFFF
""",
    ),
    (
        "sigma",
        "rotr forgets to trim to 32 bits",
        "rotr",
        """
def rotr(value, amount):
    amount %= 32
    return (value >> amount) | (value << (32 - amount))
""",
    ),
    (
        "sigma",
        "small_sigma0's third term rotates where the spec shifts",
        "small_sigma0",
        """
def small_sigma0(word):
    return rotr(word, 7) ^ rotr(word, 18) ^ rotr(word, 3)
""",
    ),
    (
        "sigma",
        "small_sigma1's third term rotates where the spec shifts",
        "small_sigma1",
        """
def small_sigma1(word):
    return rotr(word, 17) ^ rotr(word, 19) ^ rotr(word, 10)
""",
    ),
    (
        "sigma",
        "small_sigma1 uses small_sigma0's amounts",
        "small_sigma1",
        """
def small_sigma1(word):
    return rotr(word, 7) ^ rotr(word, 18) ^ (word >> 3)
""",
    ),
    (
        "sigma",
        "big_sigma0 uses big_sigma1's amounts",
        "big_sigma0",
        """
def big_sigma0(word):
    return rotr(word, 6) ^ rotr(word, 11) ^ rotr(word, 25)
""",
    ),
    (
        "sigma",
        "big_sigma1 shifts its third term, so it is no longer rotation-only",
        "big_sigma1",
        """
def big_sigma1(word):
    return rotr(word, 6) ^ rotr(word, 11) ^ (word >> 25)
""",
    ),
    (
        "sigma",
        "a sigma adds its terms instead of xoring them",
        "small_sigma0",
        """
def small_sigma0(word):
    return (rotr(word, 7) + rotr(word, 18) + (word >> 3)) & 0xFFFFFFFF
""",
    ),
    (
        "logic",
        "choose drops the complement, so both branches read the selector",
        "choose",
        """
def choose(e, f, g):
    return (e & f) ^ (e & g)
""",
    ),
    (
        "logic",
        "choose reads f as the selector instead of e",
        "choose",
        """
def choose(e, f, g):
    return (f & e) ^ (~f & 0xFFFFFFFF & g)
""",
    ),
    (
        "logic",
        "choose swaps its branches, taking g where the selector is 1",
        "choose",
        """
def choose(e, f, g):
    return (e & g) ^ (~e & 0xFFFFFFFF & f)
""",
    ),
    (
        "logic",
        "majority returns the parity instead",
        "majority",
        """
def majority(a, b, c):
    return a ^ b ^ c
""",
    ),
    (
        "logic",
        "majority drops one of the three pairwise terms",
        "majority",
        """
def majority(a, b, c):
    return (a & b) ^ (a & c)
""",
    ),
    (
        "logic",
        "majority returns the unanimous bits only",
        "majority",
        """
def majority(a, b, c):
    return a & b & c
""",
    ),
    (
        "schedule",
        "the schedule xors its four terms instead of adding them",
        "expand_schedule",
        """
def expand_schedule(words):
    schedule = list(words)
    for index in range(16, 64):
        schedule.append(
            schedule[index - 16]
            ^ small_sigma0(schedule[index - 15])
            ^ schedule[index - 7]
            ^ small_sigma1(schedule[index - 2])
        )
    return schedule
""",
    ),
    (
        "schedule",
        "the schedule reads W[i-14] where the spec reads W[i-15]",
        "expand_schedule",
        """
def expand_schedule(words):
    schedule = list(words)
    for index in range(16, 64):
        schedule.append((
            schedule[index - 16]
            + small_sigma0(schedule[index - 14])
            + schedule[index - 7]
            + small_sigma1(schedule[index - 2])
        ) & 0xFFFFFFFF)
    return schedule
""",
    ),
    (
        "schedule",
        "the schedule swaps which term each sigma is applied to",
        "expand_schedule",
        """
def expand_schedule(words):
    schedule = list(words)
    for index in range(16, 64):
        schedule.append((
            schedule[index - 16]
            + small_sigma1(schedule[index - 15])
            + schedule[index - 7]
            + small_sigma0(schedule[index - 2])
        ) & 0xFFFFFFFF)
    return schedule
""",
    ),
    (
        "schedule",
        "the schedule never wraps, so words grow past 32 bits",
        "expand_schedule",
        """
def expand_schedule(words):
    schedule = list(words)
    for index in range(16, 64):
        schedule.append(
            schedule[index - 16]
            + small_sigma0(schedule[index - 15])
            + schedule[index - 7]
            + small_sigma1(schedule[index - 2])
        )
    return schedule
""",
    ),
    (
        "schedule",
        "the schedule stops at 48 words",
        "expand_schedule",
        """
def expand_schedule(words):
    schedule = list(words)
    for index in range(16, 48):
        schedule.append((
            schedule[index - 16]
            + small_sigma0(schedule[index - 15])
            + schedule[index - 7]
            + small_sigma1(schedule[index - 2])
        ) & 0xFFFFFFFF)
    return schedule
""",
    ),
    (
        "schedule",
        "the schedule overwrites the 16 words it was given",
        "expand_schedule",
        """
def expand_schedule(words):
    schedule = [0] * 16
    for index in range(16, 64):
        schedule.append((
            schedule[index - 16]
            + small_sigma0(schedule[index - 15])
            + schedule[index - 7]
            + small_sigma1(schedule[index - 2])
        ) & 0xFFFFFFFF)
    return schedule
""",
    ),
]

SUITES = {"sigma": run_sigma, "logic": run_logic, "schedule": run_schedule}


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


def _verifier_mutations() -> list[tuple[str, bool]]:
    """(name, accepted) for each wrong answer the verifier must reject.

    This covers the defect that cannot be written as a broken submission: a verifier that
    answers `correct: true` unconditionally, or one that compares the wrong quantity.
    """
    from verifier.server import evaluate, first_affected_index  # noqa: PLC0415 - after sys.path

    rotate = rotate_case(SEED)
    mux = mux_case(SEED)
    amount = rotate.rotate_by % 32
    rotated = ((rotate.word >> amount) | (rotate.word << (32 - amount))) & MASK
    shifted = rotate.word >> rotate.shift_by
    index = first_affected_index()
    return [
        (
            "verifier accepts a shift where a rotation was asked for",
            evaluate("rotate", f"{rotate.word >> amount:08x},{shifted:08x}"),
        ),
        (
            "verifier accepts the two words in the wrong order",
            evaluate("rotate", f"{shifted:08x},{rotated:08x}"),
        ),
        ("verifier accepts one word where two were asked for", evaluate("rotate", f"{rotated:08x}")),
        (
            "verifier accepts a value wider than a word",
            evaluate("rotate", f"1{rotated:08x},{shifted:08x}"),
        ),
        (
            "verifier accepts majority for the mux",
            evaluate("mux", f"{(mux.e & mux.f) | (mux.e & mux.g) | (mux.f & mux.g):08x}"),
        ),
        ("verifier accepts parity for the mux", evaluate("mux", f"{mux.e ^ mux.f ^ mux.g:08x}")),
        (
            "verifier accepts the schedule index one too high",
            evaluate("dependency", str(index + 1)),
        ),
        ("verifier accepts 16 for every dependency case", evaluate("dependency", "16") and index != 16),
        ("verifier accepts a non-numeric dependency answer", evaluate("dependency", "sixteen")),
        ("verifier accepts an unknown checkpoint", evaluate("no-such-checkpoint", "anything")),
        (
            "verifier accepts a submission the hidden sigma suite rejects",
            evaluate("sigma", MUTATIONS[0][3]),
        ),
        ("verifier accepts an empty submission", evaluate("schedule", "   ")),
    ]


def main() -> int:
    survivors: list[str] = []

    reference = _load()
    for suite, run in SUITES.items():
        failures = run(reference, SEED)
        if failures:
            print(f"FAIL reference does not pass the hidden {suite} suite: {failures[0]}")
            return 1
    print("PASS reference implementation passes all three hidden suites")

    for suite, name, symbol, source in MUTATIONS:
        mutant = _load(source, symbol)
        failures = SUITES[suite](mutant, SEED)
        if failures:
            print(f"KILLED [{suite}] {name} ({failures[0]})")
        else:
            survivors.append(f"[{suite}] {name}")
            print(f"SURVIVED [{suite}] {name}")

    # The suites must stay separated, not just strict. A broken sigma has to fail `sigma`
    # and NOT be reported by `schedule`, because `schedule` scores the recurrence and uses
    # the learner's own sigmas to do it. Without this, the three checkpoints would collapse
    # into "one mistake, three deductions" and nobody would notice.
    for suite, name, symbol, source in MUTATIONS:
        if suite != "sigma" or symbol == "rotr":
            # A broken `rotr` puts sigma output outside 32 bits, which the schedule suite
            # legitimately rejects on its own range check. Only the sigma-amount mutations
            # are expected to be invisible to it.
            continue
        if run_schedule(_load(source, symbol), SEED):
            survivors.append(f"[separation] {name} leaked into the schedule suite")
            print(f"SURVIVED [separation] {name} leaked into the schedule suite")
        else:
            print(f"KILLED [separation] {name} stays out of the schedule suite")

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
    print(f"All {len(MUTATIONS) + len(verifier_checks)} mutations killed, plus the separation checks.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
