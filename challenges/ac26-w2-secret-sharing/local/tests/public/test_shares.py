"""Public self-check of the lab CLI. Carries no answer, so it ships to participants.

Everything here is a property of the interface rather than of the solution: the usage
text appears, `show` prints every number a stage needs and none that it asks for, the
locked stage stays locked, and a malformed input explains itself. The suite that grades
the *answers* is `mutation.py`, which is in the author image only.

    python tests/public/test_shares.py
    python tests/public/test_shares.py --only show
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fixtures.generate import (
    LIVE,
    PARAMETERS,
    TRANSFER,
    completion,
    completion_family,
    family_is_vacuous,
    flag,
    ledger_a,
    ledger_b,
    setting,
    target_value,
)

SEED = "public-test-seed"


def cli(state: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    """Run the CLI the way a participant does, from a directory that is not /problem."""
    return subprocess.run(  # noqa: S603 - argument list, shell=False
        [sys.executable, str(ROOT / "shares.py"), *arguments],
        capture_output=True,
        text=True,
        timeout=180,
        cwd="/",
        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "FLAG_SEED": SEED, "LAB_STATE_DIR": str(state)},
        check=False,
    )


def test_usage(state: Path) -> list[str]:
    result = cli(state)
    failures = []
    if result.returncode != 0:
        failures.append("bare `shares` should print usage and succeed")
    for expected in (
        "shares show",
        "shares recover",
        "shares complete",
        "shares refresh",
        "shares transfer",
        "shares flag",
    ):
        if expected not in result.stdout:
            failures.append(f"usage does not mention `{expected}`")
    return failures


def test_show(state: Path) -> list[str]:
    """`show` is the whole briefing. Whatever it does not say, nobody says."""
    result = cli(state, "show")
    cfg = setting(SEED, LIVE)
    a, b = ledger_a(SEED, LIVE), ledger_b(SEED, LIVE)
    failures = []
    if result.returncode != 0:
        failures.append(f"`show` exited {result.returncode}: {result.stderr.strip()[:200]}")
    for expected in (
        "the sharing",
        "stage 1 of 4",
        "stage 2 of 4",
        "stage 3 of 4",
        "stage 4 of 4",
        "shares recover <total>",
        'shares complete "<expression>"',
        *PARAMETERS,
    ):
        if expected not in result.stdout:
            failures.append(f"`show` does not print '{expected}'")
    if str(list(a.shares)) not in result.stdout:
        failures.append("`show` does not print ledger A, which `recover` adds up")
    if str(list(b.visible())) not in result.stdout:
        failures.append("`show` does not print ledger B's visible shares")
    if f"known = {b.known()}" not in result.stdout:
        failures.append("`show` does not print the raw sum the completion rule names")
    if cfg.rendered() not in result.stdout:
        failures.append("`show` does not print this deployment's setting")
    if flag(SEED) in result.stdout:
        failures.append("`show` prints the flag")
    return failures


def test_the_known_sum_is_really_unreduced(_state: Path) -> list[str]:
    """`show` says the raw sum is larger than the modulus. It has to be.

    If it were not, a completion rule that never reduces would be correct on this
    deployment's own numbers, and the reduction would only ever be exercised by a case in
    the family -- which is a much weaker lesson than meeting it on screen.
    """
    failures = []
    for name in (LIVE, TRANSFER):
        cfg = setting(SEED, name)
        ledger = ledger_b(SEED, name)
        if ledger.known() <= cfg.p:
            failures.append(f"{name}: known={ledger.known()} is not larger than p={cfg.p}")
        if len(ledger.visible()) != cfg.n - 1:
            failures.append(f"{name}: ledger B does not hide exactly one share")
    return failures


def test_the_family_covers_its_edges(_state: Path) -> list[str]:
    """The parameter family a completion rule is graded on has to contain what matters."""
    family = completion_family(SEED)
    failures = []
    for name, predicate in (
        ("nothing known at all", lambda case: case.known == 0),
        ("a known above the modulus", lambda case: case.known > case.modulus),
        ("a target below what is known", lambda case: case.target < case.known),
        ("a target of zero", lambda case: case.target == 0),
    ):
        if not any(predicate(case) for case in family):
            failures.append(f"the family has no case with {name}")
    if len({case.modulus for case in family}) < 2:
        failures.append("the family uses a single modulus")
    if family_is_vacuous(family):
        failures.append("the family cannot fail a completion that never reduces")
    for case in family:
        if not 0 <= completion(case) < case.modulus:
            failures.append(f"the completion of {case.rendered()} is not an element of the field")
    return failures


def test_show_keeps_the_second_setting_locked(state: Path) -> list[str]:
    result = cli(state, "show")
    second = setting(SEED, TRANSFER)
    failures = []
    if second.rendered() in result.stdout:
        failures.append("`show` printed the second setting with nothing cleared")
    if str(list(ledger_a(SEED, TRANSFER).shares)) in result.stdout:
        failures.append("`show` printed the second setting's ledger")
    if "locked" not in result.stdout:
        failures.append("`show` does not say the fourth stage is locked")
    return failures


def test_show_never_prints_a_total_it_asks_for(state: Path) -> list[str]:
    """Ledger B's total is the thing the completion stage is about. It stays off screen."""
    result = cli(state, "show")
    b = ledger_b(SEED, LIVE)
    failures = []
    # Its shares are printed; its total is not, and neither is the transfer's target.
    if f"total is {b.secret}" in result.stdout:
        failures.append("`show` prints ledger B's total")
    if str(target_value(SEED, TRANSFER)) in result.stdout.split("stage 4 of 4")[-1]:
        failures.append("`show` prints the locked transfer target")
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
    result = cli(state, "transfer", "recover=0", "complete=0", "refresh=1,1")
    failures = []
    if result.returncode == 0:
        failures.append("`transfer` was accepted with nothing cleared")
    if "not open yet" not in result.stdout:
        failures.append("`transfer` does not say why it is refusing")
    return failures


def test_status_starts_open(state: Path) -> list[str]:
    result = cli(state, "status")
    return [] if result.stdout.count("open") == 4 else ["`status` does not start with four open stages"]


def test_malformed_inputs_explain_themselves(state: Path) -> list[str]:
    failures = []
    cases = [
        (["recover"], "no total given"),
        (["recover", "ninety"], "not a whole number"),
        (["recover", "1", "2"], "2 values given"),
        (["complete"], "no rule given"),
        (["complete", "target known"], "not an expression"),
        (["complete", "target / modulus"], "no division"),
        (["complete", "share = target"], "not an equation"),
        (["refresh"], "no offsets given"),
        (["refresh", "1 2 3"], "commas and no spaces"),
        (["refresh", "a,b"], "not a whole number"),
        (["wat"], "unknown command"),
    ]
    for arguments, expected in cases:
        result = cli(state, *arguments)
        if result.returncode == 0:
            failures.append(f"`{' '.join(arguments)}` succeeded")
        if expected not in result.stdout:
            failures.append(f"`{' '.join(arguments)}` does not explain itself ({expected!r})")
    return failures


def test_a_refusal_never_hands_over_the_answer(state: Path) -> list[str]:
    """A refusal says what is not satisfied. It never says what would be."""
    a = ledger_a(SEED, LIVE)
    failures = []
    result = cli(state, "recover", str(a.secret + 1))
    if result.returncode == 0:
        failures.append("`recover` accepted a wrong total")
    if str(a.secret) in result.stdout:
        failures.append("`recover` printed the total while refusing")
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
