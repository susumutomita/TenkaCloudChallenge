"""Hidden tests. Run by /verify against a copy of the learner's file, never shown to them.

Three jobs:
  1. Parameters the public tests never use (several moduli, negative step, zero step,
     start >= modulus, zero rounds).
  2. Metamorphic properties, so memorizing one output cannot pass.
  3. Negative properties, so an implementation that produces out-of-range values fails
     even when its final value happens to be right.

Failure messages name the property, never the expected value.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import Case, hidden_cases  # noqa: E402

Advance = Callable[[int, int, int, int], "list[int]"]


def _expected(case: Case) -> list[int]:
    trace: list[int] = []
    value = case.start % case.modulus
    for _ in range(case.rounds):
        value = (value + case.step) % case.modulus
        trace.append(value)
    return trace


def _check_case(advance: Advance, case: Case) -> list[str]:
    failures: list[str] = []
    try:
        actual = advance(case.start, case.step, case.rounds, case.modulus)
    except Exception as error:  # noqa: BLE001 - a raising solution is a failing solution
        return [f"raised {type(error).__name__} on a valid input"]

    if not isinstance(actual, list):
        return ["did not return a list"]
    if len(actual) != case.rounds:
        failures.append("trace length does not match the number of rounds")
        return failures
    if any(not isinstance(value, int) for value in actual):
        failures.append("trace contains a non-integer")
        return failures
    if any(not 0 <= value < case.modulus for value in actual):
        failures.append("a trace entry is outside [0, modulus)")
    if actual != _expected(case):
        failures.append("trace does not match round-by-round reduction")
    return failures


def _check_metamorphic(advance: Advance, case: Case) -> list[str]:
    """Shifting the start by a whole multiple of the modulus must not change the trace."""
    if case.rounds == 0:
        return []
    try:
        base = advance(case.start, case.step, case.rounds, case.modulus)
        shifted = advance(
            case.start + case.modulus * 3, case.step, case.rounds, case.modulus
        )
    except Exception as error:  # noqa: BLE001
        return [f"raised {type(error).__name__} while checking the shift property"]
    if base != shifted:
        return ["shifting start by a multiple of modulus changed the trace"]
    return []


def _check_step_congruence(advance: Advance, case: Case) -> list[str]:
    """Shifting the step by a whole multiple of the modulus must not change the trace either."""
    if case.rounds == 0:
        return []
    try:
        base = advance(case.start, case.step, case.rounds, case.modulus)
        shifted = advance(
            case.start, case.step + case.modulus * 2, case.rounds, case.modulus
        )
    except Exception as error:  # noqa: BLE001
        return [f"raised {type(error).__name__} while checking the step property"]
    if base != shifted:
        return ["shifting step by a multiple of modulus changed the trace"]
    return []


def run(advance: Advance, seed: str) -> list[str]:
    """Return a list of human-readable failures. Empty means the checkpoint passes."""
    failures: list[str] = []
    for index, case in enumerate(hidden_cases(seed)):
        for message in _check_case(advance, case):
            failures.append(f"case {index}: {message}")
        for message in _check_metamorphic(advance, case):
            failures.append(f"case {index}: {message}")
        for message in _check_step_congruence(advance, case):
            failures.append(f"case {index}: {message}")
    return failures
