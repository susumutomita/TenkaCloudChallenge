"""Public self-check of the lab CLI. Carries no answer, so it ships to participants.

Everything here is a property of the interface rather than of the solution: the usage
text appears, `show` describes the deployment without leaking the flag or the locked
fourth case, the trace it advertises really does break the promise it says it breaks,
and a wrong answer is refused with a reason. The suite that grades the *answers* is
`mutation.py`, which is in the author image only.

    python tests/public/test_counter.py
    python tests/public/test_counter.py --only show
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fixtures.generate import (
    broken_case,
    first_break,
    flag,
    in_window,
    main_case,
    rule_family,
    transfer_case,
)

SEED = "public-test-seed"


def cli(state: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    """Run the CLI the way a participant does, from a directory that is not /problem."""
    return subprocess.run(  # noqa: S603 - argument list, shell=False
        [sys.executable, str(ROOT / "counter.py"), *arguments],
        capture_output=True,
        text=True,
        timeout=120,
        cwd="/",
        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "FLAG_SEED": SEED, "LAB_STATE_DIR": str(state)},
        check=False,
    )


def test_usage(state: Path) -> list[str]:
    result = cli(state)
    failures = []
    if result.returncode != 0:
        failures.append("bare `counter` should print usage and succeed")
    for expected in ("counter show", "counter predict", "counter locate", "counter rule",
                     "counter transfer", "counter flag"):
        if expected not in result.stdout:
            failures.append(f"usage does not mention `{expected}`")
    return failures


def test_show(state: Path) -> list[str]:
    result = cli(state, "show")
    failures = []
    if result.returncode != 0:
        failures.append(f"`show` exited {result.returncode}: {result.stderr.strip()[:200]}")
    case = main_case(SEED)
    broken, values, _ = broken_case(SEED)
    for expected in ("the counter", "stage 1 of 4", "stage 2 of 4", "stage 3 of 4", "stage 4 of 4"):
        if expected not in result.stdout:
            failures.append(f"`show` does not print '{expected}'")
    if case.rendered() not in result.stdout:
        failures.append("`show` does not print this deployment's case")
    if broken.rendered() not in result.stdout or str(values) not in result.stdout:
        failures.append("`show` does not print the broken trace to read")
    if flag(SEED) in result.stdout:
        failures.append("`show` prints the flag")
    return failures


def test_show_keeps_the_transfer_case_locked(state: Path) -> list[str]:
    """The fourth case is not on screen before the first three are cleared."""
    result = cli(state, "show")
    failures = []
    if transfer_case(SEED).rendered() in result.stdout:
        failures.append("`show` printed the transfer case with nothing cleared")
    if "locked" not in result.stdout:
        failures.append("`show` does not say the fourth stage is locked")
    return failures


def test_the_advertised_trace_really_breaks(_state: Path) -> list[str]:
    """`show` claims that trace leaves the window more than once. Check that it does."""
    case, values, answer = broken_case(SEED)
    outside = [index for index, value in enumerate(values) if not in_window(value, case.modulus)]
    failures = []
    if len(outside) < 2:
        failures.append(f"the broken trace leaves the window {len(outside)} time(s), not more than once")
    if answer < 0 or (outside and answer != outside[0]):
        failures.append("the recorded first break is not the first entry outside the window")
    if first_break(values, case.modulus) != answer:
        failures.append("first_break disagrees with the recorded answer")
    return failures


def test_the_rule_family_covers_its_edges(_state: Path) -> list[str]:
    """The parameter family a rule is graded on has to contain the cases that matter."""
    family = rule_family(SEED)
    failures = []
    for name, predicate in (
        ("a step that runs backwards", lambda c: c.step < 0),
        ("a step of zero", lambda c: c.step == 0),
        ("a step larger than the modulus", lambda c: c.step > c.modulus),
        ("a start outside the window", lambda c: c.start >= c.modulus),
        ("no rounds at all", lambda c: c.rounds == 0),
        ("more than one modulus", lambda c: True),
    ):
        if not any(predicate(case) for case in family):
            failures.append(f"the rule family has no case with {name}")
    if len({case.modulus for case in family}) < 2:
        failures.append("the rule family uses a single modulus")
    return failures


def test_flag_is_withheld(state: Path) -> list[str]:
    result = cli(state, "flag")
    failures = []
    if result.returncode == 0:
        failures.append("`flag` succeeded with nothing cleared")
    if flag(SEED) in result.stdout:
        failures.append("`flag` released the flag with nothing cleared")
    if "not yet" not in result.stdout:
        failures.append("`flag` does not say why it is withholding")
    return failures


def test_transfer_is_refused_before_it_is_unlocked(state: Path) -> list[str]:
    result = cli(state, "transfer", "predict=0", "locate=0")
    failures = []
    if result.returncode == 0:
        failures.append("`transfer` was accepted with nothing cleared")
    if "not open yet" not in result.stdout:
        failures.append("`transfer` does not say why it is refusing")
    return failures


def test_status_starts_open(state: Path) -> list[str]:
    result = cli(state, "status")
    return [] if result.stdout.count("open") == 4 else ["`status` does not start with all four stages open"]


def test_malformed_inputs_explain_themselves(state: Path) -> list[str]:
    failures = []
    cases = [
        (["predict"], "not a prediction"),
        (["predict", "nine"], "not a whole number"),
        (["predict", "1", "2"], "2 values given"),
        (["locate", "third"], "not a whole number"),
        (["rule"], "no rule given"),
        (["rule", "start step"], "not an expression"),
        (["rule", "start / modulus"], "no division"),
        (["rule", "value = start"], "not an equation"),
        (["wat"], "unknown command"),
    ]
    for arguments, expected in cases:
        result = cli(state, *arguments)
        if result.returncode == 0:
            failures.append(f"`{' '.join(arguments)}` succeeded")
        if expected not in result.stdout:
            failures.append(f"`{' '.join(arguments)}` does not explain itself ({expected!r})")
    return failures


def test_a_wrong_prediction_does_not_print_the_trace(state: Path) -> list[str]:
    """The whole value of predicting is that the answer was not on screen first."""
    case = main_case(SEED)
    from fixtures.generate import final_value, trace  # noqa: PLC0415 - local to this check

    wrong = (final_value(case) + 1) % case.modulus
    result = cli(state, "predict", str(wrong))
    failures = []
    if result.returncode == 0:
        failures.append("`predict` accepted a wrong prediction")
    if str(trace(case)) in result.stdout:
        failures.append("`predict` printed the trace for a wrong prediction")
    return failures


TESTS = {
    name[len("test_") :]: function
    for name, function in sorted(globals().items())
    if name.startswith("test_")
}


def main(argv: list[str]) -> int:
    only = argv[argv.index("--only") + 1] if "--only" in argv else ""
    selected = {name: fn for name, fn in TESTS.items() if only in name}
    if not selected:
        print(f"no test matches --only {only!r}; names: {', '.join(TESTS)}")
        return 2
    failed = 0
    with tempfile.TemporaryDirectory() as directory:
        for name, function in selected.items():
            state = Path(directory) / name
            state.mkdir()
            failures = function(state)
            if failures:
                failed += 1
                print(f"FAIL {name}")
                for line in failures:
                    print(f"     {line}")
            else:
                print(f"ok   {name}")
    print()
    print(f"{len(selected) - failed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
