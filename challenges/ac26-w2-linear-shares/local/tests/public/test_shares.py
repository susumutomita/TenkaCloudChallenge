"""Public self-check of the lab CLI. Carries no answer, so it ships to participants.

Everything here is a property of the interface rather than of the solution: the
usage text appears, `show` describes the desk without leaking the flag, the second
desk stays shut until it is earned, and a malformed input explains itself. The suite
that grades the *answers* is `mutation.py`, which is in the author image only.

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
    TRANSFER,
    designated_party,
    expressions,
    field_modulus,
    flag,
    party_count,
    published_total,
    your_index,
)

SEED = "public-test-seed"


def cli(state: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    """Run the CLI the way a participant does, from a directory that is not /problem."""
    return subprocess.run(  # noqa: S603 - argument list, shell=False
        [sys.executable, str(ROOT / "shares.py"), *arguments],
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
        failures.append("bare `shares` should print usage and succeed")
    for expected in (
        "shares show",
        "shares row",
        "shares total",
        "shares silent",
        "shares transfer",
        "shares flag",
    ):
        if expected not in result.stdout:
            failures.append(f"usage does not mention `{expected}`")
    return failures


def test_show(state: Path) -> list[str]:
    result = cli(state, "show")
    failures = []
    if result.returncode != 0:
        failures.append(f"`show` exited {result.returncode}: {result.stderr.strip()[:200]}")
    for expected in ("who you are", "the desk's run sheet", "the operations queue"):
        if expected not in result.stdout:
            failures.append(f"`show` does not print '{expected}'")
    for number in (
        field_modulus(SEED, LIVE),
        party_count(SEED, LIVE),
        published_total(SEED, LIVE),
    ):
        if str(number) not in result.stdout:
            failures.append(f"`show` does not print {number}")
    if f"party {your_index(SEED, LIVE)}" not in result.stdout:
        failures.append("`show` does not say which party the participant is")
    if f"party {designated_party(SEED, LIVE)}" not in result.stdout:
        failures.append("`show` does not say which party folds the public constant in")
    if flag(SEED) in result.stdout:
        failures.append("`show` prints the flag")
    return failures


def test_show_names_the_next_command_for_every_stage(state: Path) -> list[str]:
    """The portal shows a short brief and then hands over a shell, so `show` is it.

    Not "explains what to do" -- the literal line to type, for each stage, because
    there is no scrollback and nothing else says it.
    """
    stdout = cli(state, "show").stdout
    return [
        f"`show` does not print the command for `{command}`"
        for command in ("shares row <number>", "shares total <number>", "shares silent <ids>")
        if command not in stdout
    ]


def test_show_locks_the_second_desk(state: Path) -> list[str]:
    """The second desk is earned: named as locked, with its contents withheld.

    Locked rather than absent. A section that simply is not there reads as a broken
    page, and there is no scrollback in the portal terminal to compare against.
    """
    stdout = cli(state, "show").stdout
    failures = [
        f"`show` reveals the second desk's expression {row['id']} before it is unlocked"
        for row in expressions(SEED, TRANSFER)
        if str(row["id"]) in stdout
    ]
    if "[locked]" not in stdout:
        failures.append("`show` omits the locked stage instead of naming it")
    return failures


def test_transfer_is_locked(state: Path) -> list[str]:
    result = cli(state, "transfer", "row=0", "total=0", "silent=g1")
    failures = []
    if result.returncode == 0:
        failures.append("`transfer` was gradeable before the three stages before it")
    if "has not been handed over" not in result.stdout:
        failures.append("`transfer` does not say why it refused")
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


def test_status_starts_open(state: Path) -> list[str]:
    result = cli(state, "status")
    if result.stdout.count("open") == 4:
        return []
    return ["`status` does not start with all four stages open"]


def test_the_published_total_is_not_the_answer(state: Path) -> list[str]:
    """The number the desk published came out of a faulty run, so it is refused.

    Also asserts the message, which is the part `mutation.py` deliberately does not
    cover: rejecting it is what the generic comparison already does, and saying which
    number it is is what the branch exists for.
    """
    result = cli(state, "total", str(published_total(SEED, LIVE)))
    failures = []
    if result.returncode == 0:
        failures.append("the number the desk published was accepted as the corrected total")
    if "the desk published" not in result.stdout:
        failures.append("`total` does not say that that number came from the faulty run")
    return failures


def test_malformed_inputs_explain_themselves(state: Path) -> list[str]:
    failures = []
    p = field_modulus(SEED, LIVE)
    known = str(expressions(SEED, LIVE)[0]["id"])
    cases = [
        (["row", "1,2"], "values given"),
        (["row", "x"], "not a whole number"),
        (["row", str(p)], "not an element of the field"),
        (["row", "-1"], "not an element of the field"),
        (["row"], "a row is missing"),
        (["total", str(p)], "not an element of the field"),
        (["total"], "a total is missing"),
        (["silent", "e99"], "not one of the expressions"),
        (["silent", f"{known},{known}"], "named twice"),
        (["silent"], "no expressions named"),
        (["wat"], "unknown command"),
    ]
    for arguments, expected in cases:
        result = cli(state, *arguments)
        if result.returncode == 0:
            failures.append(f"`{' '.join(arguments)}` succeeded")
        if expected not in result.stdout:
            failures.append(f"`{' '.join(arguments)}` does not explain itself ({expected!r})")
    return failures


def test_a_rejection_never_names_the_misclassified_entries(state: Path) -> list[str]:
    """A rejection reports how many are on the wrong side, never which.

    Naming them would hand over the map of where the misreading is, which is the work
    the stage exists for. It is not claimed to prevent a scripted search.
    """
    listed = [str(row["id"]) for row in expressions(SEED, LIVE)]
    stdout = cli(state, "silent", ",".join(listed)).stdout
    failures = [
        f"`silent` named expression {identifier} in its rejection"
        for identifier in listed
        if identifier in stdout
    ]
    if "REJECTED" not in stdout:
        failures.append("`silent` does not say it rejected a classification of everything")
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
