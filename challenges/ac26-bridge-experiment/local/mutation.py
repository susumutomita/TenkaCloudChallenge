"""Mutation suite: break the reference on purpose and assert the hidden tests notice.

This is the check that keeps the hidden suite honest. A green test run against a
correct solution proves nothing about whether the tests would catch a wrong one.

Run inside the image (or in CI):  python mutation.py
Exit code 0 means every mutation was killed.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_counter import run

SEED = "mutation-suite-seed"

# Each entry is (name, source). The source defines `advance` with one defect.
#
# Equivalent mutants are deliberately absent. Two obvious-looking candidates —
# reducing once at the end (`[v % modulus for v in trace]`) and leaving `start`
# unreduced before the loop — are mathematically identical to round-by-round
# reduction under Python's floored `%`, so no correct test can distinguish them.
# Listing them would produce a permanent "survived" that trains authors to ignore
# the suite. If you add a mutation here, first convince yourself it changes an
# observable output for some input.
MUTATIONS: list[tuple[str, str]] = [
    (
        "reduction skipped on every other round",
        """
def advance(start, step, rounds, modulus):
    trace = []
    value = start % modulus
    for index in range(rounds):
        value = value + step
        if index % 2 == 0:
            value = value % modulus
        trace.append(value)
    return trace
""",
    ),
    (
        "negatives not normalized",
        """
def advance(start, step, rounds, modulus):
    trace = []
    value = start
    for _ in range(rounds):
        value = value + step
        if value >= modulus:
            value = value - modulus
        trace.append(value)
    return trace
""",
    ),
    (
        "off-by-one: one extra round",
        """
def advance(start, step, rounds, modulus):
    trace = []
    value = start % modulus
    for _ in range(rounds + 1):
        value = (value + step) % modulus
        trace.append(value)
    return trace
""",
    ),
    (
        "truncating remainder, so negatives stay negative",
        """
def advance(start, step, rounds, modulus):
    trace = []
    value = start
    for _ in range(rounds):
        value = value + step
        value = value - modulus * int(value / modulus)
        trace.append(value)
    return trace
""",
    ),
    (
        "trace recorded before the step is applied",
        """
def advance(start, step, rounds, modulus):
    trace = []
    value = start % modulus
    for _ in range(rounds):
        trace.append(value)
        value = (value + step) % modulus
    return trace
""",
    ),
    (
        "hard-coded public fixture",
        """
def advance(start, step, rounds, modulus):
    return [3, 9, 4, 10, 5]
""",
    ),
    (
        "returns an empty trace regardless of rounds",
        """
def advance(start, step, rounds, modulus):
    return []
""",
    ),
]


def _load(source: str):
    namespace: dict[str, object] = {}
    exec(compile(source, "<mutation>", "exec"), namespace)  # noqa: S102 - our own fixtures
    return namespace["advance"]


def main() -> int:
    survivors: list[str] = []

    reference_source = (Path(__file__).resolve().parent / "reference" / "counter.py").read_text(
        encoding="utf-8"
    )
    if run(_load(reference_source), SEED):
        print("FAIL reference implementation does not pass the hidden tests")
        return 1
    print("PASS reference implementation passes the hidden tests")

    for name, source in MUTATIONS:
        failures = run(_load(source), SEED)
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            survivors.append(name)
            print(f"SURVIVED {name}")

    # The always-succeed verifier is the one mutation that cannot be expressed as a
    # broken `advance`: it lives in the verifier, not the submission. Assert directly
    # that a wrong submission is rejected end to end.
    from verifier.server import evaluate  # noqa: PLC0415 - imported late, after sys.path

    if evaluate("generalize", "def advance(a, b, c, d):\n    return []\n"):
        survivors.append("verifier accepts a submission that fails the hidden tests")
        print("SURVIVED verifier accepts an empty-trace submission")
    else:
        print("KILLED verifier accepts an empty-trace submission")

    if evaluate("environment", "not-the-token"):
        survivors.append("verifier accepts a wrong health token")
        print("SURVIVED verifier accepts a wrong health token")
    else:
        print("KILLED verifier accepts a wrong health token")

    print()
    if survivors:
        print(f"{len(survivors)} mutation(s) survived:")
        for name in survivors:
            print(f"  - {name}")
        return 1
    print(f"All {len(MUTATIONS) + 2} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
