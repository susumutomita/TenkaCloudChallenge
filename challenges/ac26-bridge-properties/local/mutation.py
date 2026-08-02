"""Author / CI suite: prove the judge can fail a wrong answer, and the gates can hold.

Six parts, run by `make reference-test` inside the `author` image.

1. The reference answers clear all five stages and produce the flag, end to end through
   the CLI a participant actually types, on several seeds.
2. A catalog of wrong answers is rejected, each for its own reason. These are the near
   misses: a witness that satisfies the congruence but sits one period out submitted as a
   completeness break, the same residue class submitted as the recovered value, a forged
   value on the side of the congruence this panel's unsound verifier does not take, and a
   classification that names every break correctly while claiming the verifiers guarantee
   nothing else.
3. The judge is broken on purpose, one requirement at a time, and every broken version
   has to be caught by that catalog. A checkpoint nobody can fail is not a checkpoint,
   and this is the only thing that tests the tests.
4. The panels themselves: every seed has to pose a question that has an answer, the two
   panels have to differ in every flavour, and the role assignment has to move with the
   seed -- otherwise the classification is a remembered string rather than a reading.
5. `review run` is advertised as free. It has to actually record nothing.
6. The gates: the classification is refused until the three breaks are demonstrated, the
   second panel is neither shown nor reachable nor accepted until the first four stages
   are cleared, and the flag is withheld for every one of the thirty-two progress states
   except the complete one.

The submission is not what gets mutated here, because there is no submission: the grading
moved into the image when the problem moved into the terminal. What gets mutated is the
judge.
"""

from __future__ import annotations

import itertools
import json
import subprocess
import sys
import tempfile
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from fixtures.generate import (
    LIVE,
    PROPERTIES,
    TRANSFER,
    accepts,
    flag as derive_flag,
    forged_value,
    in_range,
    matrix,
    panel as build_panel,
    satisfies_congruence,
    well_posed,
)
from lab import progress as real_progress
from reference.solve import (
    classify_arguments,
    forge_arguments,
    recover_arguments,
    reject_arguments,
    transfer_arguments,
)

#: Enough seeds that the role permutation and the statements vary in every direction.
SEEDS = tuple(f"mutation-seed-{index}" for index in range(8))

JUDGE_SOURCE = (ROOT / "lab" / "judge.py").read_text(encoding="utf-8")


# --------------------------------------------------------------------------- wrong answers


def _rejectable(
    candidates: list[tuple[str, object]], correct: object
) -> list[tuple[str, object]]:
    """Drop any near miss that, for this seed, happens to be the right answer.

    The statements are small, so "the other end of the range" and "the answer" sometimes
    coincide. A catalog entry that is secretly correct would be reported as an escaped
    wrong answer on every seed where it lands, and the honest fix is to notice and drop
    it rather than to widen the parameters until it stops happening.
    """
    return [(label, value) for label, value in candidates if value != correct]


