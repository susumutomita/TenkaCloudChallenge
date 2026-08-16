"""Take one instruction from a submission and put it in the author's wrapper.

Author-owned and shared by both surfaces, so the participant's own test run and
the hidden grading assemble exactly the same artifact. What the participant edits
is a whole `.S` file — the shape teaches what a measured region is — but only the
line between the markers is ever assembled.

The rules here are about what that one instruction may touch. They are operand
rules rather than an opcode allow-list, because the instruction under test is the
point of the problem and the interesting ones are not knowable in advance:

  * nothing involving the stack or frame pointer, so the wrapper's return address
    and the harness's frames are out of reach
  * no memory destination, so a store cannot reach harness state; loads are fine
    because a bad address faults the run rather than corrupting it
  * no indirect branch target, so control cannot leave the measured region

`Rejected` carries the reason the participant sees.
"""

from __future__ import annotations

import re
from pathlib import Path

BEGIN = "tc_measured_begin"
END = "tc_measured_end"

HARNESS = Path(__file__).resolve().parent
WRAPPER = HARNESS / "wrapper.S.in"

#: Registers whose use would let the instruction reach the wrapper's own frame.
STACK_REGISTERS = ("%rsp", "%esp", "%sp", "%spl", "%rbp", "%ebp", "%bp", "%bpl")

#: Assembler directives a single instruction has no use for. They are how a
#: submission would smuggle a second body, data, or a section switch past a check
#: that only counts instructions.
FORBIDDEN_DIRECTIVE = re.compile(r"^\s*\.(?!byte\b)", re.M)


class Rejected(Exception):
    """The submission is not gradeable. The message is shown to the participant."""


def measured_source(submission: str) -> str:
    """The participant's text between the markers, with comments stripped.

    Everything outside the markers is ignored rather than trusted: it is the
    participant's working area, and none of it reaches the assembler.
    """
    # The markers are labels, so only a line that *is* the label counts. The
    # starter's own header names them in prose, and matching that mention would
    # slice the comment instead of the code.
    label_lines = {BEGIN: -1, END: -1}
    source_lines = submission.splitlines()
    for index, raw in enumerate(source_lines):
        stripped = raw.strip()
        for marker in (BEGIN, END):
            if stripped == marker + ":" and label_lines[marker] == -1:
                label_lines[marker] = index
    if label_lines[BEGIN] == -1 or label_lines[END] == -1:
        raise Rejected(f"the {BEGIN}: / {END}: labels are missing from the submission")
    if label_lines[END] <= label_lines[BEGIN]:
        raise Rejected(f"{END}: comes before {BEGIN}: in the submission")

    lines: list[str] = []
    for raw in source_lines[label_lines[BEGIN] + 1 : label_lines[END]]:
        line = re.sub(r"/\*.*?\*/", " ", raw)
        line = re.sub(r"//.*$", "", line)
        line = re.sub(r"\s#.*$", "", line).strip()
        if line:
            lines.append(line)

    if not lines:
        raise Rejected("the measured region is empty: there is nothing to time")
    if len(lines) > 1:
        raise Rejected(
            f"the measured region holds {len(lines)} lines; the contract is exactly one "
            "instruction"
        )
    return lines[0]


def check_operands(instruction: str) -> None:
    """What the one instruction may touch. See the module docstring."""
    if FORBIDDEN_DIRECTIVE.match(instruction):
        raise Rejected(
            f"'{instruction}' is an assembler directive, not an instruction; the measured "
            "region takes one instruction"
        )
    if ":" in instruction.split("#")[0]:
        raise Rejected("a label in the measured region would make it more than one instruction")

    lowered = instruction.lower()
    for register in STACK_REGISTERS:
        if register in lowered:
            raise Rejected(
                f"'{instruction}' uses {register}: the measured instruction may not touch the "
                "stack, because the wrapper's own frame and return address live there"
            )
    if "*" in instruction:
        raise Rejected(
            f"'{instruction}' branches indirectly; control must not leave the measured region"
        )

    mnemonic, _, operands = instruction.partition(" ")
    if not operands.strip():
        return

    # AT&T order: the last operand is the destination. A memory destination is a
    # store, and a store is how an instruction would reach harness state.
    destination = operands.split(",")[-1].strip()
    if "(" in destination or destination.startswith("$"):
        raise Rejected(
            f"'{instruction}' writes to memory; the measured instruction may read memory "
            "but must leave its result in a register"
        )


def wrapper_source(instruction: str) -> str:
    """The author's wrapper with the participant's instruction spliced in."""
    template = WRAPPER.read_text(encoding="utf-8")
    return template.replace("@INSTRUCTION@", "    " + instruction)


def build(submission: str) -> str:
    """Submission text in, assemblable author-owned source out.

    The two checks are looked up through the module rather than closed over, so a
    test can disable one and prove it is the one holding a given attack out.
    """
    instruction = globals()["measured_source"](submission)
    if not isinstance(instruction, str):
        raise Rejected("the measured region did not yield an instruction")
    globals()["check_operands"](instruction)
    return wrapper_source(instruction)
