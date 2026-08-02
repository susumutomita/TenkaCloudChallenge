"""Author / CI suite: prove the judge can fail a wrong answer, and the gate can hold.

Five parts, run by `make reference-test` inside the `author` image.

1. The reference answers clear all four stages and produce the flag, end to end through
   the CLI a participant actually types, on several seeds.
2. A catalog of wrong answers is rejected, each for its own reason. These are the near
   misses: the sum of a ledger before it is brought back into the field, a completion
   rule that is right on this deployment's numbers and written as a constant, offsets
   that add to zero with one party left where it was, and the first setting's three
   answers resubmitted for the second.
3. The judge is broken on purpose, one requirement at a time, and every broken version
   has to be caught by that catalog. A checkpoint nobody can fail is not a checkpoint,
   and this is the only thing that tests the tests.
4. The settings themselves: every seed has to hand over ledgers the stages can be
   answered from, a `known` that really is larger than the modulus, and a second setting
   that differs from the first in both the modulus and the party count.
5. The gates: the second setting is neither shown nor accepted until the first three
   stages are cleared, and the flag is withheld for every one of the sixteen progress
   states except the complete one.

The submission is not what gets mutated here, because there is no submission: the
grading moved into the image when the problem moved into the terminal. What gets mutated
is the judge.
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
    TRANSFER,
    completion,
    completion_family,
    family_is_vacuous,
    flag as derive_flag,
    ledger_a,
    ledger_b,
    setting,
    target_value,
)
from lab import progress as real_progress
from reference.solve import (
    complete_arguments,
    recover_arguments,
    refresh_arguments,
    refresh_offsets,
    transfer_arguments,
    transfer_completion,
)

#: Enough seeds that the moduli, the party counts and the missing party all vary.
SEEDS = tuple(f"mutation-seed-{index}" for index in range(8))

JUDGE_SOURCE = (ROOT / "lab" / "judge.py").read_text(encoding="utf-8")


# --------------------------------------------------------------------------- wrong answers


def _rejectable(
    candidates: list[tuple[str, object]], correct: object
) -> list[tuple[str, object]]:
    """Drop any near miss that, for this seed, happens to be the right answer.

    The numbers are small, so "one of the shares" and "the total" sometimes coincide. A
    catalog entry that is secretly correct would be reported as an escaped wrong answer
    on every seed where it lands, and the honest fix is to notice and drop it rather than
    to widen the parameters until it stops happening.
    """
    return [(label, value) for label, value in candidates if value != correct]


def wrong_recovers(seed: str) -> list[tuple[str, list[str]]]:
    ledger = ledger_a(seed, LIVE)
    answer = ledger.secret
    raw = sum(ledger.shares)
    near = _rejectable(
        [
            # The one that separates "an element of the field" from "a sum of integers".
            ("the sum before it is reduced", raw),
            ("the total one too high", answer + 1),
            ("the total one modulus up", answer + ledger.p),
            ("a single share", ledger.shares[0]),
            ("the other ledger's total", ledger_b(seed, LIVE).secret),
        ],
        answer,
    )
    return [(label, [str(value)]) for label, value in near] + [
        ("not a number", ["ninety"]),
        ("nothing at all", []),
        ("two numbers at once", [str(answer), str(answer)]),
    ]


def wrong_completes(seed: str) -> list[tuple[str, list[str]]]:
    family = completion_family(seed)
    first = family[0]
    return [
        # Killed by the whole family at once: `known` is a raw sum and usually exceeds
        # the modulus, so this is negative on the deployment's own numbers.
        ("the difference, never brought back into the field", ["target - known"]),
        # Killed only by a case other than the first -- which is what makes the family,
        # rather than the case on screen, the thing being graded against.
        ("this deployment's first case written down as a constant", [str(completion(first))]),
        (
            "this deployment's numbers hard-coded instead of the names",
            [f"({first.target} - {first.known}) % {first.modulus}"],
        ),
        ("what the others already hold, ignored", ["target % modulus"]),
        ("the target, ignored", ["known % modulus"]),
        ("the subtraction the wrong way round", ["(known - target) % modulus"]),
        ("added instead of subtracted", ["(target + known) % modulus"]),
        ("the reduction applied to each part separately", ["target % modulus - known % modulus"]),
        ("division, which this language does not have", ["target / modulus"]),
        ("an equation rather than an expression", ["share = target - known"]),
        ("not an expression at all", ["target known"]),
        ("nothing at all", []),
    ]


def wrong_refreshes(seed: str) -> list[tuple[str, list[str]]]:
    cfg = setting(seed, LIVE)
    correct = refresh_offsets(seed, LIVE)
    zero_at_end = [*correct[:-1], 0, (correct[-1]) % cfg.p]
    return [
        # Sums to zero, and one party's share never moves. The half of the requirement a
        # judge that only checks the sum would let through.
        ("a zero offset among offsets that do sum to zero", [",".join(map(str, zero_at_end[:cfg.n]))])
        if sum(zero_at_end[: cfg.n]) % cfg.p == 0
        else ("every offset zero", [",".join(["0"] * cfg.n)]),
        ("every offset zero", [",".join(["0"] * cfg.n)]),
        ("offsets that do not sum to zero", [",".join(["1"] * cfg.n)]),
        # Both of these are perfectly good zero-sharings with no zero in them -- for the
        # WRONG number of parties. Nothing but the count check can reject them, which is
        # what makes them the entries that kill it. The obvious near misses (drop the last
        # offset, append a zero) are caught by the sum check and the zero check instead,
        # so the count requirement survived until these were added.
        (
            "a zero-sharing for one party too few",
            [",".join(map(str, [1] * (cfg.n - 2) + [(-(cfg.n - 2)) % cfg.p]))],
        ),
        (
            "a zero-sharing for one party too many",
            [",".join(map(str, [1] * cfg.n + [(-cfg.n) % cfg.p]))],
        ),
        ("one offset too many, and one of them zero", [",".join(map(str, [*correct, 0]))]),
        ("offsets separated by spaces", [" ".join(map(str, correct))]),
        ("not numbers", ["a,b,c"]),
        ("nothing at all", []),
    ]


def wrong_transfers(seed: str) -> list[tuple[str, list[str]]]:
    second = setting(seed, TRANSFER)
    correct = {
        "recover": str(ledger_a(seed, TRANSFER).secret),
        "complete": str(transfer_completion(seed)),
        "refresh": refresh_arguments(seed, TRANSFER)[0],
    }

    def rendered(values: dict[str, str]) -> list[str]:
        return [f"{name}={values[name]}" for name in ("recover", "complete", "refresh")]

    from_live = {
        "recover": str(ledger_a(seed, LIVE).secret),
        "complete": str(completion(completion_family(seed)[0])),
        "refresh": refresh_arguments(seed, LIVE)[0],
    }
    non_canonical = {**correct, "complete": str(transfer_completion(seed) + second.p)}
    zeroed = {**correct, "refresh": ",".join(["0"] * second.n)}
    wrong_total = {**correct, "recover": str(sum(ledger_a(seed, TRANSFER).shares))}

    cases = [
        ("the first setting's three answers, resubmitted", from_live),
        ("a completion that lands but is not an element of the field", non_canonical),
        ("offsets that leave every share where it was", zeroed),
        ("the total before it is reduced", wrong_total),
    ]
    out = [
        (label, rendered(values)) for label, values in cases if rendered(values) != rendered(correct)
    ]
    return out + [
        ("only two of the three readings", rendered(correct)[:2]),
        ("the readings unnamed", [correct["recover"], correct["complete"]]),
        ("nothing at all", []),
    ]


WRONG = (
    ("recover", "check_recover", wrong_recovers),
    ("complete", "check_complete", wrong_completes),
    ("refresh", "check_refresh", wrong_refreshes),
    ("transfer", "check_transfer", wrong_transfers),
)

REFERENCE = (
    ("recover", "check_recover", recover_arguments),
    ("complete", "check_complete", complete_arguments),
    ("refresh", "check_refresh", refresh_arguments),
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

    `stop_early` because a mutant only has to be caught once and the family walk is the
    expensive part; the unmutated judge is graded with the full report.
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


# Two mutations are deliberately absent, both because they change a message rather than a
# verdict, and listing an equivalent mutant produces a permanent "SURVIVED" that trains
# authors to ignore the suite:
#
#   - removing `judge_recover`'s "that is the sum before it is reduced" branch. An
#     unreduced sum is not equal to the secret either, so the comparison above it has
#     already decided the verdict; the branch only names which mistake was made.
#   - removing the `0 <= claimed < p` branch from `judge_recover`. Same shape: a value
#     outside the field is never equal to the secret. (The equivalent branch in
#     `judge_transfer_completion` is NOT equivalent -- a share one modulus up does land
#     on the target -- and it is listed below.)
MUTATIONS: list[tuple[str, str]] = [
    (
        "recover accepts any representative of the total",
        replace("    if claimed == ledger.secret:", "    if claimed % ledger.p == ledger.secret:"),
    ),
    (
        "recover accepts anything that parses",
        replace("    if claimed == ledger.secret:", "    if True:"),
    ),
    (
        "complete stops comparing against the arithmetic",
        replace("        if claimed == completion(case):\n            continue", "        continue"),
    ),
    (
        "complete is graded on this deployment's first case alone",
        replace("    for case in family:", "    for case in family[:1]:"),
    ),
    (
        # Emptied, not shortened: a one-case family still fails an unreduced completion,
        # so it would exercise the loop rather than the guard. Emptying it is the state in
        # which every rule is accepted, and the guard is the only thing between that state
        # and a stage nobody can fail.
        "the parameter family collapses to nothing",
        replace("    family = completion_family(seed)", "    family = completion_family(seed)[:0]"),
    ),
    (
        "the parameter family collapses and the non-vacuity guard goes with it",
        replace(
            "    family = completion_family(seed)", "    family = completion_family(seed)[:0]"
        ).replace(
            '        raise AssertionError("the parameter family cannot fail an unreduced completion")',
            "        pass",
            1,
        ),
    ),
    (
        "complete accepts anything that parses",
        replace(
            '    verdict.say(f"rule: {source}")',
            '    verdict.passed = True\n    return verdict\n    verdict.say(f"rule: {source}")',
        ),
    ),
    (
        "refresh stops requiring the offsets to sum to zero",
        replace("    if residue != 0:", "    if False:"),
    ),
    (
        # The other half of a refresh, and the one a judge that only adds them up misses.
        "refresh stops requiring every share to move",
        replace("        if offset % p == 0:", "        if False:"),
    ),
    (
        "refresh stops requiring one offset per party",
        replace("    if len(offsets) != n:", "    if False:"),
    ),
    (
        "refresh accepts anything that parses",
        replace(
            "    problems = zero_sharing_problems(offsets, p, n)",
            "    problems = []",
        ),
    ),
    (
        "transfer grades the second setting against the first",
        replace("    cfg = setting(seed, TRANSFER)", "    cfg = setting(seed, LIVE)"),
    ),
    (
        "transfer checks the completion and the refresh but not the total",
        replace(
            "    inner = judge_recover(ledger_a(seed, TRANSFER), total)",
            "    inner = judge_recover(ledger_a(seed, TRANSFER), ledger_a(seed, TRANSFER).secret)",
        ),
    ),
    (
        "transfer checks the total and the refresh but not the completion",
        replace(
            "    inner = judge_transfer_completion(ledger, target, share)",
            "    inner = judge_transfer_completion(\n"
            "        ledger, target, (target - ledger.known()) % ledger.p)",
        ),
    ),
    (
        "transfer checks the total and the completion but not the refresh",
        replace(
            "    inner = judge_refresh(cfg.p, cfg.n, offsets)",
            "    inner = judge_refresh(\n"
            "        cfg.p, cfg.n, [1] * (cfg.n - 1) + [(-(cfg.n - 1)) % cfg.p])",
        ),
    ),
    (
        # NOT equivalent: a share one modulus up does land the ledger on the target, so
        # without this branch the transfer accepts a value no party could hold.
        #
        # The following line is part of the target on purpose. `judge_recover` carries a
        # textually identical guard earlier in the file, and `replace` takes the first
        # occurrence -- so the short pattern mutated the wrong function, where the branch
        # IS equivalent (a value outside the field is never equal to the secret either)
        # and the mutation therefore survived while looking like a real one.
        "the transfer completion accepts a share outside the field",
        replace(
            "    if not 0 <= claimed < ledger.p:\n        return verdict.say(\n"
            '            f"NOT YET: {claimed} does land on the target,',
            "    if False:\n        return verdict.say(\n"
            '            f"NOT YET: {claimed} does land on the target,',
        ),
    ),
    (
        "transfer accepts anything that parses",
        replace(
            '    verdict.say(f"second setting: {cfg.rendered()}")',
            "    verdict.passed = True\n    return verdict\n"
            '    verdict.say(f"second setting: {cfg.rendered()}")',
        ),
    ),
]


# --------------------------------------------------------------------------- the settings


def setting_failures() -> list[str]:
    """Every seed hands over ledgers the four stages can actually be answered from.

    Each clause is a way the problem stops asking what `show` says it asks, and none of
    them is a crash:

     * a `known` at or below the modulus makes the reduction in a completion rule
       optional, so `target - known` would pass on this deployment's own numbers;
     * two ledgers with the same total make `recover` and the transfer's completion the
       same reading for the wrong reason;
     * a second setting sharing the first's modulus or party count is not a transfer, it
       is the same question again;
     * a family that cannot fail an unreduced completion accepts every rule.
    """
    failures: list[str] = []
    for index in range(120):
        seed = f"setting-sweep-{index}"
        live, second = setting(seed, LIVE), setting(seed, TRANSFER)
        if live.p == second.p:
            failures.append(f"{seed}: both settings use the same modulus")
        if live.n == second.n:
            failures.append(f"{seed}: both settings use the same party count")
        for cfg in (live, second):
            a, b = ledger_a(seed, cfg.name), ledger_b(seed, cfg.name)
            if b.known() <= cfg.p:
                failures.append(f"{seed}/{cfg.name}: known is not larger than the modulus")
            if a.secret == b.secret:
                failures.append(f"{seed}/{cfg.name}: the two ledgers share a total")
            if len(b.visible()) != cfg.n - 1:
                failures.append(f"{seed}/{cfg.name}: ledger B does not hide exactly one share")
        if ledger_b(seed, LIVE).missing != live.n - 1:
            failures.append(f"{seed}: the live ledger's missing party moved")
        if ledger_b(seed, TRANSFER).missing == second.n - 1:
            failures.append(f"{seed}: the second setting hides the last party, like the first")
        family = completion_family(seed)
        if family_is_vacuous(family):
            failures.append(f"{seed}: the family cannot fail an unreduced completion")
        for name, predicate in (
            ("known = 0", lambda c: c.known == 0),
            ("known above the modulus", lambda c: c.known > c.modulus),
            ("a target below known", lambda c: c.target < c.known),
            ("more than one modulus", lambda c: True),
        ):
            if not any(predicate(case) for case in family):
                failures.append(f"{seed}: the family has no case with {name}")
        if len({case.modulus for case in family}) < 2:
            failures.append(f"{seed}: the family uses a single modulus")
    return failures


# --------------------------------------------------------------------------- the gates


def cli(seed: str, state: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603 - argument list, shell=False
        [sys.executable, str(ROOT / "shares.py"), *arguments],
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
    """The flag is released for exactly one of the sixteen progress states.

    Enumerated rather than hand-listed: with four stages a hand-written list is where the
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


