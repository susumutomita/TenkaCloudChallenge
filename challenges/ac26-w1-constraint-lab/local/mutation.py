"""Author / CI suite: prove the judge can fail a wrong answer, and the gate can hold.

Five parts, run by `make reference-test` inside the `author` image.

1. The fixtures hold the properties the problem's design rests on: the honest
   witness satisfies every constraint, the refused witness breaks at least two of
   them and never the first one in the list, and the transfer case's refused
   witness always leaves the `member` or the `boolean` residual non-zero. That last
   one is what makes the transfer stage a transfer rather than a second helping of
   the first: without it a participant could answer it by copying zeros.
2. The reference answers clear all three stages and produce the flag, end to end
   through the CLI a participant actually types, on seeds covering every break
   shape in both cases.
3. A catalog of wrong answers is rejected, each for its own reason. These are the
   near misses: a trace of all zeros, a trace whose entries are right but rotated,
   a gadget that pins only the first licensed value, a gadget with one root too
   many.
4. The judge is broken on purpose, one requirement at a time, and every broken
   version has to be caught by that catalog. A stage nobody can fail is not a
   stage, and this is the only thing that tests the tests.
5. The gate: the flag is withheld for every subset of the stages except the
   complete one, and the transfer circuit is neither printed nor gradeable until
   the two stages before it are cleared.
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

from fixtures.evaluator import trace as evaluate_trace
from fixtures.generate import (
    BREAKS,
    CASES,
    LIVE,
    TRANSFER,
    allowed_set,
    break_signal,
    circuit,
    failing_witness,
    field_modulus,
    flag as derive_flag,
    honest_witness,
)
from lab import progress as real_progress
from lab.judge import MEMBERSHIP_SIGNAL, check_admit, check_trace
from reference.solve import admit_arguments, admit_expression, trace_arguments

#: Enough seeds that every break shape occurs in both cases; asserted below rather
#: than assumed.
SEEDS = tuple(f"mutation-seed-{index}" for index in range(12))

JUDGE_SOURCE = (ROOT / "lab" / "judge.py").read_text(encoding="utf-8")


# --------------------------------------------------------------------------- fixtures


def fixture_failures() -> list[str]:
    """The properties the stages are built on, checked on every seed."""
    failures: list[str] = []
    for seed in SEEDS:
        if field_modulus(seed, LIVE) == field_modulus(seed, TRANSFER):
            failures.append(f"{seed}: both cases use the same field")
        for case in CASES:
            p = field_modulus(seed, case)
            circ = circuit(seed, case)
            if any(evaluate_trace(circ, honest_witness(seed, case), p)):
                failures.append(f"{seed}/{case}: the honest witness has a non-zero residual")
            residuals = evaluate_trace(circ, failing_witness(seed, case), p)
            broken = [c for c, r in zip(circ, residuals) if r != 0]
            if len(broken) < 2:
                # One non-zero entry among four visible zeros is a guess, not a trace.
                failures.append(f"{seed}/{case}: the refused witness breaks fewer than 2 constraints")
            # Only the live case. There the break is placed away from the head of the
            # list so that a trace of "non-zero, then zeros" is never the shape of the
            # answer. The transfer case deliberately breaks at `d0`, which is the
            # membership constraint: the product a participant has to work out by hand
            # is the first entry of the trace rather than one buried in the middle.
            if case == LIVE and broken and broken[0]["id"] == circ[0]["id"]:
                failures.append(f"{seed}/{case}: the first constraint in the list is the first broken")
        transfer_residuals = evaluate_trace(
            circuit(seed, TRANSFER), failing_witness(seed, TRANSFER), field_modulus(seed, TRANSFER)
        )
        kinds = {
            str(c["kind"])
            for c, r in zip(circuit(seed, TRANSFER), transfer_residuals)
            if r != 0
        }
        if not kinds & {"member", "boolean"}:
            failures.append(
                f"{seed}: the transfer trace is answerable without evaluating member or boolean"
            )
    return failures


# --------------------------------------------------------------------------- wrong answers


def wrong_traces(seed: str, case: str) -> list[tuple[str, list[str]]]:
    """Traces that must be rejected, with the reason each one is a near miss."""
    p = field_modulus(seed, case)
    circ = circuit(seed, case)
    correct = evaluate_trace(circ, failing_witness(seed, case), p)
    other = evaluate_trace(
        circuit(seed, LIVE if case == TRANSFER else TRANSFER),
        failing_witness(seed, LIVE if case == TRANSFER else TRANSFER),
        field_modulus(seed, LIVE if case == TRANSFER else TRANSFER),
    )
    first_non_zero = next(index for index, value in enumerate(correct) if value)

    def rendered(values: list[int]) -> list[str]:
        return [",".join(str(value) for value in values)]

    off_by_one = list(correct)
    off_by_one[first_non_zero] = (off_by_one[first_non_zero] - 1) % p

    negative = [str(value) for value in correct]
    negative[first_non_zero] = str(correct[first_non_zero] - p)

    return [
        ("the trace of a witness that satisfies the circuit", rendered([0] * len(circ))),
        ("the right residuals in the wrong places", rendered(correct[1:] + correct[:1])),
        ("one residual off by one", rendered(off_by_one)),
        ("a residual written as its negative representative", [",".join(negative)]),
        ("the trace with the last entry dropped", rendered(correct[:-1])),
        ("the trace with an extra entry", rendered([*correct, 0])),
        ("the other case's trace", rendered(other)),
        ("not a trace at all", ["x"]),
        ("nothing at all", []),
    ]


def wrong_gadgets(seed: str) -> list[tuple[str, list[str]]]:
    """Membership gadgets that must be rejected, with the reason each one is wrong."""
    p = field_modulus(seed, LIVE)
    allowed = allowed_set(seed, LIVE)
    correct = admit_expression(seed)
    outsider = next(value for value in range(p) if value not in allowed)
    one_factor = f"({MEMBERSHIP_SIGNAL} - {allowed[0]})"
    without_last = "*".join(f"({MEMBERSHIP_SIGNAL} - {value})" for value in allowed[:-1])

    return [
        ("zero everywhere, which admits the whole field", ["0"]),
        ("zero nowhere, which admits nothing", ["1"]),
        ("only the first licensed value pinned", [one_factor]),
        ("one licensed value left out", [without_last]),
        (
            "the licensed values plus one that is not",
            [f"{correct}*({MEMBERSHIP_SIGNAL} - {outsider})"],
        ),
        (
            "the sum of the differences instead of the product",
            ["-".join([MEMBERSHIP_SIGNAL, *(str(value) for value in allowed)])],
        ),
        ("the right gadget with a second constraint bolted on", [correct, MEMBERSHIP_SIGNAL]),
        ("not an expression", [f"{MEMBERSHIP_SIGNAL} {MEMBERSHIP_SIGNAL}"]),
        ("division, which a circuit does not have", [f"1/{MEMBERSHIP_SIGNAL}"]),
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


def survivors_of(
    judge: types.ModuleType, seeds: tuple[str, ...] = SEEDS, stop_early: bool = True
) -> list[str]:
    """Every wrong answer this judge accepts, plus a reference answer it rejects.

    `stop_early` because a mutant only has to be caught once and the field sweep is
    the expensive part; the unmutated judge is graded with the full report.
    """
    escaped: list[str] = []
    for seed in seeds:
        try:
            for case in CASES:
                if not judge.check_trace(seed, case, trace_arguments(seed, case)).passed:
                    escaped.append(f"{seed}: rejects the reference trace for {case}")
            if not judge.check_admit(seed, admit_arguments(seed)).passed:
                escaped.append(f"{seed}: rejects the reference gadget")
            if escaped and stop_early:
                break
            for case in CASES:
                for label, arguments in wrong_traces(seed, case):
                    if judge.check_trace(seed, case, arguments).passed:
                        escaped.append(f"accepts a wrong trace ({case}) -- {label}")
                        if stop_early:
                            break
            if escaped and stop_early:
                break
            for label, arguments in wrong_gadgets(seed):
                if judge.check_admit(seed, arguments).passed:
                    escaped.append(f"accepts a wrong gadget -- {label}")
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


# Deliberately absent: removing `parse_trace`'s range check. Dropping it changes the
# message a participant gets, not the verdict -- an entry written as `-14` instead of
# `125` is refused either way, once for being outside the field and once for not
# matching. It is a real requirement (a residual is a field element, and saying so is
# most of the lesson), so it is asserted by the public test on the message rather than
# listed here as a mutant no correct catalog could kill.
MUTATIONS: list[tuple[str, str]] = [
    (
        "trace stops comparing the submission against the residuals",
        replace(
            "    wrong = sum(1 for got, want in zip(submitted, expected) if got != want)",
            "    wrong = 0",
        ),
    ),
    (
        "trace grades against a witness nothing is wrong with",
        replace(
            "    expected = evaluate_trace(circ, failing_witness(seed, case), p)",
            "    expected = [0] * len(circ)",
        ),
    ),
    (
        "trace stops requiring one entry per constraint",
        replace("    if len(values) != length:", "    if False:"),
    ),
    (
        "trace accepts anything that parses",
        replace(
            "    wrong = sum(1 for got, want in zip(submitted, expected) if got != want)",
            "    verdict.passed = True\n    return verdict\n    wrong = 0",
        ),
    ),
    (
        "admit checks the licensed values instead of sweeping the field",
        replace(
            "        value for value in range(p) if evaluate({MEMBERSHIP_SIGNAL: value}, p) % p == 0",
            "        value for value in allowed if evaluate({MEMBERSHIP_SIGNAL: value}, p) % p == 0",
        ),
    ),
    (
        "admit stops rejecting a gadget that refuses a licensed value",
        replace("    if missing:", "    if False:"),
    ),
    (
        "admit stops rejecting a gadget that admits an unlicensed value",
        replace("    if extra:", "    if False:"),
    ),
    (
        "admit drops the one-expression bound",
        replace("    if len(sources) > 1:", "    if False:"),
    ),
    (
        "admit accepts anything that compiles",
        replace(
            "    admitted = sorted(",
            "    verdict.passed = True\n    return verdict\n    admitted = sorted(",
        ),
    ),
]


# --------------------------------------------------------------------------- the gate


def cli(seed: str, state: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603 - argument list, shell=False
        [sys.executable, str(ROOT / "audit.py"), *arguments],
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

            # The transfer circuit is handed over only once the two stages before it
            # are cleared -- not printed, not explainable, not gradeable.
            unlocked = set(real_progress.TRANSFER_REQUIRES) <= set(cleared)
            transfer_id = str(circuit(seed, TRANSFER)[0]["id"])
            shown = transfer_id in cli(seed, state, "show").stdout
            explained = cli(seed, state, "explain", transfer_id).returncode == 0
            graded = cli(seed, state, "transfer", *trace_arguments(seed, TRANSFER)).returncode == 0
            for what, actual in (("show", shown), ("explain", explained), ("grade", graded)):
                if actual != unlocked:
                    failures.append(
                        f"progress {cleared or 'none'}: transfer {what} "
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
                failures.append(f"{seed}: bare `audit` does not print usage")
            show = cli(seed, state, "show")
            if show.returncode != 0:
                failures.append(f"{seed}: `audit show` failed")
            if derive_flag(seed) in show.stdout:
                failures.append(f"{seed}: `audit show` prints the flag")
            # Individual residuals are small field elements and `show` legitimately
            # prints a page of those (the modulus, the constants, the witnesses, the
            # licensed values), so "does this number appear" is noise. The answer is
            # the ordered list, and that is what must not be anywhere on the page.
            for case in CASES:
                if trace_arguments(seed, case)[0] in show.stdout:
                    failures.append(f"{seed}: `audit show` prints the {case} trace")
            if cli(seed, state, "trace", *trace_arguments(seed, LIVE)).returncode != 0:
                failures.append(f"{seed}: the reference trace did not clear `trace`")
            if cli(seed, state, "admit", *admit_arguments(seed)).returncode != 0:
                failures.append(f"{seed}: the reference gadget did not clear `admit`")
            if cli(seed, state, "transfer", *trace_arguments(seed, TRANSFER)).returncode != 0:
                failures.append(f"{seed}: the reference trace did not clear `transfer`")
            if derive_flag(seed) not in cli(seed, state, "flag").stdout:
                failures.append(f"{seed}: the flag was not released after all three stages")
    return failures


# --------------------------------------------------------------------------- main


def main() -> int:
    problems: list[str] = []

    for case in CASES:
        covered = {break_signal(seed, case) for seed in SEEDS}
        if covered != set(BREAKS[case]):
            print(f"FAIL the seed set covers only {sorted(covered)} of {case}'s break shapes")
            return 1
    print(
        "PASS the seed set covers every break shape: "
        + ", ".join(f"{case}={sorted(BREAKS[case])}" for case in CASES)
    )

    for failure in fixture_failures():
        problems.append(f"fixtures: {failure}")
    if not problems:
        print(
            f"PASS the fixtures hold on {len(SEEDS)} seeds: honest witnesses satisfy the "
            "circuit, refused ones break at least two constraints (never the live case's "
            "first), and every transfer trace needs a member or boolean residual"
        )

    escaped = survivors_of(load_judge(JUDGE_SOURCE), stop_early=False)
    if escaped:
        print("FAIL the unmutated judge does not grade correctly:")
        for line in escaped:
            print(f"  - {line}")
        return 1
    print(
        f"PASS the reference answers pass and {2 * len(wrong_traces(SEEDS[0], LIVE))} wrong traces "
        f"+ {len(wrong_gadgets(SEEDS[0]))} wrong gadgets are rejected, on {len(SEEDS)} seeds"
    )

    for failure in end_to_end_failures():
        problems.append(failure)
    if not problems:
        print("PASS the CLI takes a participant from an empty container to the flag")

    for failure in gate_failures():
        problems.append(f"gate: {failure}")
    if not problems:
        print("PASS the flag and the transfer circuit are released for the right states and no other")

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