def wrong_rejects(seed: str) -> list[tuple[str, list[str]]]:
    panel_ = build_panel(seed, LIVE)
    edge = panel_.edge
    answer = edge.witness
    near = _rejectable(
        [
            # Satisfies the congruence, but one period out: the statement is false of it.
            ("the same residue class, one period out", answer + edge.p),
            # In range, but not a solution -- refusing it is correct.
            ("the other end of the range", edge.hi if answer == edge.lo else edge.lo),
            ("the middle of the range", (edge.lo + edge.hi) // 2),
            # Right shape, wrong statement.
            ("the main statement's witness", panel_.main.witness),
        ],
        answer,
    )
    return [(label, [str(value)]) for label, value in near] + [
        ("not a number", ["twelve"]),
        ("nothing at all", []),
        ("two numbers at once", [str(answer), str(answer)]),
    ]


def wrong_recovers(seed: str) -> list[tuple[str, list[str]]]:
    panel_ = build_panel(seed, LIVE)
    main = panel_.main
    answer = main.witness
    near = _rejectable(
        [
            # The pair that separates "a residue class" from "the number the prover held".
            ("the same element one period up", answer + main.p),
            ("the same element one period down", answer - main.p),
            # The record read as counting from the other end of the range.
            ("the record read from the wrong end", main.lo + (main.hi - answer)),
            # The record mistaken for the value itself.
            ("the record taken as the value", answer - main.lo),
            ("the edge statement's witness", panel_.edge.witness),
        ],
        answer,
    )
    return [(label, [str(value)]) for label, value in near] + [
        ("not a number", ["thirty"]),
        ("nothing at all", []),
    ]


def wrong_forges(seed: str) -> list[tuple[str, list[str]]]:
    panel_ = build_panel(seed, LIVE)
    main = panel_.main
    answer = forged_value(panel_)
    if answer is None:
        raise AssertionError(f"{seed}: the live panel has nothing to forge")
    unsound = panel_.by_role("unsound")
    candidates: list[tuple[str, int]] = [
        ("the honest witness, which is inside the range", main.witness),
        ("a value outside the range that solves nothing", main.hi + 1),
        ("a value below the range that solves nothing", main.lo - 1),
        ("the edge statement's witness", panel_.edge.witness),
    ]
    # The solution on the other side of the range. On a panel whose unsound verifier
    # dropped the range entirely it is also accepted, so it is only a wrong answer when
    # this panel's verifier will not take it -- listed conditionally rather than always.
    other_side = 2 * main.witness - answer
    if not in_range(main, other_side) and not accepts(unsound, main, other_side):
        candidates.append(("the solution on the side this panel does not take", other_side))
    near = _rejectable([(label, value) for label, value in candidates], answer)
    return [(label, [str(value)]) for label, value in near] + [
        ("not a number", ["big"]),
        ("nothing at all", []),
    ]


def wrong_classifications(seed: str) -> list[tuple[str, list[str]]]:
    panel_ = build_panel(seed, LIVE)
    table = matrix(panel_)
    ids = panel_.ids()
    truth = {vid: [prop for prop in PROPERTIES if table[vid][prop]] for vid in ids}

    def rendered(held: dict[str, list[str]]) -> list[str]:
        return [f"{vid}=" + (",".join(held[vid]) if held[vid] else "none") for vid in ids]

    correct = rendered(truth)
    cases = [
        # The misconception the stage exists for: one defect read as guaranteeing nothing.
        ("every verifier guarantees nothing", {vid: [] for vid in ids}),
        # And its mirror: a defect noticed and then treated as harmless.
        ("every verifier still guarantees everything", {vid: list(PROPERTIES) for vid in ids}),
        # The right rows, rotated onto the wrong verifiers.
        (
            "the right rows on the wrong verifiers",
            {ids[index]: truth[ids[(index + 1) % len(ids)]] for index in range(len(ids))},
        ),
        # The first row right and a later one wrong. Without this, a judge that compares
        # only the verifier listed first grades every catalog entry the same way the real
        # one does, and the mutation survives -- which is how this entry came to exist.
        (
            "the first row right and the last two swapped",
            {ids[0]: truth[ids[0]], ids[1]: truth[ids[2]], ids[2]: truth[ids[1]]},
        ),
    ]
    out = [(label, rendered(held)) for label, held in cases if rendered(held) != correct]
    return out + [
        ("one verifier left out", correct[:-1]),
        ("a property that does not exist", [f"{ids[0]}=fast", *correct[1:]]),
        ("a verifier from the other panel", ["q1=complete", *correct[1:]]),
        ("nothing at all", []),
    ]


def wrong_transfers(seed: str) -> list[tuple[str, list[str]]]:
    live = build_panel(seed, LIVE)
    second = build_panel(seed, TRANSFER)
    forged = forged_value(second)
    if forged is None:
        raise AssertionError(f"{seed}: the second panel has nothing to forge")
    correct = {
        "reject": second.edge.witness,
        "recover": second.main.witness,
        "forge": forged,
    }

    def rendered(values: dict[str, int]) -> list[str]:
        return [f"{name}={values[name]}" for name in ("reject", "recover", "forge")]

    edge = second.edge
    main = second.main
    cases = [
        # The one that matters: a participant who matched a shape instead of reading.
        (
            "the first panel's three answers, resubmitted",
            {
                "reject": live.edge.witness,
                "recover": live.main.witness,
                "forge": forged_value(live) or 0,
            },
        ),
        (
            "the strict bound assumed to be on the same end",
            {**correct, "reject": edge.hi if correct["reject"] == edge.lo else edge.lo},
        ),
        ("the congruence taken off the other side", {**correct, "forge": 2 * main.witness - forged}),
        (
            "the record read from the wrong end",
            {**correct, "recover": main.lo + (main.hi - correct["recover"])},
        ),
    ]
    out = [
        (label, rendered(values)) for label, values in cases if rendered(values) != rendered(correct)
    ]
    return out + [
        ("only two of the three readings", rendered(correct)[:2]),
        ("the readings unnamed", [str(correct["reject"]), str(correct["recover"])]),
        ("nothing at all", []),
    ]


WRONG = (
    ("reject", "check_reject", wrong_rejects),
    ("recover", "check_recover", wrong_recovers),
    ("forge", "check_forge", wrong_forges),
    ("classify", "check_classify", wrong_classifications),
    ("transfer", "check_transfer", wrong_transfers),
)

REFERENCE = (
    ("reject", "check_reject", reject_arguments),
    ("recover", "check_recover", recover_arguments),
    ("forge", "check_forge", forge_arguments),
    ("classify", "check_classify", classify_arguments),
    ("transfer", "check_transfer", transfer_arguments),
)


# --------------------------------------------------------------------------- harness


_loaded = 0


def load_judge(source: str) -> types.ModuleType:
    """Load a (possibly mutated) judge as its own module, with the real import graph."""
    global _loaded  # noqa: PLW0603 - a counter for unique module names
    _loaded += 1
    name = f"mutated_judge_{_loaded}"
    module = types.ModuleType(name)
    module.__file__ = str(ROOT / "lab" / "judge.py")
    # Registered before exec because `@dataclass` looks its class's module up in
    # sys.modules while the class body is still being processed.
    sys.modules[name] = module
    exec(compile(source, "<mutation>", "exec"), module.__dict__)  # noqa: S102 - our own fixture
    return module


def survivors_of(
    judge: types.ModuleType, seeds: tuple[str, ...] = SEEDS, stop_early: bool = True
) -> list[str]:
    """Every wrong answer this judge accepts, plus a reference answer it rejects.

    `stop_early` because a mutant only has to be caught once; the unmutated judge is
    graded with the full report.
    """
    escaped: list[str] = []
    for seed in seeds:
        try:
            for stage, function, arguments_for in REFERENCE:
                if not getattr(judge, function)(seed, arguments_for(seed)).passed:
                    escaped.append(f"{seed}: rejects the reference {stage}")
            if escaped and stop_early:
                break
            for stage, function, catalog in WRONG:
                for label, arguments in catalog(seed):
                    if getattr(judge, function)(seed, arguments).passed:
                        escaped.append(f"accepts a wrong {stage} -- {label}")
                        if stop_early:
                            break
                if escaped and stop_early:
                    break
        except Exception as error:  # noqa: BLE001 - a judge that crashes has been caught
            escaped.append(f"{seed}: raised {type(error).__name__}")
            break
        if escaped and stop_early:
            break
    return sorted(set(escaped))


def replace(old: str, new: str) -> str:
    if old not in JUDGE_SOURCE:
        raise AssertionError(f"mutation target no longer present in judge.py: {old!r}")
    return JUDGE_SOURCE.replace(old, new, 1)


#: Every verifier made correct: closed range, nothing recorded. A panel in this state
#: poses none of the three questions `show` says it poses, and is what the judge's
#: well-posedness guard exists to refuse.
_COLLAPSE = "\n".join(
    [
        "    import dataclasses as _dc",
        "    panel_ = _dc.replace(panel_, verifiers=tuple(",
        "        _dc.replace(v, range_rule='closed', audit_key='') for v in panel_.verifiers))",
    ]
)


# Two mutations are deliberately absent, both because they change a message rather than a
# verdict, and listing an equivalent mutant produces a permanent "SURVIVED" that trains
# authors to ignore the suite:
#
#   - removing the middle branch of `judge_recover`, the one that recognises another
#     element of the same residue class. The branch above it has already decided the
#     verdict; this one only chooses which of the two mistakes to name.
#   - removing the `satisfies_congruence` branch from `judge_forge`. A value that solves
#     nothing is accepted by no verifier here, so the `accepting` check below rejects it
#     anyway. The branch exists to say which half is missing.
#
# The corresponding branches that DO change a verdict are all listed.
MUTATIONS: list[tuple[str, str]] = [
    (
        "reject accepts a solution of the congruence that is outside the range",
        replace(
            "    true_of = [st for st in panel_.statements() if is_true_of(st, claimed)]",
            "    true_of = [st for st in panel_.statements() "
            "if satisfies_congruence(st, claimed)]",
        ),
    ),
    (
        "reject accepts an in-range value that solves nothing",
        replace(
            "    true_of = [st for st in panel_.statements() if is_true_of(st, claimed)]",
            "    true_of = [st for st in panel_.statements() if in_range(st, claimed)]",
        ),
    ),
    (
        # Killed by the main statement's own witness, which is valid and which every
        # verifier accepts. That answer only became reachable when `judge_reject` started
        # grading over both statements; pinned to the edge statement alone, the branch
        # could not be entered and this mutation survived.
        "reject stops requiring anybody to actually refuse it",
        replace("        if not refusing:\n            continue", "        if False:\n            continue"),
    ),
    (
        "reject accepts anything that parses",
        replace(
            "    verdict = Verdict(passed=False)\n    true_of = ",
            "    verdict = Verdict(passed=False)\n    verdict.passed = True\n"
            "    return verdict\n    true_of = ",
        ),
    ),
    (
        "recover accepts any element of the same residue class",
        replace(
            "    if claimed == statement.witness:",
            "    if satisfies_congruence(statement, claimed):",
        ),
    ),
    (
        "recover accepts anything that parses",
        replace("    if claimed == statement.witness:", "    if True:"),
    ),
    (
        "forge stops requiring the value to be outside the range",
        replace("    if in_range(statement, claimed):", "    if False:"),
    ),
    (
        "forge stops requiring anybody to actually accept it",
        replace("    if not accepting:", "    if False:"),
    ),
    (
        "forge accepts anything that parses",
        replace(
            "    statement = panel_.main\n    verdict = Verdict(passed=False)\n"
            "    if in_range(statement, claimed):",
            "    statement = panel_.main\n    verdict = Verdict(passed=False)\n"
            "    verdict.passed = True\n    return verdict\n"
            "    if in_range(statement, claimed):",
        ),
    ),
    (
        "classify compares only the verifier the participant listed first",
        replace("    for verifier_id in ids:", "    for verifier_id in ids[:1]:"),
    ),
    (
        # The six entries that are NOT breaks are the whole content of the stage. This
        # mutant grades only the three that are, which is what a participant who thinks
        # "one bug means it guarantees nothing" would also do.
        "classify checks which property is broken and ignores what is still held",
        replace(
            "        if claimed[verifier_id] == truth:",
            "        if (len(claimed[verifier_id]) < len(PROPERTIES)) == "
            "(len(truth) < len(PROPERTIES)):",
        ),
    ),
    (
        "classify accepts anything that parses",
        replace("    table = matrix(panel_)", "    verdict.passed = True\n    return verdict"),
    ),
    (
        # The guard is the only thing between a collapsed panel and a set of stages that
        # no longer ask what `show` says they ask. Mutating the guard alone is an
        # equivalent mutant -- the shipped panels are well posed on every seed, which
        # `panel_failures` re-checks, so removing a check that never fires changes no
        # verdict. It has to be paired with the collapse it exists to catch.
        "the panel collapses to three verifiers that break nothing",
        replace("    panel_ = build_panel(seed, name)", f"    panel_ = build_panel(seed, name)\n{_COLLAPSE}"),
    ),
    (
        "the panel collapses and the guard goes with it",
        replace(
            "    panel_ = build_panel(seed, name)", f"    panel_ = build_panel(seed, name)\n{_COLLAPSE}"
        ).replace(
            "    problems = well_posed(panel_)\n    if problems:",
            "    problems = well_posed(panel_)\n    if False:",
            1,
        ),
    ),
    (
        "transfer grades the second panel's answers against the first panel",
        replace(
            "    panel_ = checked_panel(seed, TRANSFER)", "    panel_ = checked_panel(seed, LIVE)"
        ),
    ),
    (
        "transfer stops at the first reading that passes",
        replace(
            "        if inner.passed:\n            cleared.append(name)\n            continue",
            "        if inner.passed:\n            verdict.passed = True\n            return verdict",
        ),
    ),
    (
        "transfer accepts anything that parses",
        replace(
            '    verdict.say(f"main statement: {panel_.main.rendered()}")',
            "    verdict.passed = True\n    return verdict\n"
            '    verdict.say(f"main statement: {panel_.main.rendered()}")',
        ),
    ),
]


# --------------------------------------------------------------------------- the panels


def panel_failures() -> list[str]:
    """Every seed poses a panel with three distinct answers, and two panels that differ.

    `well_posed` is the same function the judge refuses to grade on, so this is its
    author-side sweep: a construction that leaves a stage unanswerable shows up here as a
    line, rather than in the container as a stage nobody can clear. The collision it
    catches is real -- the two statements are drawn independently, so their witnesses
    came out equal on about one seed in forty before `_statement` was taught to avoid it,
    and `reject` and `recover` then had the same answer.
    """
    failures: list[str] = []
    for index in range(120):
        seed = f"panel-sweep-{index}"
        live = build_panel(seed, LIVE)
        second = build_panel(seed, TRANSFER)
        for name, panel_ in ((LIVE, live), (TRANSFER, second)):
            failures.extend(f"{seed}/{name}: {problem}" for problem in well_posed(panel_))
        # The transfer measures nothing if the second panel is the first one again.
        for role in ("incomplete", "unsound", "leaky"):
            first = (live.by_role(role).range_rule, live.by_role(role).audit_key)
            other = (second.by_role(role).range_rule, second.by_role(role).audit_key)
            if first == other:
                failures.append(f"{seed}: the {role} verifier wears one flavour on both panels")
    return failures


def permutation_failures() -> list[str]:
    """The role assignment moves with the seed, or the classification is a remembered string."""
    failures: list[str] = []
    for name in (LIVE, TRANSFER):
        orders = {
            tuple(v.role for v in build_panel(f"permutation-{index}", name).verifiers)
            for index in range(120)
        }
        if len(orders) < 6:
            failures.append(f"panel {name} only ever assigns {len(orders)} of the 6 role orders")
    return failures


# --------------------------------------------------------------------------- the gates


def cli(seed: str, state: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603 - argument list, shell=False
        [sys.executable, str(ROOT / "review.py"), *arguments],
        capture_output=True,
        text=True,
        timeout=180,
        cwd="/",
        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "FLAG_SEED": seed, "LAB_STATE_DIR": str(state)},
        check=False,
    )


