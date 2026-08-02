"""Author / CI suite: prove the judge can fail a wrong answer, and the gate can hold.

Four parts, run by `make reference-test` inside the `author` image.

1. The reference answers clear all four stages and produce the flag, end to end
   through the CLI a participant actually types, on several seeds.
2. A catalog of wrong answers is rejected, each for its own reason. These are the
   near misses: a prediction that is right modulo nothing, an index that does leave
   the window but is not the first one that does, a rule that is correct for every
   forward-running case and wrong the moment the step goes below zero, a rule with
   this deployment's numbers written into it.
3. The judge is broken on purpose, one requirement at a time, and every broken
   version has to be caught by that catalog. A checkpoint nobody can fail is not a
   checkpoint, and this is the only thing that tests the tests.
4. The gates: the transfer case is refused until the first three are cleared, and
   the flag is withheld for every one of the sixteen progress states except the
   complete one.

The submission is not what gets mutated here, because there is no submission: the
grading moved into the image when the problem moved into the terminal. What gets
mutated is the judge.
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
    broken_case,
    final_value,
    flag as derive_flag,
    main_case,
    transfer_broken_case,
    transfer_case,
)
from lab import progress as real_progress
from lab.judge import check_locate, check_predict, check_rule, check_transfer
from reference.solve import (
    locate_arguments,
    predict_arguments,
    rule_arguments,
    transfer_arguments,
)

#: Enough seeds that the cases vary in every direction that matters.
SEEDS = tuple(f"mutation-seed-{index}" for index in range(8))

JUDGE_SOURCE = (ROOT / "lab" / "judge.py").read_text(encoding="utf-8")


# --------------------------------------------------------------------------- wrong answers


def _rejectable(
    candidates: list[tuple[str, object]], correct: object
) -> list[tuple[str, object]]:
    """Drop any near miss that, for this seed, happens to be the right answer.

    The parameters are small, so "one round short" and "where it started" sometimes
    coincide with the answer. A catalog entry that is secretly correct would be
    reported as an escaped wrong answer on every seed where it lands, and the only
    honest fix is to notice and drop it rather than to widen the parameters until it
    stops happening.
    """
    return [(label, value) for label, value in candidates if value != correct]


def wrong_predictions(seed: str) -> list[tuple[str, list[str]]]:
    case = main_case(seed)
    answer = final_value(case)
    near = _rejectable(
        [
            ("the value one round short", (answer - case.step) % case.modulus),
            ("the value one round long", (answer + case.step) % case.modulus),
            ("where the counter started", case.start % case.modulus),
            ("the sum, never brought back into the window", case.start + case.step * case.rounds),
        ],
        answer,
    )
    return [(label, [str(value)]) for label, value in near] + [
        ("a value outside the window", [str(case.modulus + 1)]),
        ("a negative value", ["-1"]),
        ("not a number", ["nine"]),
        ("nothing at all", []),
        ("two numbers at once", ["1", "2"]),
    ]


def wrong_locations(seed: str) -> list[tuple[str, list[str]]]:
    case, values, answer = broken_case(seed)
    #: The trace leaves the window more than once. This is the entry that does so
    #: without being the first, and it is the only wrong answer that can tell a judge
    #: which asks "is it outside the window" from one which asks "is it the first".
    later = [
        index
        for index, value in enumerate(values)
        if index != answer and not (0 <= value < case.modulus)
    ]
    near = _rejectable(
        [
            ("the first entry, which is inside the window", 0),
            ("the entry after the break", min(answer + 1, len(values) - 1)),
            ("the last entry", len(values) - 1),
            *(
                [("a later entry that is also outside the window", later[0])]
                if later
                else []
            ),
        ],
        answer,
    )
    return [(label, [str(value)]) for label, value in near] + [
        ("an index past the end of the trace", [str(len(values))]),
        ("a negative index", ["-1"]),
        ("not a number", ["third"]),
        ("nothing at all", []),
    ]


def wrong_rules(seed: str) -> list[tuple[str, list[str]]]:
    case = main_case(seed)
    return [
        # Killed by every case in the family at once.
        ("the sum, never brought back into the window", ["start + step*rounds"]),
        # Killed only by a case other than this deployment's own -- which is what makes
        # the family, rather than the visible case, the thing being graded against.
        ("this deployment's answer written down as a constant", [str(final_value(case))]),
        (
            "this deployment's numbers hard-coded instead of the names",
            [f"({case.start} + {case.step}*{case.rounds}) % {case.modulus}"],
        ),
        # Killed only by the family's members with rounds > 0 / start >= modulus.
        ("the rounds ignored", ["start % modulus"]),
        ("the start ignored", ["(step*rounds) % modulus"]),
        ("the window applied to each part separately", ["start % modulus + (step*rounds) % modulus"]),
        ("off by one round", ["(start + step*(rounds + 1)) % modulus"]),
        ("the step running the wrong way", ["(start - step*rounds) % modulus"]),
        ("division, which this language does not have", ["start / modulus"]),
        ("an equation rather than an expression", ["value = start % modulus"]),
        ("not an expression at all", ["start step"]),
        ("nothing at all", []),
    ]


def wrong_transfers(seed: str) -> list[tuple[str, list[str]]]:
    case = transfer_case(seed)
    _broken, values, answer = transfer_broken_case(seed)
    correct = (final_value(case), answer)
    near = _rejectable(
        [
            # The whole point of the stage: the same value, one modulus too low,
            # because the negative representative was never brought back up.
            (
                "the prediction with the negative representative left unnormalised",
                (correct[0] - case.modulus, answer),
            ),
            ("the right prediction and an entry still inside the window", (correct[0], 0)),
            (
                "the right index and a prediction off by one round",
                ((correct[0] - case.step) % case.modulus, answer),
            ),
            (
                "the main case's answers, submitted again",
                (final_value(main_case(seed)), broken_case(seed)[2]),
            ),
        ],
        correct,
    )
    return [
        (label, [f"predict={pair[0]}", f"locate={pair[1]}"])  # type: ignore[index]
        for label, pair in near
    ] + [
        ("only one of the two readings", [f"predict={correct[0]}"]),
        ("the readings unnamed", [str(correct[0]), str(answer)]),
        ("nothing at all", []),
    ]


WRONG = (
    ("predict", "check_predict", wrong_predictions),
    ("locate", "check_locate", wrong_locations),
    ("rule", "check_rule", wrong_rules),
    ("transfer", "check_transfer", wrong_transfers),
)

REFERENCE = (
    ("predict", "check_predict", predict_arguments),
    ("locate", "check_locate", locate_arguments),
    ("rule", "check_rule", rule_arguments),
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

    `stop_early` because a mutant only has to be caught once and the rule family walk
    is the expensive part; the unmutated judge is graded with the full report.
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


# Two mutations are deliberately absent, both for the same reason: they change a
# message, not a verdict, and listing an equivalent mutant produces a permanent
# "SURVIVED" that trains authors to ignore the suite.
#
#   - removing the `in_window` guard from `check_predict`. A value outside
#     [0, modulus) is never equal to the final value either, so the comparison after
#     it rejects exactly the same predictions. The guard exists to say "outside the
#     window" instead of "somewhere else".
#   - removing the `in_window` branch from `_locate_verdict`. Same shape: an entry
#     inside the window is never the first entry outside it, so `claimed != answer`
#     already rejects it. The branch exists to say which promise the entry keeps.
#
# A third is absent for a different and more interesting reason: defaulting a missing
# reading in `parse_named` to 0 rather than refusing it. That is NOT equivalent -- it
# would accept half an answer on any deployment whose correct reading happens to be
# zero -- but no wrong answer in the catalog can trigger it, because whether such a
# deployment is in the seed set is luck. Reporting SURVIVED for a real defect trains
# authors to ignore the suite just as reliably as reporting it for an equivalent
# mutant does, so the requirement is asserted directly instead, in
# `partial_answer_failures` below, where it holds on every seed.
MUTATIONS: list[tuple[str, str]] = [
    (
        "predict stops comparing against the counter",
        replace("    if claimed != final_value(case):", "    if False:"),
    ),
    (
        "predict accepts anything that parses",
        replace(
            "    verdict.say(f\"case: {case.rendered()}\")",
            "    verdict.passed = True\n    return verdict\n    verdict.say(f\"case: {case.rendered()}\")",
        ),
    ),
    (
        "locate stops requiring the entry to be the FIRST one outside the window",
        replace("    if claimed != answer:", "    if False:"),
    ),
    (
        # Removing the bound does not soften the verdict, it removes it: `values[claimed]`
        # raises IndexError and the participant gets a traceback instead of a reason.
        # Killed by the catalog's index-past-the-end entry, which is the point -- a judge
        # that crashes has failed just as surely as one that accepts a wrong answer.
        "locate stops bounding the index to the trace",
        replace("    if not 0 <= claimed < len(values):", "    if False:"),
    ),
    (
        "rule stops comparing against the counter",
        replace("        if claimed == final_value(case):\n            continue", "        continue"),
    ),
    (
        "rule is graded on this deployment's case alone",
        replace("    for case in family:", "    for case in family[:1]:"),
    ),
    (
        # Emptied, not shortened: a one-case family still fails an unreduced rule, so
        # it would exercise the loop rather than the guard. Emptying it is the state
        # in which every rule is accepted, and the guard is the only thing between
        # that state and a checkpoint nobody can fail.
        "the rule family collapses to nothing that can fail an unreduced rule",
        replace("    family = rule_family(seed)", "    family = rule_family(seed)[:0]"),
    ),
    (
        "the rule family collapses and the non-vacuity guard goes with it",
        replace("    family = rule_family(seed)", "    family = rule_family(seed)[:0]").replace(
            '        raise AssertionError("the parameter family cannot fail an unreduced rule")',
            "        pass",
            1,
        ),
    ),
    (
        "rule accepts anything that parses",
        replace(
            "    verdict.say(f\"rule: {source}\")",
            "    verdict.passed = True\n    return verdict\n    verdict.say(f\"rule: {source}\")",
        ),
    ),
    (
        "transfer checks the prediction and ignores the index",
        replace(
            "    inner = _locate_verdict(broken, values, answer, claimed[\"locate\"], \"broken trace\")",
            "    inner = _locate_verdict(broken, values, answer, answer, \"broken trace\")",
        ),
    ),
    (
        "transfer checks the index and ignores the prediction",
        replace("    if claimed[\"predict\"] != final_value(case):", "    if False:"),
    ),
    (
        "transfer accepts anything that parses",
        replace(
            "    verdict.say(f\"predict case: {case.rendered()}\")",
            "    verdict.passed = True\n    return verdict\n"
            "    verdict.say(f\"predict case: {case.rendered()}\")",
        ),
    ),
]


# --------------------------------------------------------------------------- the gates


def cli(seed: str, state: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603 - argument list, shell=False
        [sys.executable, str(ROOT / "counter.py"), *arguments],
        capture_output=True,
        text=True,
        timeout=120,
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
    """The flag is released for exactly one of the sixteen progress states.

    Enumerated rather than hand-listed: with four stages a hand-written list is where
    the one subset nobody thought of goes missing.
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


