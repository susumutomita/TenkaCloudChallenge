"""Author / CI suite: prove the judge can fail a wrong answer, and the gate can hold.

Five parts, run by `make reference-test` inside the `author` image.

1. The fixtures hold the properties the problem's design rests on. Beaver's identity
   actually holds for the rows the participant is given; the two openings are
   non-zero and unequal; the live case never makes the participant the designated
   party and the transfer case always does; and the two runs are faulty in opposite
   directions, so the correction that works on one is wrong on the other.
2. The reference answers clear all four stages and produce the flag, end to end
   through the CLI a participant actually types.
3. A catalog of wrong answers is rejected, each for its own reason. These are the
   near misses: the two openings transposed, a row with the public scalar folded in
   when it should not have been, the published number left uncorrected, and the
   other run's correction.
4. The judge is broken on purpose, one requirement at a time, and every broken
   version has to be caught by that catalog. A stage nobody can fail is not a stage,
   and this is the only thing that tests the tests.
5. The gate: the flag is withheld for every subset of the stages except the complete
   one, and the second multiplication is neither printed nor gradeable until the
   three stages before it are cleared.

Two mutations are deliberately absent, because no correct catalog could kill them
and a permanent SURVIVED line trains authors to stop reading this output:

- Removing `_element`'s range check. An answer outside `[0, p)` is refused either
  way -- once for not being a field element and once for not matching -- so dropping
  the check changes the message and not the verdict. The requirement is real (an
  opening is a field element, and saying so is most of the lesson), so the public
  suite asserts the message instead.
- Removing `check_product`'s "that is the number the desk published" branch. Same
  shape: the published number is not the product, so it is rejected either way. The
  branch exists to say *why*, and the public suite asserts that too.
"""

from __future__ import annotations

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
    TRANSFER,
    broadcast,
    correct_row,
    designated_party,
    field_modulus,
    flag as derive_flag,
    opened,
    party_count,
    product,
    published_total,
    rows,
    secrets,
    your_index,
    your_rows,
)
from lab import progress as real_progress
from reference.solve import live_arguments, transfer_arguments

#: Enough seeds that the party counts and the designated parties vary; the coverage
#: is asserted below rather than assumed.
SEEDS = tuple(f"mutation-seed-{index}" for index in range(12))

JUDGE_SOURCE = (ROOT / "lab" / "judge.py").read_text(encoding="utf-8")


# --------------------------------------------------------------------------- fixtures