def transfer_lock_failures() -> list[str]:
    """The second setting is neither shown nor accepted until the first three are cleared."""
    failures: list[str] = []
    seed = SEEDS[0]
    second = setting(seed, TRANSFER)
    ledger = ledger_a(seed, TRANSFER)
    correct = transfer_arguments(seed)
    for size in range(len(real_progress.MAIN_STAGES)):
        for stages in itertools.combinations(real_progress.MAIN_STAGES, size):
            directory, state = _with_progress(stages)
            with directory:
                if cli(seed, state, "transfer", *correct).returncode == 0:
                    failures.append(f"progress {list(stages) or 'none'}: transfer was accepted")
                shown = cli(seed, state, "show").stdout
                if str(list(ledger.shares)) in shown or second.rendered() in shown:
                    failures.append(f"progress {list(stages) or 'none'}: `show` printed the setting")
                if str(target_value(seed, TRANSFER)) in shown.split("stage 4 of 4")[-1]:
                    failures.append(f"progress {list(stages) or 'none'}: `show` printed the target")
    directory, state = _with_progress(real_progress.MAIN_STAGES)
    with directory:
        shown = cli(seed, state, "show").stdout
        if str(list(ledger.shares)) not in shown or second.rendered() not in shown:
            failures.append("the second setting is not printed once the first three are cleared")
    return failures


