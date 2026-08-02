"""Author / CI suite: prove the judge can fail a wrong answer, and the gate can hold.

Three parts, run by `make reference-test` inside the `author` image.

1. The reference answers clear both stages and produce the flag, end to end through
   the CLI a participant actually types -- on seeds covering both possible drops.
2. A catalog of wrong answers is rejected, each for its own reason. These are the
   near misses: a witness that satisfies the deployed circuit while asserting
   nothing false, a repair that only blocks the forgery the participant happened to
   find, a repair with this deployment's counter hard-coded into it.
3. The judge is broken on purpose, one requirement at a time, and every broken
   version has to be caught by that catalog. A checkpoint nobody can fail is not a
   checkpoint, and this is the only thing that tests the tests.

Plus the flag gate: the flag is withheld for every subset of the stages except the
complete one.
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

from fixtures.generate import DROPPABLE, dropped_constraint, flag as derive_flag, params
from lab import progress as real_progress
from lab.judge import check_repair, check_witness
from reference.solve import repair_arguments, repair_expression, witness_arguments

#: Enough seeds that both drops occur; asserted below rather than assumed.
SEEDS = tuple(f"mutation-seed-{index}" for index in range(8))

JUDGE_SOURCE = (ROOT / "lab" / "judge.py").read_text(encoding="utf-8")


# --------------------------------------------------------------------------- wrong answers


def wrong_witnesses(seed: str) -> list[tuple[str, list[str]]]:
    """Witnesses that must be rejected, with the reason each one is a near miss."""
    prm = params(seed)
    p = prm["p"]
    r = prm["revoked"] % p
    inverse = pow(r, -1, p)

    def render(**values: int) -> list[str]:
        return [f"{name}={value}" for name, value in values.items()]

    return [
        (
            "the honest revoked holder -- accepted by production, and true",
            render(revoked=r, inv=inverse, ok=0, issuer_ok=1, granted=0),
        ),
        (
            "the honest clean holder -- accepted by production, and true",
            render(revoked=0, inv=0, ok=1, issuer_ok=1, granted=1),
        ),
        (
            "an honest witness with a wrong inverse: fails the intended circuit, "
            "asserts nothing false",
            render(revoked=r, inv=(inverse + 1) % p, ok=0, issuer_ok=1, granted=0),
        ),
        (
            "a false claim the deployed circuit would have caught",
            render(revoked=r, inv=0, ok=0, issuer_ok=1, granted=1),
        ),
        (
            "`ok` outside {0, 1}, which c-ok-bool already rejects",
            render(revoked=r, inv=0, ok=2, issuer_ok=1, granted=2),
        ),
        ("not a witness at all", ["revoked=1"]),
    ]


def wrong_repairs(seed: str) -> list[tuple[str, list[str]]]:
    """Repairs that must be rejected, with the reason each one is a near miss."""
    prm = params(seed)
    r = prm["revoked"] % prm["p"]
    dropped = dropped_constraint(seed)
    #: The half of the gadget that is still deployed. Adding it back changes nothing.
    present = "revoked*inv + ok - 1" if dropped == "c-iszero-b" else "revoked*ok"
    missing_with_literal = (
        f"{r}*ok" if dropped == "c-iszero-b" else f"{r}*inv + ok - 1"
    )

    return [
        ("a constraint that constrains nothing", ["0"]),
        ("the half of the gadget that is already deployed", [present]),
        ("this deployment's counter hard-coded instead of the signal", [missing_with_literal]),
        ("ok pinned to zero, which denies the clean holder", ["ok"]),
        (
            # The one wrong repair that keeps both honest witnesses and blocks every
            # lie, and is still wrong: `inv` is free whenever the counter is zero, and
            # this pins it. A prover who supplies any other inverse is refused, which
            # is an outage that neither honest witness reveals.
            "the missing constraint with the free helper signal pinned as well",
            [f"{repair_expression(seed)} + inv*ok"],
        ),
        ("granted pinned to zero, which denies the clean holder", ["granted"]),
        (
            "the whole gadget added back on top of the half that is there",
            ["revoked*ok", "revoked*inv + ok - 1"],
        ),
        ("not an expression", ["revoked ok"]),
        ("division, which a circuit does not have", ["ok - revoked/revoked"]),
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

    `stop_early` because a mutant only has to be caught once and the family walk is
    the expensive part; the unmutated judge is graded with the full report.
    """
    escaped: list[str] = []
    for seed in seeds:
        try:
            if not judge.check_witness(seed, witness_arguments(seed)).passed:
                escaped.append(f"{seed}: rejects the reference witness")
            if not judge.check_repair(seed, repair_arguments(seed)).passed:
                escaped.append(f"{seed}: rejects the reference repair")
            for label, arguments in wrong_witnesses(seed):
                if judge.check_witness(seed, arguments).passed:
                    escaped.append(f"accepts a wrong witness -- {label}")
            if escaped and stop_early:
                break
            for label, arguments in wrong_repairs(seed):
                if judge.check_repair(seed, arguments).passed:
                    escaped.append(f"accepts a wrong repair -- {label}")
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


