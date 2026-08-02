"""Author / CI suite: prove the judge can fail a wrong answer, and the gate can hold.

Five parts, run by `make reference-test` inside the `author` image.

1. The fixtures hold the properties the problem's design rests on. The live case
   never makes the participant the designated party and the transfer case always
   does; the two desks are faulty in opposite directions, so the correction that
   works at one is wrong at the other; and every expression's declared locality is
   rechecked by sampling it over the field rather than by trusting the table.
2. The reference answers clear all four stages and produce the flag, end to end
   through the CLI a participant actually types.
3. A catalog of wrong answers is rejected, each for its own reason. These are the
   near misses: a row with the public constant folded in when it should not have
   been, the published total left uncorrected, the *other* desk's correction, and a
   classification that is one expression out.
4. The judge is broken on purpose, one requirement at a time, and every broken
   version has to be caught by that catalog. A stage nobody can fail is not a stage,
   and this is the only thing that tests the tests.
5. The gate: the flag is withheld for every subset of the stages except the complete
   one, and the second desk is neither printed nor gradeable until the three stages
   before it are cleared.

Two mutations are deliberately absent, because no correct catalog could kill them
and a permanent SURVIVED line trains authors to stop reading this output:

- Removing `parse_integer`'s range check. An answer outside `[0, p)` is refused
  either way -- once for not being a field element and once for not matching -- so
  dropping the check changes the message and not the verdict. The requirement is
  real (a reconstruction is a field element, and saying so is most of the lesson),
  so the public suite asserts the message instead.
- Removing `check_total`'s "that is the number the desk published" branch. Same
  shape: the published number is not the correct total, so it is rejected either
  way. The branch exists to say *why*, and the public suite asserts that too.
- Removing `parse_ids`'s "is this id on the list" check. An id nothing on the list
  carries cannot be in the answer set either, so it lands in the symmetric
  difference and the classification is rejected regardless. The check exists so the
  message says "that is not one of these" rather than "one of them is on the wrong
  side", which are very different things to read at three in the afternoon. It was
  written as a mutation first, survived every seed, and is recorded here rather than
  left in the list -- a SURVIVED line that is always correct is worse than no line.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from fixtures.generate import (
    CASES,
    LIVE,
    TEMPLATES,
    TRANSFER,
    correct_row,
    correct_total,
    designated_party,
    expressions,
    field_modulus,
    flag as derive_flag,
    local_ids,
    party_count,
    publics,
    published_total,
    your_index,
    your_rows,
)
from lab import progress as real_progress
from reference.solve import live_arguments, transfer_arguments

#: Enough seeds that the party counts, the designated parties and the classification
#: sizes vary; the coverage is asserted below rather than assumed.
SEEDS = tuple(f"mutation-seed-{index}" for index in range(12))

JUDGE_SOURCE = (ROOT / "lab" / "judge.py").read_text(encoding="utf-8")

#: How many random assignments the affineness recheck uses per expression. A
#: non-affine expression survives one sample with probability about 1/p, so twenty
#: is far past the point where a wrong declaration could slip through.
AFFINE_SAMPLES = 20


# --------------------------------------------------------------------------- fixtures


def _affine_failures(seed: str) -> list[str]:
    """Recheck every template's declared locality by arithmetic, not by reading it.

    With additive sharing, a party can compute its own row of `f` alone exactly when
    `f` is affine in the shared variables. `f` is affine iff

        f(u + v) - f(u) - f(v) + f(0) == 0

    for every pair of assignments to the shared variables, with the public values
    held fixed. A syntactic degree count would disagree with this on expressions like
    `x*y - x*y`, so the table's `local` flag is checked against the field rather than
    against the source text -- which is the only way a wrong declaration gets caught,
    since the judge and the answer both come from that same flag.
    """
    failures: list[str] = []
    p = field_modulus(seed, LIVE)
    values = publics(seed, LIVE)
    stream = [
        int.from_bytes(hashlib.sha256(f"{seed}:affine:{index}".encode()).digest()[:4], "big")
        for index in range(AFFINE_SAMPLES * 8)
    ]
    for template in TEMPLATES:
        evaluate = template["evaluate"]
        zero = {"x": 0, "y": 0, "z": 0, **values}
        non_affine = False
        for sample in range(AFFINE_SAMPLES):
            base = sample * 8
            u = {name: stream[base + i] % p for i, name in enumerate(("x", "y", "z"))}
            v = {name: stream[base + 3 + i] % p for i, name in enumerate(("x", "y", "z"))}
            total = {name: (u[name] + v[name]) % p for name in ("x", "y", "z")}
            residual = (
                evaluate({**total, **values})
                - evaluate({**u, **values})
                - evaluate({**v, **values})
                + evaluate(zero)
            ) % p
            if residual:
                non_affine = True
                break
        if bool(template["local"]) == non_affine:
            failures.append(
                f"{seed}: {template['text']!r} is declared local={template['local']} and "
                f"tests as {'non-affine' if non_affine else 'affine'}"
            )
    return failures


def fixture_failures() -> list[str]:
    """The properties the stages are built on, checked on every seed."""
    failures: list[str] = []
    for seed in SEEDS:
        if field_modulus(seed, LIVE) == field_modulus(seed, TRANSFER):
            failures.append(f"{seed}: both desks use the same field")

        for case in CASES:
            n = party_count(seed, case)
            j, t = your_index(seed, case), designated_party(seed, case)
            values = publics(seed, case)
            if not 0 <= j < n:
                failures.append(f"{seed}/{case}: the participant is not one of the parties")
            if values["k"] in (0, 1):
                failures.append(f"{seed}/{case}: k = {values['k']} makes the scale unobservable")
            if values["c"] == 0:
                failures.append(f"{seed}/{case}: c = 0 makes every way of folding it agree")
            if published_total(seed, case) == correct_total(seed, case):
                failures.append(f"{seed}/{case}: the faulty run published the correct total")
            listed = expressions(seed, case)
            if len({str(row["id"]) for row in listed}) != len(listed):
                failures.append(f"{seed}/{case}: two expressions share an id")
            if len({str(row["text"]) for row in listed}) != len(listed):
                failures.append(f"{seed}/{case}: an expression is listed twice")
            if not 1 <= len(local_ids(seed, case)) < len(listed):
                failures.append(f"{seed}/{case}: the classification is all of one kind")
            del t

        # The two properties that make the transfer stage a transfer.
        if your_index(seed, LIVE) == designated_party(seed, LIVE):
            failures.append(f"{seed}: the live participant is the designated party")
        if your_index(seed, TRANSFER) != designated_party(seed, TRANSFER):
            failures.append(f"{seed}: the transfer participant is not the designated party")

        # ... and the property that makes memorising the first correction useless: the
        # live desk folded the constant in too many times, the transfer desk not at
        # all, so the same arithmetic applied at the second desk is wrong.
        p = field_modulus(seed, TRANSFER)
        n = party_count(seed, TRANSFER)
        c = publics(seed, TRANSFER)["c"]
        if (published_total(seed, TRANSFER) - (n - 1) * c) % p == correct_total(seed, TRANSFER):
            failures.append(f"{seed}: the live correction also answers the transfer desk")

        # The live row carries no constant and the transfer row does, so neither one is
        # answerable by doing what worked at the other desk.
        for case in CASES:
            p = field_modulus(seed, case)
            mine = your_rows(seed, case)
            values = publics(seed, case)
            bare = (values["k"] * (mine["x"] + mine["y"])) % p
            other = (bare + values["c"]) % p if case == LIVE else bare
            if other == correct_row(seed, case):
                failures.append(
                    f"{seed}/{case}: the wrong way of folding the constant gives the right row"
                )

        failures.extend(_affine_failures(seed))
    return failures


# --------------------------------------------------------------------------- wrong answers


def wrong_rows(seed: str, case: str) -> list[tuple[str, list[str]]]:
    """Rows that must be rejected, with the reason each one is a near miss.

    Entries that happen to coincide with the correct answer for a given seed are
    dropped rather than asserted away: a catalog entry that is only a near miss on
    some seeds would otherwise report as an accepted wrong answer. Every mutation is
    still killed, because a mutant only has to be caught on one of the twelve seeds.
    """
    p = field_modulus(seed, case)
    correct = correct_row(seed, case)
    values = publics(seed, case)
    mine = your_rows(seed, case)
    bare = (values["k"] * (mine["x"] + mine["y"])) % p
    other_case = LIVE if case == TRANSFER else TRANSFER

    candidates = [
        (
            "the public constant folded in by a party that does not fold it in",
            (correct + values["c"]) % p,
        ),
        ("the constant left out where it belongs", bare),
        ("the constant added after the scale instead of inside it", (bare + values["c"]) % p),
        ("one out", (correct + 1) % p),
        ("the row of the other desk", correct_row(seed, other_case) % p),
        ("the number the desk published", published_total(seed, case)),
        ("nothing computed at all", 0),
    ]
    return [
        *[(label, [str(value % p)]) for label, value in candidates if value % p != correct],
        ("a value that is not an element of the field", [str(p)]),
        ("a row written as its negative representative", [str(correct - p)]),
        ("two numbers where one is asked for", [f"{correct},{correct}"]),
        ("not a number at all", ["x"]),
        ("nothing at all", []),
    ]


def wrong_totals(seed: str, case: str) -> list[tuple[str, list[str]]]:
    """Totals that must be rejected, with the reason each one is a near miss."""
    p = field_modulus(seed, case)
    n = party_count(seed, case)
    values = publics(seed, case)
    correct = correct_total(seed, case)
    published = published_total(seed, case)
    other_case = LIVE if case == TRANSFER else TRANSFER

    candidates = [
        ("the number the desk published, uncorrected", published),
        ("the other desk's correction", (published - (n - 1) * values["c"]) % p),
        (
            "the other desk's correction, applied the other way",
            (published + values["k"] * values["c"]) % p,
        ),
        ("one fold of the constant out", (correct + values["c"]) % p),
        ("n folds taken off instead of n-1", (published - n * values["c"]) % p),
        ("one out", (correct + 1) % p),
        ("the total of the other desk", correct_total(seed, other_case) % p),
    ]
    return [
        *[(label, [str(value % p)]) for label, value in candidates if value % p != correct],
        ("a value that is not an element of the field", [str(p)]),
        ("not a number at all", ["total"]),
        ("nothing at all", []),
    ]


def wrong_classifications(seed: str, case: str) -> list[tuple[str, list[str]]]:
    """Classifications that must be rejected, with the reason each one is wrong."""
    listed = [str(row["id"]) for row in expressions(seed, case)]
    answer = local_ids(seed, case)
    others = [identifier for identifier in listed if identifier not in answer]
    other_case = LIVE if case == TRANSFER else TRANSFER
    other_ids = [str(row["id"]) for row in expressions(seed, other_case)]

    return [
        ("everything, which claims multiplying two sharings is free", [",".join(listed)]),
        ("the complement, which claims adding two sharings needs a round", [",".join(others)]),
        ("one of the local ones left out", [",".join(answer[1:])]),
        ("one that needs a round included", [",".join([*answer, others[0]])]),
        ("a single expression where several qualify", [answer[0]]),
        ("ids from the other desk's list", [",".join(other_ids[:2])]),
        ("an id nothing on the list carries", ["e99"]),
        ("the right set with one id repeated", [",".join([*answer, answer[0]])]),
        ("nothing at all", []),
    ]


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


def _transfer_words(row: str, total: str, silent: str) -> list[str]:
    return [f"row={row}", f"total={total}", f"silent={silent}"]


def wrong_transfers(seed: str) -> list[tuple[str, list[str]]]:
    """Transfer answers that must be rejected, including the three near-complete ones.

    The transfer stage takes all three readings at once, so a judge that grades only
    some of them is caught here rather than by the single-stage catalogs.
    """
    p = field_modulus(seed, TRANSFER)
    reference = transfer_arguments(seed)
    correct = {word.split("=", 1)[0]: word.split("=", 1)[1] for word in reference}
    live = live_arguments(seed)
    everything = ",".join(str(row["id"]) for row in expressions(seed, TRANSFER))
    return [
        (
            "a wrong row with the other two right",
            _transfer_words(
                str((int(correct["row"]) + 1) % p), correct["total"], correct["silent"]
            ),
        ),
        (
            "a wrong total with the other two right",
            _transfer_words(
                correct["row"], str((int(correct["total"]) + 1) % p), correct["silent"]
            ),
        ),
        (
            "a wrong classification with the other two right",
            _transfer_words(correct["row"], correct["total"], everything),
        ),
        ("the live desk's readings", [*live["row"], *live["total"], *live["silent"]]),
        ("two of the three names", reference[:2]),
        ("the three values without their names", [correct["row"], correct["total"]]),
        ("nothing at all", []),
    ]


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
            for case in CASES:
                if not judge.check_row(seed, case, [str(correct_row(seed, case))]).passed:
                    escaped.append(f"{seed}: rejects the reference row for {case}")
                if not judge.check_total(seed, case, [str(correct_total(seed, case))]).passed:
                    escaped.append(f"{seed}: rejects the reference total for {case}")
                if not judge.check_silent(seed, case, [",".join(local_ids(seed, case))]).passed:
                    escaped.append(f"{seed}: rejects the reference classification for {case}")
            if not judge.check_transfer(seed, transfer_arguments(seed)).passed:
                escaped.append(f"{seed}: rejects the reference transfer answer")
            if escaped and stop_early:
                break

            for case in CASES:
                for label, arguments in wrong_rows(seed, case):
                    if judge.check_row(seed, case, arguments).passed:
                        escaped.append(f"accepts a wrong row ({case}) -- {label}")
                        if stop_early:
                            break
                for label, arguments in wrong_totals(seed, case):
                    if judge.check_total(seed, case, arguments).passed:
                        escaped.append(f"accepts a wrong total ({case}) -- {label}")
                        if stop_early:
                            break
                for label, arguments in wrong_classifications(seed, case):
                    if judge.check_silent(seed, case, arguments).passed:
                        escaped.append(f"accepts a wrong classification ({case}) -- {label}")
                        if stop_early:
                            break
            if escaped and stop_early:
                break

            for label, arguments in wrong_transfers(seed):
                if judge.check_transfer(seed, arguments).passed:
                    escaped.append(f"accepts a wrong transfer answer -- {label}")
                    if stop_early:
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


MUTATIONS: list[tuple[str, str]] = [
    (
        "row stops comparing the submission against the row",
        replace("    if claimed != correct_row(seed, case):", "    if False:"),
    ),
    (
        "row grades against the other desk",
        replace("correct_row(seed, case)", "correct_row(seed, TRANSFER)"),
    ),
    (
        "row accepts anything that parses",
        replace(
            "    if claimed != correct_row(seed, case):",
            "    verdict.passed = True\n    return verdict\n"
            "    if claimed != correct_row(seed, case):",
        ),
    ),
    (
        "total stops comparing the submission against the total",
        replace("    if claimed != correct_total(seed, case):", "    if False:"),
    ),
    (
        "total grades against the number the desk published",
        replace(
            "    if claimed != correct_total(seed, case):",
            "    if claimed != published_total(seed, case):",
        ),
    ),
    (
        "total accepts anything that parses",
        replace(
            "    if claimed == published_total(seed, case):",
            "    verdict.passed = True\n    return verdict\n"
            "    if claimed == published_total(seed, case):",
        ),
    ),
    (
        "silent stops comparing the classification",
        replace("    wrong = len(claimed ^ answer)", "    wrong = 0"),
    ),
    (
        "silent stops noticing an expression that needs a round",
        replace("    wrong = len(claimed ^ answer)", "    wrong = len(answer - claimed)"),
    ),
    (
        "silent stops noticing a local expression left out",
        replace("    wrong = len(claimed ^ answer)", "    wrong = len(claimed - answer)"),
    ),
    (
        "silent stops refusing a list that names one expression twice",
        replace("        if identifier in seen:", "        if False:"),
    ),
    (
        "transfer stops requiring all three readings",
        replace(
            "        if inner.passed:\n            continue",
            "        if True:\n            continue",
        ),
    ),
    (
        "transfer grades the live desk instead of the second one",
        replace(
            '("row", check_row(seed, TRANSFER, [claimed["row"]]))',
            '("row", check_row(seed, "live", [claimed["row"]]))',
        ),
    ),
]


# --------------------------------------------------------------------------- the gate


def cli(seed: str, state: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603 - argument list, shell=False
        [sys.executable, str(ROOT / "shares.py"), *arguments],
        capture_output=True,
        text=True,
        timeout=120,
        cwd="/",
        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "FLAG_SEED": seed, "LAB_STATE_DIR": str(state)},
        check=False,
    )


def _state(directory: str, cleared: list[str]) -> Path:
    state = Path(directory) / "state"
    state.mkdir()
    (state / "progress.json").write_text(
        json.dumps({stage: True for stage in cleared}), encoding="utf-8"
    )
    return state


def gate_failures() -> list[str]:
    """The flag is released for exactly one progress state, and transfer is earned."""
    failures: list[str] = []
    seed = SEEDS[0]
    expected = derive_flag(seed)
    stages = real_progress.STAGES
    subsets = [
        [stage for index, stage in enumerate(stages) if mask >> index & 1]
        for mask in range(1 << len(stages))
    ]
    transfer_id = str(expressions(seed, TRANSFER)[0]["id"])
    for cleared in subsets:
        with tempfile.TemporaryDirectory() as directory:
            state = _state(directory, cleared)
            released = expected in cli(seed, state, "flag").stdout
            should_release = set(cleared) == set(stages)
            if released != should_release:
                failures.append(
                    f"progress {cleared or 'none'}: flag "
                    + ("released" if released else "withheld")
                )

            # The second desk is handed over only once the three stages before it are
            # cleared -- not printed, and not gradeable.
            unlocked = set(real_progress.TRANSFER_REQUIRES) <= set(cleared)
            shown = transfer_id in cli(seed, state, "show").stdout
            graded = cli(seed, state, "transfer", *transfer_arguments(seed)).returncode == 0
            for what, actual in (("show", shown), ("grade", graded)):
                if actual != unlocked:
                    failures.append(
                        f"progress {cleared or 'none'}: second desk {what} "
                        + ("available" if actual else "refused")
                    )
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
            # Individual answers are single field elements and `show` legitimately
            # prints a page of those, so "does this number appear" is noise. What must
            # not appear is the second desk, and its expression ids carry a distinct
            # prefix precisely so that can be asserted.
            if any(str(row["id"]) in show.stdout for row in expressions(seed, TRANSFER)):
                failures.append(f"{seed}: `shares show` prints the second desk")

            live = live_arguments(seed)
            if cli(seed, state, "transfer", *transfer_arguments(seed)).returncode == 0:
                failures.append(f"{seed}: the second desk was gradeable before it was earned")
            for stage in ("row", "total", "silent"):
                if cli(seed, state, stage, *live[stage]).returncode != 0:
                    failures.append(f"{seed}: the reference answer did not clear `{stage}`")
            if derive_flag(seed) in cli(seed, state, "flag").stdout:
                failures.append(f"{seed}: the flag was released before the transfer stage")
            if cli(seed, state, "transfer", *transfer_arguments(seed)).returncode != 0:
                failures.append(f"{seed}: the reference answer did not clear `transfer`")
            if derive_flag(seed) not in cli(seed, state, "flag").stdout:
                failures.append(f"{seed}: the flag was not released after all four stages")
    return failures


# --------------------------------------------------------------------------- main


def main() -> int:
    problems: list[str] = []

    counts = {(party_count(seed, LIVE), party_count(seed, TRANSFER)) for seed in SEEDS}
    sizes = {len(local_ids(seed, LIVE)) for seed in SEEDS}
    if len(counts) < 4 or len(sizes) < 2:
        print(
            f"FAIL the seed set is too narrow: {len(counts)} party-count pairs, "
            f"{len(sizes)} classification sizes"
        )
        return 1
    print(
        f"PASS the seed set spans {len(counts)} party-count pairs and "
        f"{len(sizes)} classification sizes"
    )

    for failure in fixture_failures():
        problems.append(f"fixtures: {failure}")
    if not problems:
        print(
            f"PASS the fixtures hold on {len(SEEDS)} seeds: the live participant is never "
            "the designated party and the transfer one always is, the two desks are faulty "
            "in opposite directions, and every declared locality survives an affineness "
            "test over the field"
        )

    escaped = survivors_of(load_judge(JUDGE_SOURCE), stop_early=False)
    if escaped:
        print("FAIL the unmutated judge does not grade correctly:")
        for line in escaped:
            print(f"  - {line}")
        return 1
    print(
        f"PASS the reference answers pass and {2 * len(wrong_rows(SEEDS[0], LIVE))} wrong rows, "
        f"{2 * len(wrong_totals(SEEDS[0], LIVE))} wrong totals, "
        f"{2 * len(wrong_classifications(SEEDS[0], LIVE))} wrong classifications and "
        f"{len(wrong_transfers(SEEDS[0]))} wrong transfer answers are rejected, on "
        f"{len(SEEDS)} seeds"
    )

    for failure in end_to_end_failures():
        problems.append(failure)
    if not problems:
        print("PASS the CLI takes a participant from an empty container to the flag")

    for failure in gate_failures():
        problems.append(f"gate: {failure}")
    if not problems:
        print("PASS the flag and the second desk are released for the right states and no other")

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