def end_to_end_failures() -> list[str]:
    """The commands a participant types, in order, from an empty container."""
    failures: list[str] = []
    for seed in SEEDS:
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            state.mkdir()
            if cli(seed, state).returncode != 0:
                failures.append(f"{seed}: bare `shares` does not print usage")
            show = cli(seed, state, "show")
            if show.returncode != 0:
                failures.append(f"{seed}: `shares show` failed")
            if derive_flag(seed) in show.stdout:
                failures.append(f"{seed}: `shares show` prints the flag")
            # Every stage's inputs have to be on screen, or the stage is a guessing game.
            if str(list(ledger_a(seed, LIVE).shares)) not in show.stdout:
                failures.append(f"{seed}: `shares show` does not print ledger A")
            if str(list(ledger_b(seed, LIVE).visible())) not in show.stdout:
                failures.append(f"{seed}: `shares show` does not print ledger B's visible shares")
            if f"known = {ledger_b(seed, LIVE).known()}" not in show.stdout:
                failures.append(f"{seed}: `shares show` does not print the raw sum")
            # And the total it is asking for must not be.
            if f" {ledger_b(seed, LIVE).secret}\n" in show.stdout.replace("known = ", " "):
                failures.append(f"{seed}: `shares show` prints ledger B's total")
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

    problems.extend(f"setting: {failure}" for failure in setting_failures())
    if not problems:
        print("PASS every seed hands over ledgers the four stages can be answered from")

    problems.extend(end_to_end_failures())
    if not problems:
        print("PASS the CLI takes a participant from an empty container to the flag")

    problems.extend(f"transfer lock: {failure}" for failure in transfer_lock_failures())
    if not problems:
        print("PASS the second setting is locked until the first three stages are cleared")

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
