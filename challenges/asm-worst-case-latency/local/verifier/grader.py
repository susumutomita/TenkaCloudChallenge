"""Grade a candidate: read what it is before trusting what it measured.

The order matters. A submission is disassembled and judged as text first, and
only a submission that survives that is ever built and run. A candidate that
sleeps, syscalls, or unrolls its own loop must not get as far as producing a
number, because a number is persuasive and the reason it is wrong is not.

What the measured region must be:

  exactly_one_instruction   between tc_measured_begin and tc_measured_end there
                            is one instruction, and it is not control flow
  no_forbidden_instruction  no syscall, no privileged instruction, no timing
                            instruction of the candidate's own, no fence that
                            would let it measure something other than itself
  reject_migration_or_interrupt
                            samples whose CPU changed mid-measurement are
                            dropped by the harness; a run that kept too few
                            samples is not a result
  normalized_score          candidate cycles over baseline cycles, measured in
                            the same process on the same host
"""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "harness"

BEGIN = "tc_measured_begin"
END = "tc_measured_end"

#: Instructions that would make the measurement mean something else. Control
#: flow is separate (see CONTROL_FLOW) because it is rejected for a different
#: reason: it makes "one instruction" untrue rather than dishonest.
FORBIDDEN = {
    # asking the OS for time, or for anything at all
    "syscall", "sysenter", "int", "int3", "int1", "into",
    # timing instructions of the candidate's own: the harness owns the clock
    "rdtsc", "rdtscp", "rdpmc", "rdpid",
    # privileged / ring-0
    "hlt", "cli", "sti", "wrmsr", "rdmsr", "invd", "wbinvd", "invlpg",
    "lgdt", "lidt", "ltr", "lldt", "clts", "swapgs", "sysret", "sysexit",
    "vmcall", "vmlaunch", "vmresume", "vmxon", "vmxoff", "monitor", "mwait",
    # cache control: flushing a line you are about to load is measuring the
    # flush, and the arena already guarantees the miss
    "clflush", "clflushopt", "clwb", "wbnoinvd", "prefetchw",
    # stalling on purpose without doing work
    "pause", "tpause", "umwait", "umonitor",
}

CONTROL_FLOW_PREFIXES = ("j", "loop", "call", "ret", "iret")
CONTROL_FLOW = {"jmp", "call", "ret", "retq", "iret", "iretq", "loop", "loope", "loopne"}


class Rejected(Exception):
    """The submission is not gradeable. The message is shown to the participant."""


def _objdump(obj: Path) -> list[tuple[str, str]]:
    """Disassemble to (symbol-or-label, mnemonic) pairs, in address order."""
    result = subprocess.run(
        ["objdump", "-d", "--no-show-raw-insn", str(obj)],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        raise Rejected("the submission could not be disassembled")

    rows: list[tuple[str, str]] = []
    for line in result.stdout.splitlines():
        label = re.match(r"^[0-9a-f]+ <([^>]+)>:", line.strip())
        if label is not None:
            rows.append(("label:" + label.group(1), ""))
            continue
        body = re.match(r"^\s+[0-9a-f]+:\s+([a-z][a-z0-9.]*)", line)
        if body is not None:
            rows.append(("insn", body.group(1)))
    return rows


def measured_region(rows: list[tuple[str, str]]) -> list[str]:
    """The instructions between the two markers, in order.

    The markers are labels in the object file, so they survive assembly without
    becoming instructions themselves.
    """
    inside = False
    found = False
    region: list[str] = []
    for kind, value in rows:
        if kind == "label:" + BEGIN:
            inside, found = True, True
            continue
        if kind == "label:" + END:
            inside = False
            continue
        if inside and kind == "insn":
            region.append(value)
    if not found:
        raise Rejected(f"the {BEGIN} marker is missing from the submission")
    return region


def exactly_one_instruction(region: list[str]) -> None:
    """One instruction, and one that stays inside the measured region."""
    if len(region) == 0:
        raise Rejected("the measured region is empty: there is nothing to time")
    if len(region) > 1:
        raise Rejected(
            f"the measured region holds {len(region)} instructions ({', '.join(region)}); "
            "the contract is exactly one"
        )
    mnemonic = region[0]
    if mnemonic in CONTROL_FLOW or (
        mnemonic.startswith(CONTROL_FLOW_PREFIXES) and mnemonic not in ("jecxz",)
    ):
        raise Rejected(
            f"'{mnemonic}' is control flow: the measured region would not be one instruction"
        )


def no_forbidden_instruction(region: list[str]) -> None:
    for mnemonic in region:
        base = mnemonic.rstrip("bwlqt") or mnemonic
        if mnemonic in FORBIDDEN or base in FORBIDDEN:
            raise Rejected(
                f"'{mnemonic}' is not allowed in the measured region: the harness owns "
                "the clock, the scheduler, and the cache state"
            )


def reject_migration_or_interrupt(run: dict) -> None:
    """A run that could not keep enough clean samples is not a result.

    The harness drops samples whose CPU changed mid-measurement. If most of them
    went, the host was too busy for the number to mean anything, and reporting it
    anyway would turn scheduler noise into a score.
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
        candidate = work / "candidate.S"
        candidate.write_text(source, encoding="utf-8")

        obj = work / "candidate.o"
        assemble = subprocess.run(
            ["gcc", "-c", "-o", str(obj), str(candidate)],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if assemble.returncode != 0:
            raise Rejected("the submission does not assemble:\n" + assemble.stderr[-2000:])

        rows = _objdump(obj)
        region = measured_region(rows)
        exactly_one_instruction(region)
        no_forbidden_instruction(region)

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
                timeout=180,
                check=False,
            )
        except subprocess.TimeoutExpired:
            raise Rejected("the measurement did not finish within its time limit") from None
        if completed.returncode < 0:
            raise Rejected(
                f"the measurement was killed by signal {-completed.returncode}: "
                "the instruction under test did not run to completion"
            )
        if completed.returncode != 0:
            raise Rejected("the measurement did not complete")
        try:
            return json.loads(completed.stdout)
        except json.JSONDecodeError:
            raise Rejected("the measurement produced no readable result") from None


def grade(source: str, seed: int) -> dict:
    """The whole judgement: shape first, then the number."""
    run = build_and_run(source, seed)
    reject_migration_or_interrupt(run)
    score = normalized_score(run)
    return {
        "normalizedScore": score,
        "baselineCycles": int(run["baseline"]["robustCycles"]),
        "candidateCycles": int(run["candidate"]["robustCycles"]),
        "keptSamples": int(run["candidate"]["kept"]),
    }