def _with_progress(stages: tuple[str, ...]):
    """A throwaway state directory with exactly `stages` recorded as cleared."""
    directory = tempfile.TemporaryDirectory()
    state = Path(directory.name) / "state"
    state.mkdir()
    (state / "progress.json").write_text(
        json.dumps({stage: True for stage in stages}), encoding="utf-8"
    )
    return directory, state


def gate_failures() -> list[str]:
    """The flag is released for exactly one of the thirty-two progress states.

    Enumerated rather than hand-listed: with five stages a hand-written list is where the
    one subset nobody thought of goes missing.
    """
    failures: list[str] = []
    seed = SEEDS[0]
    expected = derive_flag(seed)
    all_stages = real_progress.STAGES
    for size in range(len(all_stages) + 1):
        for stages in itertools.combinations(all_stages, size):
            directory, state = _with_progress(stages)
            with directory:
                released = expected in cli(seed, state, "flag").stdout
                should_release = set(stages) == set(all_stages)
                if released != should_release:
                    failures.append(
                        f"progress {list(stages) or 'none'}: flag "
                        + ("released" if released else "withheld")
                    )
    return failures


def lock_failures() -> list[str]:
    """Both gates, driven through the CLI, since the locks are state the judges never see."""
    failures: list[str] = []
    seed = SEEDS[0]
    second = build_panel(seed, TRANSFER)
    classify = classify_arguments(seed)
    transfer = transfer_arguments(seed)

    for size in range(len(real_progress.DEMONSTRATIONS)):
        for stages in itertools.combinations(real_progress.DEMONSTRATIONS, size):
            directory, state = _with_progress(stages)
            with directory:
                if cli(seed, state, "classify", *classify).returncode == 0:
                    failures.append(f"progress {list(stages) or 'none'}: classify was accepted")

    for size in range(len(real_progress.MAIN_STAGES)):
        for stages in itertools.combinations(real_progress.MAIN_STAGES, size):
            directory, state = _with_progress(stages)
            with directory:
                if cli(seed, state, "transfer", *transfer).returncode == 0:
                    failures.append(f"progress {list(stages) or 'none'}: transfer was accepted")
                shown = cli(seed, state, "show").stdout
                if second.main.rendered() in shown or second.edge.rendered() in shown:
                    failures.append(f"progress {list(stages) or 'none'}: `show` printed the panel")
                if cli(seed, state, "run", second.ids()[0], "1").returncode == 0:
                    failures.append(f"progress {list(stages) or 'none'}: `run` reached the panel")

    directory, state = _with_progress(real_progress.MAIN_STAGES)
    with directory:
        shown = cli(seed, state, "show").stdout
        if second.main.rendered() not in shown or second.edge.rendered() not in shown:
            failures.append("the second panel is not printed once the first four are cleared")
        if cli(seed, state, "run", second.ids()[0], "1").returncode != 0:
            failures.append("`run` cannot reach the second panel once it is handed over")
    return failures