def transfer_lock_failures() -> list[str]:
    """The transfer case is neither shown nor accepted until the first three are cleared."""
    failures: list[str] = []
    seed = SEEDS[0]
    case = transfer_case(seed)
    correct = transfer_arguments(seed)
    for size in range(len(real_progress.MAIN_STAGES)):
        for stages in itertools.combinations(real_progress.MAIN_STAGES, size):
            directory, state = _with_progress(stages)
            with directory:
                if cli(seed, state, "transfer", *correct).returncode == 0:
                    failures.append(f"progress {list(stages) or 'none'}: transfer was accepted")
                if case.rendered() in cli(seed, state, "show").stdout:
                    failures.append(f"progress {list(stages) or 'none'}: `show` printed the case")
    directory, state = _with_progress(real_progress.MAIN_STAGES)
    with directory:
        if case.rendered() not in cli(seed, state, "show").stdout:
            failures.append("the transfer case is not printed once the first three are cleared")
    return failures


def partial_answer_failures() -> list[str]:
    """Half a transfer answer is refused, and the refusal names the reading that is missing.

    See the note above the mutation list for why this is a direct assertion rather than
    a mutation: the defect it guards against only changes a verdict on a deployment whose
    correct reading is zero, and that is not something a seed set can be relied on to
    contain. Asserted as behaviour, it holds on every seed.
    """
    failures: list[str] = []
    for seed in SEEDS:
        given = dict(part.split("=", 1) for part in transfer_arguments(seed))
        for present, omitted in (("predict", "locate"), ("locate", "predict")):
            verdict = check_transfer(seed, [f"{present}={given[present]}"])
            if verdict.passed:
                failures.append(f"{seed}: accepted a transfer answer with no {omitted}")
            if not any(f"no value for {omitted}" in line for line in verdict.lines):
                failures.append(f"{seed}: refusing a partial answer does not name {omitted}")
    return failures