def fixture_failures() -> list[str]:
    """The properties the stages are built on, checked on every seed."""
    failures: list[str] = []
    for seed in SEEDS:
        if field_modulus(seed, LIVE) == field_modulus(seed, TRANSFER):
            failures.append(f"{seed}: both runs use the same field")

        for case in CASES:
            p = field_modulus(seed, case)
            n = party_count(seed, case)
            j, t = your_index(seed, case), designated_party(seed, case)
            values = secrets(seed, case)
            public = opened(seed, case)

            if not 0 <= j < n:
                failures.append(f"{seed}/{case}: the participant is not one of the parties")
            if values["c"] != (values["a"] * values["b"]) % p:
                failures.append(f"{seed}/{case}: the triple does not satisfy c = a*b")
            if public["d"] == 0 or public["e"] == 0:
                failures.append(f"{seed}/{case}: an opening is zero, so d*e vanishes")
            if public["d"] == public["e"]:
                failures.append(f"{seed}/{case}: the two openings are equal, so a swap passes")
            if published_total(seed, case) == product(seed, case):
                failures.append(f"{seed}/{case}: the faulty run published the right product")

            # Every row the participant is given has to be a row of the value it claims
            # to be, and Beaver's identity has to hold for the whole table -- otherwise
            # the `row` stage asks for a number that is not part of anything.
            for name in ("x", "y", "a", "b", "c"):
                if sum(rows(seed, case, name)) % p != values[name]:
                    failures.append(f"{seed}/{case}: the rows of {name} do not sum to it")
            broadcast_rows = broadcast(seed, case)
            if sum(row["d"] for row in broadcast_rows) % p != public["d"]:
                failures.append(f"{seed}/{case}: the broadcast d rows do not open to d")
            if sum(row["e"] for row in broadcast_rows) % p != public["e"]:
                failures.append(f"{seed}/{case}: the broadcast e rows do not open to e")
            assembled = [
                (
                    rows(seed, case, "c")[i]
                    + public["d"] * rows(seed, case, "b")[i]
                    + public["e"] * rows(seed, case, "a")[i]
                    + (public["d"] * public["e"] if i == t else 0)
                )
                % p
                for i in range(n)
            ]
            if sum(assembled) % p != product(seed, case):
                failures.append(f"{seed}/{case}: the assembled rows do not sum to x*y")
            if assembled[j] != correct_row(seed, case):
                failures.append(f"{seed}/{case}: the graded row is not the participant's")

        # The two properties that make the transfer stage a transfer.
        if your_index(seed, LIVE) == designated_party(seed, LIVE):
            failures.append(f"{seed}: the live participant is the designated party")
        if your_index(seed, TRANSFER) != designated_party(seed, TRANSFER):
            failures.append(f"{seed}: the transfer participant is not the designated party")

        # ... and the property that makes memorising the first correction useless: the
        # live run folded the scalar in too many times, the transfer run not at all, so
        # the same arithmetic applied to the second one is wrong.
        p = field_modulus(seed, TRANSFER)
        n = party_count(seed, TRANSFER)
        public = opened(seed, TRANSFER)
        scalar = (public["d"] * public["e"]) % p
        if (published_total(seed, TRANSFER) - (n - 1) * scalar) % p == product(seed, TRANSFER):
            failures.append(f"{seed}: the live correction also answers the transfer run")

        # The live row carries no public scalar and the transfer row does, so neither
        # is answerable by doing what worked on the other.
        for case in CASES:
            p = field_modulus(seed, case)
            public = opened(seed, case)
            scalar = (public["d"] * public["e"]) % p
            mine = your_rows(seed, case)
            bare = (mine["c"] + public["d"] * mine["b"] + public["e"] * mine["a"]) % p
            other = (bare + scalar) % p if case == LIVE else bare
            if other == correct_row(seed, case):
                failures.append(
                    f"{seed}/{case}: the wrong way of folding the scalar gives the right row"
                )
    return failures


# --------------------------------------------------------------------------- wrong answers


def wrong_openings(seed: str, case: str) -> list[tuple[str, list[str]]]:
    """Openings that must be rejected, with the reason each one is a near miss."""
    p = field_modulus(seed, case)
    public = opened(seed, case)
    d, e = public["d"], public["e"]
    mine = your_rows(seed, case)
    other_case = LIVE if case == TRANSFER else TRANSFER
    other = opened(seed, other_case)
    # The participant's own broadcast rows, which are the local half of the opening.
    j = your_index(seed, case)
    own = broadcast(seed, case)[j]

    candidates = [
        ("the two openings transposed", (e, d)),
        ("only the broadcasts that were printed, without their own row", ((d - own["d"]) % p, (e - own["e"]) % p)),
        ("their own two rows instead of the opened values", (own["d"], own["e"])),
        ("the masks the wrong way round: a - x rather than x - a", ((-d) % p, (-e) % p)),
        ("their own rows of X and Y", (mine["x"], mine["y"])),
        ("one out", ((d + 1) % p, e)),
        ("the other run's openings", (other["d"] % p, other["e"] % p)),
    ]
    return [
        *[
            (label, [f"{first % p},{second % p}"])
            for label, (first, second) in candidates
            if (first % p, second % p) != (d, e)
        ],
        ("a value that is not an element of the field", [f"{p},{e}"]),
        ("an opening written as its negative representative", [f"{d - p},{e}"]),
        ("one number where two are asked for", [str(d)]),
        ("three numbers where two are asked for", [f"{d},{e},{d}"]),
        ("not a number at all", ["d,e"]),
        ("nothing at all", []),
    ]


