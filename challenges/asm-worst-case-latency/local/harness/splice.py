"""Take one instruction from a submission and put it in the author's frame.

Author-owned and shared by every surface, so the participant's own test run and
the hidden grading assemble exactly the same artifact. What the participant edits
is a whole `.S` file — the shape teaches what a measured region is — but only the
line between the markers is ever assembled, and it is assembled into
`wrapper.S.in`, which the participant does not write.

The rules are about what that one instruction may touch. They are operand rules
rather than an opcode allow-list, because the instruction under test is the point
of the problem and the interesting ones are not knowable in advance. Three
properties make the rules a contract instead of a filter:

  * They are applied to the **decoded** instruction, not to the participant's
    text. The one line is assembled on its own and read back through `objdump`,
    so what is judged is what the CPU will run. A line that assembles to
    something other than one instruction never reaches the frame.

  * Assembler directives are refused outright. `.byte` is how a submission
    would hand the assembler an encoding the operand rules never see, and a
    directive is never what "one instruction" means.

  * What the rules cannot see, the frame makes harmless. An instruction whose
    memory write is implicit in its opcode is refused by name here for the sake
    of the message, but the guarantee comes from `wrapper.S.in`: every register
    it did not define is zero, the arena is mapped read-only, and %rsp is
    compared across the region. A store built any other way faults or is caught,
    rather than landing in the harness's own state.

`Rejected` carries the reason the participant sees.
"""

from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path

BEGIN = "tc_measured_begin"
END = "tc_measured_end"

HARNESS = Path(__file__).resolve().parent
WRAPPER = HARNESS / "wrapper.S.in"

#: The baseline is this template with the cheapest dependent arithmetic in it, so
#: the ratio divides out the frame's own prologue and epilogue exactly.
BASELINE_SYMBOL = "tc_baseline"
BASELINE_INSTRUCTION = "addq $1, %rax"
CANDIDATE_SYMBOL = "tc_candidate"


def _spin_count() -> int:
    """How many copies the frame emits. arena.h is the one place it is written."""
    header = (HARNESS / "arena.h").read_text(encoding="utf-8")
    found = re.search(r"^#define\s+TC_SPIN_COUNT\s+(\d+)", header, re.M)
    if found is None:  # pragma: no cover - the header is author-owned
        raise RuntimeError("arena.h no longer defines TC_SPIN_COUNT")
    return int(found.group(1))


SPIN_COUNT = _spin_count()

#: Registers whose use would let the instruction reach the frame's own stack.
STACK_REGISTERS = ("%rsp", "%esp", "%sp", "%spl", "%rbp", "%ebp", "%bp", "%bpl")

#: A segment override is how an instruction addresses memory the flat model does
#: not reach, and it is how the string instructions name their destination.
SEGMENT_PREFIXES = ("%es:", "%cs:", "%ss:", "%ds:", "%fs:", "%gs:")

#: Instructions whose memory operand is implicit in the opcode: objdump prints no
#: memory operand, so the operand rules below cannot see the write. Refusing them
#: by name is for the message. The soundness is in the frame — a stack write
#: moves %rsp and is caught there, and maskmov's %rdi is zero, so it faults.
IMPLICIT_MEMORY = {
    "push", "pushq", "pushw", "pusha", "pushal", "pushf", "pushfq", "pushfw",
    "pop", "popq", "popw", "popa", "popal", "popf", "popfq", "popfw",
    "enter", "leave",
    "maskmovq", "maskmovdqu", "vmaskmovdqu",
}

CONTROL_FLOW_PREFIXES = ("j", "loop", "call", "ret", "iret")
CONTROL_FLOW = {"jmp", "call", "ret", "retq", "iret", "iretq", "loop", "loope", "loopne"}

#: An assembler directive, of any kind. See the module docstring.
DIRECTIVE = re.compile(r"^\s*\.")


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


def check_no_directive(instruction: str) -> None:
    """One statement, and that statement an instruction: no directive, no label.

    A directive is not an instruction, and `.byte` in particular hands the
    assembler an encoding that `check_operands` would never see: the decoded form
    would be a legal-looking instruction whose operands the participant chose in
    hex. There is no directive a single measured instruction needs.

    `;` is checked first because it is what makes "one line" and "one statement"
    different things. GAS separates statements on it, so `nop; .section
    .init_array,"aw"; .quad ...` is one line, one *instruction* as far as a
    disassembler is concerned, and a constructor that runs before the harness
    does -- outside the measured region, with none of the frame's guarantees.
    """
    if ";" in instruction:
        raise Rejected(
            f"'{instruction}' holds more than one statement; the assembler separates them on "
            "';' and the contract is one instruction, not one line of them"
        )
    if DIRECTIVE.match(instruction):
        raise Rejected(
            f"'{instruction}' is an assembler directive, not an instruction. The measured "
            "region takes one instruction, written out; an encoding assembled from raw "
            "bytes is not one"
        )
    if ":" in instruction:
        raise Rejected("a label in the measured region would make it more than one instruction")