def run_is_free_failures() -> list[str]:
    """`review run` is advertised as unscored. It has to actually record nothing."""
    failures: list[str] = []
    seed = SEEDS[0]
    live = build_panel(seed, LIVE)
    with tempfile.TemporaryDirectory() as directory:
        state = Path(directory) / "state"
        state.mkdir()
        for verifier_id in live.ids():
            for w in (live.main.witness, live.edge.witness, 0):
                if cli(seed, state, "run", verifier_id, str(w)).returncode != 0:
                    failures.append(f"`run {verifier_id} {w}` failed")
        if "cleared" in cli(seed, state, "status").stdout:
            failures.append("`run` recorded progress")
        if derive_flag(seed) in cli(seed, state, "flag").stdout:
            failures.append("the flag was released after runs alone")
    return failures


def end_to_end_failures() -> list[str]:
    """The commands a participant types, in order, from an empty container."""
    failures: list[str] = []
    for seed in SEEDS:
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            state.mkdir()
            if cli(seed, state).returncode != 0:
                failures.append(f"{seed}: bare `review` does not print usage")
            show = cli(seed, state, "show")
            if show.returncode != 0:
                failures.append(f"{seed}: `review show` failed")
            if derive_flag(seed) in show.stdout:
                failures.append(f"{seed}: `review show` prints the flag")
            # The honest record has to be on screen, or `recover` has no source to read.
            live = build_panel(seed, LIVE)
            leaked = live.main.witness - live.main.lo
            if f'"position_in_range": {leaked}' not in show.stdout:
                failures.append(f"{seed}: `review show` carries no record to recover from")
            for stage, _function, arguments_for in REFERENCE:
                if cli(seed, state, stage, *arguments_for(seed)).returncode != 0:
                    failures.append(f"{seed}: the reference {stage} did not clear its stage")
            if derive_flag(seed) not in cli(seed, state, "flag").stdout:
                failures.append(f"{seed}: the flag was not released after all five stages")
    return failures