def wrong_rows(seed: str, case: str) -> list[tuple[str, list[str]]]:
    """Rows that must be rejected, with the reason each one is a near miss.

    Entries that happen to coincide with the correct answer for a given seed are
    dropped rather than asserted away: a catalog entry that is only a near miss on
    some seeds would otherwise report as an accepted wrong answer. Every mutation is
    still killed, because a mutant only has to be caught on one of the twelve seeds.
    """
    p = field_modulus(seed, case)
    correct = correct_row(seed, case)
    public = opened(seed, case)
    scalar = (public["d"] * public["e"]) % p
    mine = your_rows(seed, case)
    bare = (mine["c"] + public["d"] * mine["b"] + public["e"] * mine["a"]) % p
    other_case = LIVE if case == TRANSFER else TRANSFER

    candidates = [
        ("the public scalar folded in by a party that does not fold it in", (correct + scalar) % p),
        ("the public scalar left out where it belongs", bare),
        ("d and e swapped in the linear part", (mine["c"] + public["e"] * mine["b"] + public["d"] * mine["a"]) % p),
        ("the c row left out", (correct - mine["c"]) % p),
        ("one out", (correct + 1) % p),
        ("the row of the other run", correct_row(seed, other_case) % p),
        ("the number the desk published", published_total(seed, case)),
        ("the product itself, which is not one party's row", product(seed, case)),
    ]
    return [
        *[(label, [str(value % p)]) for label, value in candidates if value % p != correct],
        ("a value that is not an element of the field", [str(p)]),
        ("a row written as its negative representative", [str(correct - p)]),
        ("two numbers where one is asked for", [f"{correct},{correct}"]),
        ("not a number at all", ["row"]),
        ("nothing at all", []),
    ]