# Deliberately absent: removing `check_repair`'s honest-witness loop. It is an
# equivalent mutant -- both honest witnesses are inside `witness_family`, so the
# policy comparison rejects exactly the same repairs. The loop exists to say
# "you denied the clean holder" instead of "you are stricter than the policy",
# which is a better message and not a separate requirement.
MUTATIONS: list[tuple[str, str]] = [
    (
        "check stops requiring the witness to satisfy the deployed circuit",
        replace("    failing = unsatisfied(deployed, witness, p)", "    failing = []"),
    ),
    (
        "check stops requiring the claim to be false",
        replace("    if claimed == truth:", "    if False:"),
    ),
    (
        "check accepts anything that parses",
        replace(
            "    failing = unsatisfied(deployed, witness, p)",
            "    verdict.passed = True\n    return verdict\n    failing = []",
        ),
    ),
    (
        "repair stops comparing the repaired circuit against the policy",
        replace("        if by_repaired and not by_intended:", "        if False:"),
    ),
    (
        "repair stops rejecting a circuit stricter than the policy",
        replace("    if too_strict is not None:", "    if False:"),
    ),
    (
        "repair drops the minimality bound",
        replace("MAX_ADDED_CONSTRAINTS = 1", "MAX_ADDED_CONSTRAINTS = 99"),
    ),
    (
        "the witness family collapses to something the policy never accepts",
        replace("    return family", "    return family[:1]"),
    ),
    (
        "the witness family collapses and the non-vacuity guard is gone with it",
        replace("    return family", "    return family[:1]").replace(
            '        raise AssertionError("the witness family contains nothing the policy accepts")',
            "        pass",
            1,
        ),
    ),
    (
        "repair accepts anything that parses",
        replace(
            "    for label, witness in zip((\"revoked holder\", \"clean holder\"), honest_witnesses(prm)):",
            "    verdict.passed = True\n    return verdict\n    for label, witness in "
            "zip((\"revoked holder\", \"clean holder\"), honest_witnesses(prm)):",
        ),
    ),
]


# --------------------------------------------------------------------------- the gate


def cli(seed: str, state: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603 - argument list, shell=False
        [sys.executable, str(ROOT / "circuit.py"), *arguments],
        capture_output=True,
        text=True,
        timeout=120,
        cwd="/",
        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "FLAG_SEED": seed, "LAB_STATE_DIR": str(state)},
        check=False,
    )


def gate_failures() -> list[str]:
    """The flag is released for exactly one of the four progress states."""
    failures: list[str] = []
    seed = SEEDS[0]
    expected = derive_flag(seed)
    for stages in ([], ["check"], ["repair"], ["check", "repair"]):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            state.mkdir()
            (state / "progress.json").write_text(
                json.dumps({stage: True for stage in stages}), encoding="utf-8"
            )
            result = cli(seed, state, "flag")
            released = expected in result.stdout
            should_release = set(stages) == set(real_progress.STAGES)
            if released != should_release:
                failures.append(
                    f"progress {stages or 'none'}: flag "
                    + ("released" if released else "withheld")
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
                failures.append(f"{seed}: bare `circuit` does not print usage")
            if cli(seed, state, "show").returncode != 0:
                failures.append(f"{seed}: `circuit show` failed")
            if derive_flag(seed) in cli(seed, state, "show").stdout:
                failures.append(f"{seed}: `circuit show` prints the flag")
            if cli(seed, state, "check", *witness_arguments(seed)).returncode != 0:
                failures.append(f"{seed}: the reference witness did not clear `check`")
            if cli(seed, state, "repair", *repair_arguments(seed)).returncode != 0:
                failures.append(f"{seed}: the reference repair did not clear `repair`")
            result = cli(seed, state, "flag")
            if derive_flag(seed) not in result.stdout:
                failures.append(f"{seed}: the flag was not released after both stages")
    return failures


# --------------------------------------------------------------------------- main


def main() -> int:
    problems: list[str] = []

    covered = {dropped_constraint(seed) for seed in SEEDS}
    if covered != set(DROPPABLE):
        print(f"FAIL the seed set covers only {sorted(covered)}")
        return 1
    print(f"PASS the seed set covers both drops: {sorted(covered)}")

    escaped = survivors_of(load_judge(JUDGE_SOURCE), stop_early=False)
    if escaped:
        print("FAIL the unmutated judge does not grade correctly:")
        for line in escaped:
            print(f"  - {line}")
        return 1
    print(
        f"PASS the reference answers pass and {len(wrong_witnesses(SEEDS[0]))} wrong witnesses "
        f"+ {len(wrong_repairs(SEEDS[0]))} wrong repairs are rejected, on {len(SEEDS)} seeds"
    )

    for failure in end_to_end_failures():
        problems.append(failure)
    if not problems:
        print("PASS the CLI takes a participant from an empty container to the flag")

    for failure in gate_failures():
        problems.append(f"flag gate: {failure}")
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