# --------------------------------------------------------------------------- main


def main() -> int:
    problems: list[str] = []

    escaped = survivors_of(load_judge(JUDGE_SOURCE), stop_early=False)
    if escaped:
        print("FAIL the unmutated judge does not grade correctly:")
        for line in escaped:
            print(f"  - {line}")
        return 1
    catalog_size = sum(len(catalog(SEEDS[0])) for _stage, _function, catalog in WRONG)
    print(
        f"PASS the reference answers pass and {catalog_size} wrong answers are rejected, "
        f"on {len(SEEDS)} seeds"
    )

    problems.extend(f"panel: {failure}" for failure in panel_failures())
    problems.extend(f"panel: {failure}" for failure in permutation_failures())
    if not problems:
        print("PASS every seed poses a panel with three answers, and the two panels differ")

    problems.extend(end_to_end_failures())
    if not problems:
        print("PASS the CLI takes a participant from an empty container to the flag")

    problems.extend(f"run: {failure}" for failure in run_is_free_failures())
    if not problems:
        print("PASS `review run` clears nothing, however much it is used")

    problems.extend(f"lock: {failure}" for failure in lock_failures())
    if not problems:
        print("PASS classify waits for the three breaks, and the second panel for all four")

    problems.extend(f"flag gate: {failure}" for failure in gate_failures())
    if not problems:
        print("PASS the flag is released for the complete progress state and no other")

    survivors: list[str] = []
    for name, source in MUTATIONS:
        if survivors_of(load_judge(source)):
            print(f"KILLED {name}")
        else:
            survivors.append(name)
            print(f"SURVIVED {name}")

    print()
    if survivors or problems:
        for line in problems:
            print(f"FAILED {line}")
        if survivors:
            print(f"{len(survivors)} mutation(s) survived:")
            for name in survivors:
                print(f"  - {name}")
        return 1
    print(f"All {len(MUTATIONS)} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
