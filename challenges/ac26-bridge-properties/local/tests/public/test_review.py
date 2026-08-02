"""Public self-check of the lab CLI. Carries no answer, so it ships to participants.

Everything here is a property of the interface rather than of the solution: the usage
text appears, `show` describes the panel without leaking the flag or the locked second
panel, `run` is really free, and a wrong answer is refused with a reason. The suite that
grades the *answers* is `mutation.py`, which is in the author image only.

    python tests/public/test_review.py
    python tests/public/test_review.py --only show
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
    PROPERTIES,
    TRANSFER,
    accepts,
    flag,
    is_true_of,
    panel as build_panel,
    record,
    well_posed,
)

SEED = "public-test-seed"


def cli(state: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    """Run the CLI the way a participant does, from a directory that is not /problem."""
    return subprocess.run(  # noqa: S603 - argument list, shell=False
        [sys.executable, str(ROOT / "review.py"), *arguments],
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
        failures.append("bare `review` should print usage and succeed")
    for expected in (
        "review show",
        "review run",
        "review reject",
        "review recover",
        "review forge",
        "review classify",
        "review transfer",
        "review flag",
    ):
        if expected not in result.stdout:
            failures.append(f"usage does not mention `{expected}`")
    return failures


def test_show(state: Path) -> list[str]:
    """`show` is the whole briefing. Whatever it does not say, nobody says."""
    result = cli(state, "show")
    failures = []
    if result.returncode != 0:
        failures.append(f"`show` exited {result.returncode}: {result.stderr.strip()[:200]}")
    panel_ = build_panel(SEED, LIVE)
    for expected in (
        "the claim",
        "stage 1 of 5",
        "stage 2 of 5",
        "stage 3 of 5",
        "stage 4 of 5",
        "stage 5 of 5",
        "review run <verifier> <w>",
        "review reject <w>",
        "review recover <w>",
        "review forge <w>",
        *PROPERTIES,
    ):
        if expected not in result.stdout:
            failures.append(f"`show` does not print '{expected}'")
    if panel_.main.rendered() not in result.stdout:
        failures.append("`show` does not print this deployment's main statement")
    if panel_.edge.rendered() not in result.stdout:
        failures.append("`show` does not print this deployment's edge statement")
    for verifier in panel_.verifiers:
        if verifier.range_text() not in result.stdout:
            failures.append(f"`show` does not say what {verifier.id} checks")
    if flag(SEED) in result.stdout:
        failures.append("`show` prints the flag")
    return failures


def test_show_carries_a_record_to_recover_from(_state: Path) -> list[str]:
    """The privacy stage has a source only if the honest record is on screen."""
    panel_ = build_panel(SEED, LIVE)
    leaky = panel_.by_role("leaky")
    entry = record(leaky, panel_.main, panel_.main.witness)
    failures = []
    if "audit" not in entry:
        failures.append("the leaky verifier's record carries nothing that moves with w")
    unchanged = record(leaky, panel_.main, panel_.main.witness + 1)
    if unchanged == entry:
        failures.append("the leaky verifier's record does not move when w moves")
    for verifier in panel_.verifiers:
        if verifier.role == "leaky":
            continue
        if record(verifier, panel_.main, 0) != record(verifier, panel_.main, 1):
            failures.append(f"{verifier.id} leaks as well, so the panel has two privacy breaks")
    return failures


def test_show_keeps_the_second_panel_locked(state: Path) -> list[str]:
    result = cli(state, "show")
    second = build_panel(SEED, TRANSFER)
    failures = []
    for statement in second.statements():
        if statement.rendered() in result.stdout:
            failures.append("`show` printed the second panel with nothing cleared")
    if "locked" not in result.stdout:
        failures.append("`show` does not say the later stages are locked")
    return failures


def test_the_panel_poses_its_own_question(_state: Path) -> list[str]:
    """Every stage has an answer, and no two stages have the same one."""
    return [
        f"{name}: {problem}"
        for name in (LIVE, TRANSFER)
        for problem in well_posed(build_panel(SEED, name))
    ]


def test_the_edge_statement_is_where_incompleteness_shows(_state: Path) -> list[str]:
    """The claim `show` makes about the two statements has to be true of them."""
    panel_ = build_panel(SEED, LIVE)
    incomplete = panel_.by_role("incomplete")
    failures = []
    edge = panel_.edge
    if edge.witness not in (edge.lo, edge.hi):
        failures.append("the edge statement's witness does not sit on an end of its range")
    if not is_true_of(edge, edge.witness):
        failures.append("the edge statement is not true of its own witness")
    if accepts(incomplete, edge, edge.witness):
        failures.append("the incomplete verifier accepts the edge witness")
    main = panel_.main
    if not accepts(incomplete, main, main.witness):
        failures.append("the incomplete verifier already differs on the main statement")
    return failures


def test_run_is_free(state: Path) -> list[str]:
    """`show` advertises runs as unscored. They have to record nothing."""
    panel_ = build_panel(SEED, LIVE)
    failures = []
    for verifier_id in panel_.ids():
        result = cli(state, "run", verifier_id, str(panel_.main.witness))
        if result.returncode != 0:
            failures.append(f"`run {verifier_id}` failed")
        for statement in panel_.statements():
            if statement.rendered() not in result.stdout:
                failures.append(f"`run {verifier_id}` does not print the {statement.name} statement")
    if "cleared" in cli(state, "status").stdout:
        failures.append("`run` recorded progress")
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


def test_locked_stages_refuse_and_explain(state: Path) -> list[str]:
    panel_ = build_panel(SEED, LIVE)
    failures = []
    classify = cli(state, "classify", *[f"{i}=none" for i in panel_.ids()])
    if classify.returncode == 0:
        failures.append("`classify` was accepted with nothing demonstrated")
    if "not open yet" not in classify.stdout:
        failures.append("`classify` does not say why it is refusing")
    transfer = cli(state, "transfer", "reject=0", "recover=0", "forge=0")
    if transfer.returncode == 0:
        failures.append("`transfer` was accepted with nothing cleared")
    if "not been handed over" not in transfer.stdout:
        failures.append("`transfer` does not say why it is refusing")
    second = build_panel(SEED, TRANSFER)
    run = cli(state, "run", second.ids()[0], "1")
    if run.returncode == 0:
        failures.append("`run` reached the second panel before it was handed over")
    return failures


def test_status_starts_open(state: Path) -> list[str]:
    result = cli(state, "status")
    return [] if result.stdout.count("open") == 5 else ["`status` does not start with five open stages"]


def test_malformed_inputs_explain_themselves(state: Path) -> list[str]:
    failures = []
    cases = [
        (["reject"], "no witness given"),
        (["reject", "twelve"], "not a whole number"),
        (["reject", "1", "2"], "2 values given, and the witness is one number"),
        (["recover", "abc"], "not a whole number"),
        (["forge", "x"], "not a whole number"),
        (["run"], "usage: review run"),
        (["run", "nobody", "1"], "no verifier called"),
        (["run", "p1", "wat"], "not a whole number"),
        (["wat"], "unknown command"),
    ]
    for arguments, expected in cases:
        result = cli(state, *arguments)
        if result.returncode == 0:
            failures.append(f"`{' '.join(arguments)}` succeeded")
        if expected not in result.stdout:
            failures.append(f"`{' '.join(arguments)}` does not explain itself ({expected!r})")
    return failures


def test_a_wrong_demonstration_never_prints_the_value(state: Path) -> list[str]:
    """A refusal says what is not satisfied. It never says what would be.

    Only `recover` and `forge` are checked. `reject`'s answer is one end of a range the
    statement prints in full, so it is public by construction and a refusal that echoes
    the statement necessarily contains it -- asserting otherwise would be asserting that
    the statement is a secret, which it is not.
    """
    panel_ = build_panel(SEED, LIVE)
    main = panel_.main
    failures = []
    for stage, answer in (("recover", main.witness), ("forge", main.witness + main.p)):
        result = cli(state, stage, str(answer + 1))
        if result.returncode == 0:
            failures.append(f"`{stage}` accepted a wrong answer")
        if str(answer) in result.stdout:
            failures.append(f"`{stage}` printed the answer while refusing")
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