def wrong_products(seed: str, case: str) -> list[tuple[str, list[str]]]:
    """Products that must be rejected, with the reason each one is a near miss."""
    p = field_modulus(seed, case)
    n = party_count(seed, case)
    correct = product(seed, case)
    published = published_total(seed, case)
    public = opened(seed, case)
    scalar = (public["d"] * public["e"]) % p
    other_case = LIVE if case == TRANSFER else TRANSFER

    candidates = [
        ("the number the desk published, uncorrected", published),
        ("the other run's correction", (published - (n - 1) * scalar) % p),
        ("the other run's correction, applied the other way", (published + scalar) % p),
        ("n folds taken off instead of n-1", (published - n * scalar) % p),
        ("the scalar corrected in the wrong direction", (correct + 2 * scalar) % p),
        ("one out", (correct + 1) % p),
        ("the product of the other run", product(seed, other_case) % p),
    ]
    return [
        *[(label, [str(value % p)]) for label, value in candidates if value % p != correct],
        ("a value that is not an element of the field", [str(p)]),
        ("not a number at all", ["product"]),
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


def _transfer_words(opening: str, row: str, value: str) -> list[str]:
    return [f"open={opening}", f"row={row}", f"product={value}"]


def wrong_transfers(seed: str) -> list[tuple[str, list[str]]]:
    """Transfer answers that must be rejected, including the three near-complete ones.

    The transfer stage takes all three readings at once, so a judge that grades only
    some of them is caught here rather than by the single-stage catalogs.
    """
    p = field_modulus(seed, TRANSFER)
    reference = transfer_arguments(seed)
    correct = {word.split("=", 1)[0]: word.split("=", 1)[1] for word in reference}
    live = live_arguments(seed)
    public = opened(seed, TRANSFER)
    return [
        (
            "a wrong opening with the other two right",
            _transfer_words(
                f"{public['e']},{public['d']}", correct["row"], correct["product"]
            ),
        ),
        (
            "a wrong row with the other two right",
            _transfer_words(
                correct["open"], str((int(correct["row"]) + 1) % p), correct["product"]
            ),
        ),
        (
            "a wrong product with the other two right",
            _transfer_words(
                correct["open"], correct["row"], str((int(correct["product"]) + 1) % p)
            ),
        ),
        ("the live run's readings", [*live["open"], *live["row"], *live["product"]]),
        ("two of the three names", reference[:2]),
        ("the values without their names", [correct["row"], correct["product"]]),
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
                public = opened(seed, case)
                opening = [f"{public['d']},{public['e']}"]
                if not judge.check_open(seed, case, opening).passed:
                    escaped.append(f"{seed}: rejects the reference opening for {case}")
                if not judge.check_row(seed, case, [str(correct_row(seed, case))]).passed:
                    escaped.append(f"{seed}: rejects the reference row for {case}")
                if not judge.check_product(seed, case, [str(product(seed, case))]).passed:
                    escaped.append(f"{seed}: rejects the reference product for {case}")
            if not judge.check_transfer(seed, transfer_arguments(seed)).passed:
                escaped.append(f"{seed}: rejects the reference transfer answer")
            if escaped and stop_early:
                break

            for case in CASES:
                for label, arguments in wrong_openings(seed, case):
                    if judge.check_open(seed, case, arguments).passed:
                        escaped.append(f"accepts a wrong opening ({case}) -- {label}")
                        if stop_early:
                            break
                for label, arguments in wrong_rows(seed, case):
                    if judge.check_row(seed, case, arguments).passed:
                        escaped.append(f"accepts a wrong row ({case}) -- {label}")
                        if stop_early:
                            break
                for label, arguments in wrong_products(seed, case):
                    if judge.check_product(seed, case, arguments).passed:
                        escaped.append(f"accepts a wrong product ({case}) -- {label}")
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
        "open stops comparing the submission against the openings",
        replace(
            "    wrong = sum(\n"
            '        1 for got, want in zip(claimed, (answer["d"], answer["e"])) if got != want\n'
            "    )",
            "    wrong = 0",
        ),
    ),
    (
        "open stops caring which of the two is which",
        replace(
            "    wrong = sum(\n"
            '        1 for got, want in zip(claimed, (answer["d"], answer["e"])) if got != want\n'
            "    )",
            '    wrong = 0 if sorted(claimed) == sorted([answer["d"], answer["e"]]) else 2',
        ),
    ),
    (
        "open grades against the other run",
        replace("    answer = opened(seed, case)", "    answer = opened(seed, TRANSFER)"),
    ),
    (
        "open stops requiring both values",
        replace(
            '        claimed = parse_integers(arguments, "an opening", 2, p)',
            '        claimed = parse_integers(arguments, "an opening", 2, p) if False else '
            "[opened(seed, case)['d'], opened(seed, case)['e']]",
        ),
    ),
    (
        "row stops comparing the submission against the row",
        replace("    if claimed != correct_row(seed, case):", "    if False:"),
    ),
    (
        "row grades against the other run",
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
        "product stops comparing the submission against the product",
        replace("    if claimed != product(seed, case):", "    if False:"),
    ),
    (
        "product grades against the number the desk published",
        replace(
            "    if claimed != product(seed, case):",
            "    if claimed != published_total(seed, case):",
        ),
    ),
    (
        "product accepts anything that parses",
        replace(
            "    if claimed == published_total(seed, case):",
            "    verdict.passed = True\n    return verdict\n"
            "    if claimed == published_total(seed, case):",
        ),
    ),
    (
        "transfer stops requiring all three readings",
        replace(
            "        if inner.passed:\n            continue",
            "        if True:\n            continue",
        ),
    ),
    (
        "transfer grades the live run instead of the second one",
        replace(
            '("row", check_row(seed, TRANSFER, [claimed["row"]]))',
            '("row", check_row(seed, "live", [claimed["row"]]))',
        ),
    ),
]