def end_to_end_failures() -> list[str]:
    """The commands a participant types, in order, from an empty container."""
    failures: list[str] = []
    for seed in SEEDS:
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            state.mkdir()
            if cli(seed, state).returncode != 0:
                failures.append(f"{seed}: bare `counter` does not print usage")
            show = cli(seed, state, "show")
            if show.returncode != 0:
                failures.append(f"{seed}: `counter show` failed")
            if derive_flag(seed) in show.stdout:
                failures.append(f"{seed}: `counter show` prints the flag")
            for stage, _function, arguments_for in REFERENCE:
                if cli(seed, state, stage, *arguments_for(seed)).returncode != 0:
                    failures.append(f"{seed}: the reference {stage} did not clear its stage")
            if derive_flag(seed) not in cli(seed, state, "flag").stdout:
                failures.append(f"{seed}: the flag was not released after all four stages")
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

    problems.extend(end_to_end_failures())
    if not problems:
        print("PASS the CLI takes a participant from an empty container to the flag")

    problems.extend(f"transfer lock: {failure}" for failure in transfer_lock_failures())
    if not problems:
        print("PASS the transfer case is locked until the first three stages are cleared")

    problems.extend(f"partial answer: {failure}" for failure in partial_answer_failures())
    if not problems:
        print("PASS half a transfer answer is refused, and the refusal names what is missing")

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
