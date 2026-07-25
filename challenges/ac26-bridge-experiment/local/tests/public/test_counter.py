"""Public tests: they show you the shape of the answer. They do not prove it.

Read them, then read `misconception.public-tests-are-complete` in the README. These
tests pass for at least one implementation that the hidden tests reject.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import public_case  # noqa: E402
from starter.counter import advance  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def test_trace_has_one_entry_per_round() -> None:
    case = public_case(SEED)
    assert len(advance(**case.as_dict())) == case.rounds


def test_zero_rounds_is_empty() -> None:
    case = public_case(SEED)
    assert advance(case.start, case.step, 0, case.modulus) == []


def test_every_entry_is_in_range() -> None:
    case = public_case(SEED)
    for value in advance(**case.as_dict()):
        assert 0 <= value < case.modulus


def test_first_entry_is_start_plus_step() -> None:
    case = public_case(SEED)
    trace = advance(**case.as_dict())
    assert trace[0] == (case.start + case.step) % case.modulus


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
    print("Passing these does not mean you are done. They only use one set of")
    print("parameters, and they never use a negative or zero step.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