# --------------------------------------------------------------------------- the gate


def cli(seed: str, state: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603 - argument list, shell=False
        [sys.executable, str(ROOT / "beaver.py"), *arguments],
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
    # The transfer run's own published number, which `show` must not print before the
    # run is earned. Anchored on its label rather than matched as a bare number: `show`
    # prints a page of four-digit values, and an unanchored substring check would go red
    # for reasons that have nothing to do with the lock.
    hidden = f"published product = {published_total(seed, TRANSFER)}"
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

            unlocked = set(real_progress.TRANSFER_REQUIRES) <= set(cleared)
            shown = "the second multiplication ==" in cli(seed, state, "show").stdout
            graded = cli(seed, state, "transfer", *transfer_arguments(seed)).returncode == 0
            for what, actual in (("show", shown), ("grade", graded)):
                if actual != unlocked:
                    failures.append(
                        f"progress {cleared or 'none'}: second multiplication {what} "
                        + ("available" if actual else "refused")
                    )
            if not unlocked and hidden in cli(seed, state, "show").stdout:
                failures.append(
                    f"progress {cleared or 'none'}: `show` prints the locked run's total"
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
                failures.append(f"{seed}: bare `beaver` does not print usage")
            show = cli(seed, state, "show")
            if show.returncode != 0:
                failures.append(f"{seed}: `beaver show` failed")
            if derive_flag(seed) in show.stdout:
                failures.append(f"{seed}: `beaver show` prints the flag")
            if "the second multiplication ==" in show.stdout:
                failures.append(f"{seed}: `beaver show` prints the second multiplication")
            # The participant's own broadcast row is the local step, so it is the one
            # thing about the opening that `show` must not print.
            own = broadcast(seed, LIVE)[your_index(seed, LIVE)]
            if f"d row = {own['d']}    e row = {own['e']}" in show.stdout:
                failures.append(f"{seed}: `beaver show` broadcasts the participant's own rows")

            live = live_arguments(seed)
            if cli(seed, state, "transfer", *transfer_arguments(seed)).returncode == 0:
                failures.append(f"{seed}: the second run was gradeable before it was earned")
            for stage in ("open", "row", "product"):
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
    designated = {designated_party(seed, LIVE) for seed in SEEDS}
    if len(counts) < 4 or len(designated) < 3:
        print(
            f"FAIL the seed set is too narrow: {len(counts)} party-count pairs, "
            f"{len(designated)} designated parties"
        )
        return 1
    print(
        f"PASS the seed set spans {len(counts)} party-count pairs and "
        f"{len(designated)} designated parties"
    )

    for failure in fixture_failures():
        problems.append(f"fixtures: {failure}")
    if not problems:
        print(
            f"PASS the fixtures hold on {len(SEEDS)} seeds: Beaver's identity reconstructs "
            "to x*y from the rows the participant is given, neither opening is zero and "
            "the two are never equal, the live participant is never the designated party "
            "and the transfer one always is, and the two runs are faulty in opposite "
            "directions"
        )

    escaped = survivors_of(load_judge(JUDGE_SOURCE), stop_early=False)
    if escaped:
        print("FAIL the unmutated judge does not grade correctly:")
        for line in escaped:
            print(f"  - {line}")
        return 1
    print(
        f"PASS the reference answers pass and {2 * len(wrong_openings(SEEDS[0], LIVE))} wrong "
        f"openings, {2 * len(wrong_rows(SEEDS[0], LIVE))} wrong rows, "
        f"{2 * len(wrong_products(SEEDS[0], LIVE))} wrong products and "
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
        print(
            "PASS the flag and the second multiplication are released for the right "
            "states and no other"
        )

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
