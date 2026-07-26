"""Hidden tests. Run by /verify against a copy of the learner's file, never shown to them.

Three entry points, one per code checkpoint, each taking the learner's module so a missing
function is a named failure rather than an import error.

The three are deliberately independent. `run_schedule` checks the recurrence using the
learner's OWN sigma functions, so a correct expansion built on wrong sigmas still passes it
— wrong sigmas are what `run_sigma` is for. A checkpoint that scored both would report one
mistake twice and tell the learner less.

Failure messages name the property, never the expected value.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import ModuleType

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    MASK,
    SCHEDULE_WORDS,
    WORD_BITS,
    WORDS_PER_BLOCK,
    hidden_blocks,
    hidden_triples,
    hidden_words,
)

#: The specified rotation amounts, and whether the third term is a shift.
SIGMA_SPEC = {
    "small_sigma0": ((7, 18), 3),
    "small_sigma1": ((17, 19), 10),
    "big_sigma0": ((2, 13, 22), None),
    "big_sigma1": ((6, 11, 25), None),
}


def _rotr(value: int, amount: int) -> int:
    """The checker's own rotation. Never the learner's — that is what is being checked."""
    amount %= WORD_BITS
    return ((value >> amount) | (value << (WORD_BITS - amount))) & MASK


def _expected_sigma(name: str, word: int) -> int:
    amounts, shift = SIGMA_SPEC[name]
    result = 0
    for amount in amounts:
        result ^= _rotr(word, amount)
    if shift is not None:
        result ^= word >> shift
    return result


def _resolve(module: ModuleType, names: tuple[str, ...]) -> tuple[list[object], list[str]]:
    """Fetch the callables a checkpoint needs, reporting the missing ones by name."""
    found: list[object] = []
    missing: list[str] = []
    for name in names:
        attribute = getattr(module, name, None)
        if not callable(attribute):
            missing.append(f"{name} is missing or is not callable")
        found.append(attribute)
    return found, missing


def _is_word(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= MASK


def _guard(label: str, action) -> tuple[object, list[str]]:
    """Call `action`, turning any exception into a failure naming what was being checked."""
    try:
        return action(), []
    except Exception as error:  # noqa: BLE001 - a raising implementation is a failing one
        return None, [f"raised {type(error).__name__} while checking {label}"]


def _check_rotr(rotr, seed: str) -> list[str]:
    failures: list[str] = []
    for word in hidden_words(seed):
        for amount in (0, 1, 3, 7, 16, 25, 31, 32):
            value, error = _guard(f"rotr by {amount}", lambda: rotr(word, amount))
            if error:
                return error
            if not _is_word(value):
                failures.append("a rotation result is not a 32-bit word")
                return failures
            if bin(value).count("1") != bin(word).count("1"):
                failures.append("a rotation changed how many bits are set, so bits were lost")
                return failures
            if value != _rotr(word, amount):
                failures.append("a rotation does not match rotating right by that amount")
                return failures
        # Rotating back by the complement must restore the word: rotation is invertible.
        restored, error = _guard("rotation inverse", lambda: rotr(rotr(word, 11), WORD_BITS - 11))
        if error:
            return error
        if restored != word:
            failures.append("rotating right then rotating back did not restore the word")
            return failures
    return failures


def _check_sigma(name: str, sigma, seed: str) -> list[str]:
    failures: list[str] = []
    words = hidden_words(seed)
    for word in words:
        value, error = _guard(name, lambda: sigma(word))
        if error:
            return error
        if not _is_word(value):
            return [f"{name} did not return a 32-bit word"]
        if value != _expected_sigma(name, word):
            return [f"{name} does not match its specified rotation and shift amounts"]

    # Every sigma is linear over GF(2): xor of rotations and shifts distributes over xor.
    # A relation, so it cannot be satisfied by memorizing one output.
    for left, right in zip(words, words[1:]):
        pair, error = _guard(
            f"{name} linearity", lambda: (sigma(left ^ right), sigma(left) ^ sigma(right))
        )
        if error:
            return error
        if pair[0] != pair[1]:
            failures.append(f"{name} is not linear over xor, so it is not rotations and shifts")
            return failures
    return failures


def _bitwise_majority(a: int, b: int, c: int) -> int:
    return (a & b) | (a & c) | (b & c)


def _check_choose(choose, seed: str) -> list[str]:
    for e, f, g in hidden_triples(seed):
        value, error = _guard("choose", lambda: choose(e, f, g))
        if error:
            return error
        if not _is_word(value):
            return ["choose did not return a 32-bit word"]
        # The mux, written the other way round: or instead of xor. The two agree only when
        # the branches are disjoint, which is what makes Ch a selection.
        if value != (e & f) | (~e & MASK & g):
            return ["choose does not select f where the selector is 1 and g where it is 0"]
        same, error = _guard("choose with equal branches", lambda: choose(e, f, f))
        if error:
            return error
        if same != f:
            return ["choose with both choices equal did not return that value"]
    return []


def _check_majority(majority, seed: str) -> list[str]:
    for a, b, c in hidden_triples(seed):
        value, error = _guard("majority", lambda: majority(a, b, c))
        if error:
            return error
        if not _is_word(value):
            return ["majority did not return a 32-bit word"]
        if value != _bitwise_majority(a, b, c):
            return ["majority does not return the value at least two of the three agree on"]
        # Order must not matter: a majority is symmetric, parity happens to be too, but a
        # "first two win" implementation is not.
        permuted, error = _guard("majority symmetry", lambda: majority(c, a, b))
        if error:
            return error
        if permuted != value:
            return ["reordering the three inputs changed the majority"]
        pair, error = _guard("majority with a repeat", lambda: majority(a, a, b))
        if error:
            return error
        if pair != a:
            return ["majority of a, a and something else did not return a"]
    return []


def _check_schedule_shape(expand, module: ModuleType, seed: str) -> list[str]:
    sigma0 = getattr(module, "small_sigma0")
    sigma1 = getattr(module, "small_sigma1")
    for block in hidden_blocks(seed):
        words = list(block)
        schedule, error = _guard("expand_schedule", lambda: expand(list(words)))
        if error:
            return error
        if not isinstance(schedule, list):
            return ["expand_schedule did not return a list"]
        if len(schedule) != SCHEDULE_WORDS:
            return ["expand_schedule did not return 64 words"]
        if any(not _is_word(value) for value in schedule):
            return ["a schedule word is not a 32-bit word"]
        if schedule[:WORDS_PER_BLOCK] != words:
            return ["expand_schedule changed the 16 message words it was given"]

        # The recurrence, evaluated with the learner's own sigmas: this scores the shape of
        # W[i] -- which four words it reads and that the terms are ADDED mod 2**32 -- and
        # deliberately not whether the sigmas themselves are right.
        for index in range(WORDS_PER_BLOCK, SCHEDULE_WORDS):
            expected, error = _guard(
                "the schedule recurrence",
                lambda: (
                    schedule[index - 16]
                    + sigma0(schedule[index - 15])
                    + schedule[index - 7]
                    + sigma1(schedule[index - 2])
                )
                & MASK,
            )
            if error:
                return error
            if schedule[index] != expected:
                return [
                    "a schedule word does not equal W[i-16] + sigma0(W[i-15]) "
                    "+ W[i-7] + sigma1(W[i-2]) modulo 2**32"
                ]
    return []


def _check_schedule_carries(expand, seed: str) -> list[str]:
    """The expansion must not be linear over xor.

    Rotations, shifts and xor are all GF(2)-linear, so a schedule that xors its four terms
    is linear as a whole: expanding `a ^ b` gives exactly the xor of the two expansions.
    Adding modulo 2**32 has carries, which breaks that. This is the property the defect
    cannot fake, and it does not depend on the learner's sigmas being right.
    """
    blocks = hidden_blocks(seed)
    for left in blocks:
        for right in blocks:
            if left == right:
                continue
            combined = [a ^ b for a, b in zip(left, right)]
            triple, error = _guard(
                "linearity of the expansion",
                lambda: (
                    expand(list(combined)),
                    expand(list(left)),
                    expand(list(right)),
                ),
            )
            if error:
                return error
            joint, first, second = triple
            if joint != [a ^ b for a, b in zip(first, second)]:
                return []  # found a pair where it is not linear, which is what we want
    return ["the expansion is linear over xor, so its terms are combined without carries"]


def run_sigma(module: ModuleType, seed: str) -> list[str]:
    """Failures for `rotr` and the four sigma functions. Empty means the checkpoint passes."""
    names = ("rotr", "small_sigma0", "small_sigma1", "big_sigma0", "big_sigma1")
    (rotr, *sigmas), missing = _resolve(module, names)
    if missing:
        return missing
    failures = [f"rotr: {detail}" for detail in _check_rotr(rotr, seed)]
    for name, sigma in zip(names[1:], sigmas):
        failures.extend(_check_sigma(name, sigma, seed))
    return failures


def run_logic(module: ModuleType, seed: str) -> list[str]:
    """Failures for `choose` and `majority`. Empty means the checkpoint passes."""
    (choose, majority), missing = _resolve(module, ("choose", "majority"))
    if missing:
        return missing
    return _check_choose(choose, seed) + _check_majority(majority, seed)


def run_schedule(module: ModuleType, seed: str) -> list[str]:
    """Failures for `expand_schedule`. Empty means the checkpoint passes."""
    needed = ("expand_schedule", "small_sigma0", "small_sigma1")
    (expand, _sigma0, _sigma1), missing = _resolve(module, needed)
    if missing:
        return missing
    failures = _check_schedule_shape(expand, module, seed)
    if failures:
        return failures
    return _check_schedule_carries(expand, seed)