def decoded_form(instruction: str) -> str:
    """Assemble the one line on its own and read back what will actually run.

    Judging the participant's text would judge a spelling. Judging the decoded
    form judges the instruction: the assembler has already chosen the encoding,
    resolved the mnemonic suffix, and made every implicit operand objdump can
    show explicit.
    """
    with tempfile.TemporaryDirectory() as workspace:
        work = Path(workspace)
        source = work / "one.s"
        source.write_text(f"    .text\n    {instruction}\n", encoding="utf-8")
        obj = work / "one.o"
        assembled = subprocess.run(
            ["gcc", "-c", "-o", str(obj), str(source)],
            capture_output=True, text=True, errors="replace", timeout=60, check=False,
        )
        if assembled.returncode != 0:
            raise Rejected(
                f"'{instruction}' does not assemble:\n" + assembled.stderr[-1000:].strip()
            )
        disassembled = subprocess.run(
            ["objdump", "-d", "--no-show-raw-insn", str(obj)],
            capture_output=True, text=True, errors="replace", timeout=30, check=False,
        )
        if disassembled.returncode != 0:
            raise Rejected(f"'{instruction}' could not be disassembled")

    decoded = [
        found.group(1).strip()
        for found in (
            re.match(r"^\s+[0-9a-f]+:\s+(\S.*)$", line)
            for line in disassembled.stdout.splitlines()
        )
        if found is not None
    ]
    if len(decoded) != 1:
        raise Rejected(
            f"'{instruction}' assembles to {len(decoded)} instructions; the contract is "
            "exactly one"
        )
    return re.sub(r"\s+#.*$", "", decoded[0]).strip()


def _operands(text: str) -> list[str]:
    """Split a decoded operand list on commas that are not inside a memory operand."""
    operands: list[str] = []
    current: list[str] = []
    depth = 0
    for character in text:
        if character in "({":
            depth += 1
        elif character in ")}":
            depth -= 1
        if character == "," and depth == 0:
            operands.append("".join(current).strip())
            current = []
        else:
            current.append(character)
    tail = "".join(current).strip()
    if tail:
        operands.append(tail)
    return [operand for operand in operands if operand]


def check_operands(decoded: str) -> None:
    """What the one decoded instruction may touch. See the module docstring."""
    if "(bad)" in decoded:
        raise Rejected(f"'{decoded}' is not a decodable instruction")

    mnemonic, _, operand_text = decoded.partition(" ")
    mnemonic = mnemonic.lower()
    base = mnemonic.rstrip("bwlqt") or mnemonic

    if mnemonic in CONTROL_FLOW or mnemonic.startswith(CONTROL_FLOW_PREFIXES):
        raise Rejected(
            f"'{decoded}' is control flow: the measured region would not be one instruction"
        )
    if mnemonic in IMPLICIT_MEMORY or base in IMPLICIT_MEMORY:
        raise Rejected(
            f"'{decoded}' writes to memory that its operands do not name; the measured "
            "instruction may read memory but must leave its result in a register"
        )

    operands = _operands(operand_text)
    for operand in operands:
        lowered = operand.lower()
        for prefix in SEGMENT_PREFIXES:
            if prefix in lowered:
                raise Rejected(
                    f"'{decoded}' addresses memory through a segment override; the measured "
                    "instruction reaches the arena and nothing else"
                )
        for register in STACK_REGISTERS:
            if register in lowered:
                raise Rejected(
                    f"'{decoded}' uses {register}: the measured instruction may not touch the "
                    "stack, because the frame's own saved registers and return address live "
                    "there"
                )
        if operand.startswith("*"):
            raise Rejected(
                f"'{decoded}' branches indirectly; control must not leave the measured region"
            )

    # AT&T order: the last operand is the destination. A memory destination is a
    # store, and a store is how an instruction would reach harness state. Loads
    # are fine: a bad address faults the run rather than corrupting it.
    if operands and "(" in operands[-1]:
        raise Rejected(
            f"'{decoded}' writes to memory; the measured instruction may read memory "
            "but must leave its result in a register"
        )


def frame_source(instruction: str, symbol: str) -> str:
    """The author's frame with one instruction in its measured region."""
    template = WRAPPER.read_text(encoding="utf-8")
    return (
        template.replace("@SYMBOL@", symbol)
        .replace("@SPINS@", str(SPIN_COUNT))
        .replace("@INSTRUCTION@", "    " + instruction)
    )


def baseline_source() -> str:
    """The comparison point: the same frame, the cheapest dependent arithmetic."""
    return frame_source(BASELINE_INSTRUCTION, BASELINE_SYMBOL)


def build(submission: str) -> str:
    """Submission text in, assemblable author-owned source out.

    The checks are looked up through the module rather than closed over, so a
    test can disable one and prove it is the one holding a given attack out.
    """
    instruction = globals()["measured_source"](submission)
    if not isinstance(instruction, str):
        raise Rejected("the measured region did not yield an instruction")
    globals()["check_no_directive"](instruction)
    decoded = globals()["decoded_form"](instruction)
    if isinstance(decoded, str):
        globals()["check_operands"](decoded)
    return frame_source(instruction, CANDIDATE_SYMBOL)
