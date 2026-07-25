"""Participant-facing harness: `make test` and `make inspect`.

Loads the participant's `counter.py` in an isolated namespace so a syntax error
or an exception is reported as a test failure rather than crashing the harness.
Prints the environment marker, the public case, and — for `inspect` — the trace
and the published broken trace.

Never prints a hidden case, a hidden expected value, or the reference result.
"""

from __future__ import annotations

import sys

import fixtures
from participant import ParticipantError, call_advance, load_advance


def _print_environment() -> None:
    print(f"python           {sys.version.split()[0]}")
    print(f"environment      {fixtures.environment_marker()}")
    print()


def _run_public_case(case: fixtures.Case) -> list[int]:
    """Load and run the submission once. Both checks then read the same values."""
    return call_advance(load_advance(), case.start, case.step, case.rounds, case.modulus)


def _check_expected(case: fixtures.Case, actual: list[int]) -> bool:
    want = fixtures.expected(case)
    if actual != want:
        print(f"FAIL             expected {want}")
        print(f"                 got      {actual}")
        return False
    print(f"PASS             {want}")
    return True


def _check_range_invariant(case: fixtures.Case, actual: list[int]) -> bool:
    """Every recorded value must land in [0, modulus). Cheap, and catches the usual first bug."""
    bad = [(i + 1, v) for i, v in enumerate(actual) if not 0 <= v < case.modulus]
    if bad:
        print(f"FAIL             values outside [0, {case.modulus}) at rounds {bad}")
        return False
    print("PASS             every value is inside [0, modulus)")
    return True


def run_tests() -> int:
    _print_environment()
    case = fixtures.public_case()
    print(f"public case      {case.describe()}")
    try:
        actual = _run_public_case(case)
    except ParticipantError as error:
        # Reported as a message, never as a traceback: the copy that ran lives in a
        # private temp directory the participant cannot open, so a stack trace would
        # point at a path that does not exist for them.
        print(f"FAIL             {error}")
        print()
        print("public tests failed.")
        return 1

    results = [_check_expected(case, actual), _check_range_invariant(case, actual)]
    print()
    if all(results):
        print("public tests passed.")
        print()
        print("The public case is one case. Checkpoint 4 runs cases you have not")
        print("seen, including a negative start, a negative step, and step == 0.")
        return 0
    print("public tests failed.")
    return 1


def inspect() -> int:
    _print_environment()

    case = fixtures.public_case()
    print(f"[public case] {case.describe()}")
    try:
        actual = _run_public_case(case)
    except ParticipantError as error:
        actual = []
        print(f"  counter.py is not runnable yet: {error}")
    for index, value in enumerate(actual, start=1):
        print(f"  round {index:>3}  value={value}")
    print()

    predict = fixtures.predict_case()
    print("[checkpoint 2: predict]")
    print(f"  {predict.describe()}")
    print("  Submit the value recorded by the LAST round, worked out before you run anything.")
    print()

    broken = fixtures.broken_trace_case()
    print("[checkpoint 3: published trace]")
    print(f"  {broken.describe()}")
    print("  Exactly one round in this trace failed to reduce. Every later round")
    print("  then reduces normally from it, so the tail looks self-consistent.")
    print("  Submit the 1-based round number where it first goes wrong.")
    for index, value in enumerate(fixtures.broken_trace(), start=1):
        print(f"  round {index:>3}  value={value}")
    return 0


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else "test"
    if command == "test":
        return run_tests()
    if command == "inspect":
        return inspect()
    print(f"unknown command: {command}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
