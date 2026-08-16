"""The hidden properties that decide the code checkpoints.

Grade a candidate: read what it is before trusting what it measured.

The order matters. A submission is rendered into the fixed wrapper, assembled,
then disassembled and judged before it is linked or run. A candidate that
sleeps, syscalls, or unrolls its own loop must not get as far as producing a
number, because a number is persuasive and the reason it is wrong is not.

What the measured region must be:

  exactly_one_instruction   one submitted instruction is expanded exactly the
                            author-owned fixed count, and it is not control flow
  reviewed_instruction_policy
                            only the positive scalar-integer/GPR set; no syscall,
                            privileged, SIMD/x87, random, timing, cache, or
                            unknown instruction and no memory write
  reject_migration_or_interrupt
                            samples whose CPU changed mid-measurement are
                            dropped, as are extreme high-side outliers under a
                            predeclared rule; too few clean samples is no result
  normalized_score          candidate cycles over baseline cycles, measured in
                            the same process on the same host
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

from harness.candidate import (
    SPIN_COUNT,
    CandidateFormatError,
    build_candidate_object,
)
from fixtures.generate import host_report

ROOT = Path(__file__).resolve().parents[2]
HARNESS = ROOT / "harness"


class Rejected(Exception):
    """The submission is not gradeable. The message is shown to the participant."""


class HarnessUnusable(Exception):
    """The lab could not run its own measurement.

    Deliberately not a `Rejected`: nothing was learned about the submission, so
    turning this into a verdict would report an environment fault as a wrong
    answer. The verifier still fails closed on it, but the distinction is kept
    where the cause is known.
    """


def well_formed_result(run: object, seed: int) -> dict:
    """Require the fixed harness schema before trusting any reported number."""
    if not isinstance(run, dict):
        raise Rejected("the measurement did not produce a result object")
    if run.get("seed") != seed or run.get("spins") != SPIN_COUNT or run.get("samples") != 101:
        raise Rejected("the measurement metadata does not match the fixed harness")
    for side in ("baseline", "candidate"):
        block = run.get(side)
        if not isinstance(block, dict):
            raise Rejected(f"the measurement reported no {side}")
        values = [block.get(field) for field in ("robustCycles", "kept", "rejected")]
        if not all(isinstance(value, int) and not isinstance(value, bool) for value in values):
            raise Rejected(f"the measurement's {side} fields are not integers")
        if values[0] < 0 or values[1] < 0 or values[2] < 0 or values[1] + values[2] != 101:
            raise Rejected(f"the measurement's {side} sample accounting is invalid")
        breakdown = [block.get(field) for field in ("rejectedMigration", "rejectedInterrupt")]
        if not all(isinstance(value, int) and not isinstance(value, bool) for value in breakdown):
            raise Rejected(f"the measurement's {side} rejection evidence is missing")
        if any(value < 0 for value in breakdown) or sum(breakdown) != values[2]:
            raise Rejected(f"the measurement's {side} rejection evidence is invalid")
    checksum = run.get("checksum")
    if not isinstance(checksum, str) or not checksum or any(c not in "0123456789abcdef" for c in checksum):
        raise Rejected("the measurement checksum is invalid")
    return run


def reject_migration_or_interrupt(run: dict) -> None:
    """A run that could not keep enough clean samples is not a result.

    The harness drops samples whose CPU changed mid-measurement. If most of them
    or extreme interrupt-like outliers went, the host was too busy for the
    number to mean anything, and reporting it anyway would turn scheduler noise
    into a score.
    """
    for side in ("baseline", "candidate"):
        kept = int(run[side]["kept"])
        rejected = int(run[side]["rejected"])
        if kept < 51:
            raise Rejected(
                f"only {kept} of {kept + rejected} {side} samples stayed on one CPU; "
                "the host is too busy to measure on"
            )


def normalized_score(run: dict) -> float:
    """Candidate over baseline, both measured in this process on this host.

    Never a raw cycle count: a fast machine and a slow machine disagree about
    cycles and agree about the ratio, and the ratio is what the problem is about.
    """
    baseline = int(run["baseline"]["robustCycles"])
    candidate = int(run["candidate"]["robustCycles"])
    if baseline <= 0:
        raise Rejected("the baseline did not produce a usable measurement")
    return candidate / baseline


def build_and_run(source: str, seed: int) -> dict:
    """Assemble the candidate with the author's harness and run one measurement."""
    with tempfile.TemporaryDirectory() as workspace:
        work = Path(workspace)
        obj = work / "candidate.o"
        try:
            build_candidate_object(source, obj)
        except CandidateFormatError as error:
            raise Rejected(str(error)) from None

        binary = work / "measure"
        link = subprocess.run(
            [
                "gcc", "-O2", "-I", str(HARNESS), "-o", str(binary),
                str(HARNESS / "measure.c"), str(HARNESS / "arena.c"),
                str(HARNESS / "baseline.S"), str(obj),
            ],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if link.returncode != 0:
            raise Rejected("the submission does not link against the harness:\n" + link.stderr[-2000:])

        # A submission that hangs or dies is a failed checkpoint, not a failed
        # verifier: the instruction under test is chosen by the participant, and
        # some choices fault or never return.
        try:
            completed = subprocess.run(
                [str(binary), str(seed)],
                capture_output=True,
                text=True,
                errors="replace",
                timeout=180,
                check=False,
            )
        except subprocess.TimeoutExpired:
            raise Rejected("the measurement did not finish within its time limit") from None
        except OSError as error:
            # The lab could not start its own binary -- /tmp mounted noexec, for
            # instance. That is an environment fault, not a submission that ran
            # and lost, so it is raised as itself rather than swallowed into a
            # verdict about the participant.
            raise HarnessUnusable(f"this lab cannot run its own measurement: {error}") from None
        if completed.returncode < 0:
            why = {
                4: "the instruction changed the fixed call frame, or this host cannot execute it",
                11: "the instruction addressed memory it may not reach; the arena is read-only",
            }.get(-completed.returncode, "the instruction under test did not run to completion")
            raise Rejected(f"the measurement was killed by signal {-completed.returncode}: {why}")
        if completed.returncode != 0:
            raise Rejected("the measurement did not complete")
        try:
            return json.loads(completed.stdout)
        except json.JSONDecodeError:
            raise Rejected("the measurement produced no readable result") from None


def grade(source: str, seed: int) -> dict:
    """The whole judgement: shape first, then the number."""
    run = well_formed_result(build_and_run(source, seed), seed)
    reject_migration_or_interrupt(run)
    score = normalized_score(run)
    return {
        "normalizedScore": score,
        "baselineCycles": int(run["baseline"]["robustCycles"]),
        "candidateCycles": int(run["candidate"]["robustCycles"]),
        "keptSamples": int(run["candidate"]["kept"]),
        "host": host_report(),
    }
