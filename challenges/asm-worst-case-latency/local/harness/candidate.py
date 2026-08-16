"""Build the participant's one instruction into the author-owned wrapper.

The submission is intentionally *not* a complete assembly function.  Letting a
participant own the prologue, repeat count, labels, or return path would make
those unmeasured-looking lines part of the timed function and turn them into an
easy scoring bypass. The only participant-controlled text that reaches the
assembler is one approved scalar-integer instruction line; this module owns
everything around it and expands it exactly ``TC_SPIN_COUNT`` times.

The frame saves the original stack pointer in reserved ``%r15`` and verifies it
after the measured copies. The arena itself is mapped read-only by ``arena.c``.
Those runtime checks are defense in depth behind the decoded-object validation;
known stack operations and stores are still rejected before link or execution.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

BEGIN = "tc_measured_begin"
END = "tc_measured_end"
MAX_INSTRUCTION_CHARS = 256

_HEADER = Path(__file__).with_name("arena.h")
_SPIN_MATCH = re.search(
    r"^#define\s+TC_SPIN_COUNT\s+([1-9][0-9]*)\s*$",
    _HEADER.read_text(encoding="utf-8"),
    re.MULTILINE,
)
if _SPIN_MATCH is None:  # fail closed if the C and assembly contracts drift
    raise RuntimeError("arena.h must define a positive integer TC_SPIN_COUNT")
SPIN_COUNT = int(_SPIN_MATCH.group(1))

_MNEMONIC = re.compile(r"^[A-Za-z][A-Za-z0-9.]*$")
_STACK_REGISTER = re.compile(r"%(?:rsp|esp|sp|spl)\b", re.IGNORECASE)
_RESERVED_REGISTER = re.compile(r"%(?:r15|r15d|r15w|r15b)\b", re.IGNORECASE)
_INSTRUCTION_POINTER = re.compile(r"%(?:rip|eip|ip)\b", re.IGNORECASE)
_PRIVILEGED_REGISTER = re.compile(r"%(?:cr|db|dr|tr)[0-9]+\b", re.IGNORECASE)
_SEGMENT_REGISTER = re.compile(r"%(?:cs|ds|es|fs|gs|ss)\b", re.IGNORECASE)
_REGISTER_TOKEN = re.compile(r"%[A-Za-z][A-Za-z0-9]*(?:\([0-9]+\))?")
_GPR_NAMES = {
    "rax", "rbx", "rcx", "rdx", "rsi", "rdi", "rbp", "rsp",
    "eax", "ebx", "ecx", "edx", "esi", "edi", "ebp", "esp",
    "ax", "bx", "cx", "dx", "si", "di", "bp", "sp",
    "al", "bl", "cl", "dl", "ah", "bh", "ch", "dh",
    "sil", "dil", "bpl", "spl",
    *(
        f"r{number}{suffix}"
        for number in range(8, 16)
        for suffix in ("", "d", "w", "b")
    ),
}
_UNSAFE_TEXT = (";", ":", "\\", '"', "'", "`", "/*", "*/")
_PREFIXES = {
    "addr16",
    "addr32",
    "bnd",
    "cs",
    "data16",
    "data32",
    "ds",
    "es",
    "fs",
    "gs",
    "lock",
    "notrack",
    "rep",
    "repe",
    "repne",
    "repnz",
    "repz",
    "rex",
    "rex64",
    "rex.w",
    "ss",
    "wait",
    "xacquire",
    "xrelease",
}

# Fail closed on the small instruction family needed by this Level 1-3 MVP.
# An x86 denylist cannot be complete: new system, virtualization, and machine-
# state instructions keep being added under distinct mnemonics. The assembled
# mnemonic must therefore be an ordinary scalar-integer operation we explicitly
# support. SIMD/x87, random, system-state, and future unknown instructions stay
# outside the executable boundary until this set is deliberately reviewed.
_ALLOWED_SCALAR_MNEMONICS = {
    "nop", "nopw", "nopl", "nopq",
    "mov", "movabs", "lea",
    "movzbw", "movzbl", "movzbq", "movzwl", "movzwq",
    "movsbw", "movsbl", "movsbq", "movswl", "movswq", "movslq",
    "add", "adc", "sub", "sbb", "and", "or", "xor", "cmp", "test",
    "inc", "dec", "neg", "not", "mul", "imul", "div", "idiv",
    "shl", "shr", "sar", "rol", "ror", "rcl", "rcr", "shld", "shrd",
    "bt", "bts", "btr", "btc", "bsf", "bsr", "bswap",
    "xchg", "xadd", "cmpxchg",
    "cbtw", "cwtl", "cltq", "cwtd", "cltd", "cqto",
}
# Feature-gated scalar extensions (for example POPCNT/LZCNT/TZCNT/BMI/ADX) are
# intentionally absent until runtime.compatibility declares their CPUID flags.
_CONDITION_CODES = {
    "o", "no", "b", "ae", "e", "ne", "be", "a",
    "s", "ns", "p", "np", "l", "ge", "le", "g",
}
_ALLOWED_CONDITIONAL_INTEGER = {
    *(f"set{condition}" for condition in _CONDITION_CODES),
    *(f"cmov{condition}" for condition in _CONDITION_CODES),
}

# Instructions that can change what the measurement means, escape the fixed
# control flow, or mutate process/CPU state that the wrapper cannot restore.
# Validation uses the assembled mnemonic, not only the participant's spelling.
FORBIDDEN = {
    # entering the kernel or firmware
    "syscall", "sysenter", "int", "int1", "int3", "into", "icebp",
    "in", "ins", "insb", "insw", "insl", "out", "outs", "outsb", "outsw", "outsl",
    # timing and performance counters: the author-owned harness owns the clock
    "rdtsc", "rdtscp", "rdpmc", "rdpid", "rdpru",
    # serialization and fences belong to the fixed timer
    "cpuid", "lfence", "mfence", "sfence", "serialize",
    # privileged, virtualization, enclave, and machine-state instructions
    "hlt", "cli", "sti", "clac", "stac", "wrmsr", "wrmsrns", "wrmsrlist",
    "rdmsr", "rdmsrlist", "invd", "wbinvd",
    "wbnoinvd", "invlpg", "invpcid", "lgdt", "lidt", "ltr", "lldt", "clts",
    "lmsw", "smsw", "sldt", "str", "swapgs", "sysret", "sysexit", "rsm",
    "skinit", "getsec", "pconfig", "hreset", "mcommit", "pvalidate",
    "vmcall", "vmlaunch", "vmresume", "vmxon", "vmxoff", "vmfunc",
    "vmread", "vmwrite", "invept", "invvpid", "monitor", "monitorx", "mwait",
    "mwaitx", "vmmcall", "vmrun", "vmload", "vmsave", "stgi", "clgi",
    "invlpga", "tlbsync", "psmash", "rmpadjust", "rmpupdate", "rmpquery",
    "encls", "enclu", "enclv", "tdcall", "seamcall", "seamret", "loadiwkey",
    "enqcmd", "enqcmds", "movdir64b", "movdiri", "senduipi", "ud2", "xabort",
    # cache control and explicit prefetching change the intended workload
    "clflush", "clflushopt", "clwb", "clzero", "cldemote", "prefetchw", "prefetchwt1",
    "prefetchnta", "prefetcht0", "prefetcht1", "prefetcht2",
    # deliberate waiting is not useful work by the instruction under test
    "pause", "tpause", "umwait", "umonitor", "wait", "fwait",
    # the wrapper owns its call frame
    "push", "pushq", "pushf", "pushfq", "pop", "popq", "popf", "popfq",
    "enter", "leave",
    # implicit memory/string operations do not expose an arena-only address
    "movs", "movsb", "movsw", "movsl", "movsq", "cmps", "cmpsb", "cmpsw",
    "cmpsl", "cmpsq", "scas", "scasb", "scasw", "scasl", "scasq", "lods",
    "lodsb", "lodsw", "lodsl", "lodsq", "stos", "stosb", "stosw", "stosl",
    "stosq", "xlat", "xlatb", "maskmovq", "maskmovdqu", "vmaskmovdqu",
    # state not restored by the ordinary SysV integer calling convention
    "wrfsbase", "wrgsbase", "wrpkru", "xsetbv", "ldmxcsr", "fxrstor",
    "fxrstor64", "xrstor", "xrstor64", "xrstors", "xrstors64", "fldcw",
    "fldenv", "frstor", "finit", "fninit", "rstorssp", "saveprevssp",
    "incssp", "incsspd", "incsspq", "setssbsy", "clrssbsy",
    # user-interrupt state and its implicit control-flow return
    "clui", "stui", "testui", "uiret",
    # prefixes can hide the actual operation from a first-token parser
    *_PREFIXES,
}

CONTROL_FLOW_PREFIXES = (
    "j", "loop", "call", "lcall", "ljmp", "ret", "lret", "iret", "xbegin",
)

# These instructions can write through a memory operand even when GNU objdump
# prints that operand before an explicit register.  Ordinary AT&T instructions
# put their destination last; symmetric/read-modify-write instructions need the
# additional fail-closed rule.
MEMORY_MUTATING_PREFIXES = (
    "xchg", "xadd", "cmpxchg", "bts", "btr", "btc",
)


class CandidateFormatError(ValueError):
    """The submission is outside the one approved scalar-integer line contract."""


def instruction_from_submission(source: str) -> str:
    """Return the single instruction line, ignoring blank and ``#`` comments."""
    if not isinstance(source, str) or "\0" in source:
        raise CandidateFormatError("candidate.S must be UTF-8 text")

    lines: list[str] = []
    for raw in source.splitlines():
        line = raw.split("#", 1)[0].strip()
        if line:
            lines.append(line)

    if len(lines) != 1:
        raise CandidateFormatError(
            "candidate.S must contain exactly one instruction line; "
            "the harness owns setup, repetition, labels, and return"
        )

    instruction = lines[0]
    if len(instruction) > MAX_INSTRUCTION_CHARS:
        raise CandidateFormatError("the instruction line is too long")
    if _STACK_REGISTER.search(instruction):
        raise CandidateFormatError("the instruction may not read or change the wrapper's stack pointer")
    if _RESERVED_REGISTER.search(instruction):
        raise CandidateFormatError("%r15 is reserved for the wrapper's call-frame guard")
    if _INSTRUCTION_POINTER.search(instruction):
        raise CandidateFormatError("instruction-pointer-relative operands are not allowed")
    if _PRIVILEGED_REGISTER.search(instruction):
        raise CandidateFormatError("privileged control and debug registers are not allowed")
    if _SEGMENT_REGISTER.search(instruction):
        raise CandidateFormatError("segment-register addressing is not allowed")
    unsupported = _unsupported_registers(instruction)
    if unsupported:
        raise CandidateFormatError(
            "the instruction may use only scalar general-purpose integer "
            f"registers, not {', '.join(unsupported)}"
        )
    if instruction.startswith(".") or any(token in instruction for token in _UNSAFE_TEXT):
        raise CandidateFormatError(
            "assembler directives, labels, separators, and escapes are not allowed"
        )

    mnemonic = instruction.split(None, 1)[0].lower()
    if _MNEMONIC.fullmatch(mnemonic) is None:
        raise CandidateFormatError("candidate.S must start with an instruction mnemonic")
    if mnemonic in _PREFIXES or mnemonic.startswith("rex"):
        raise CandidateFormatError(
            f"'{mnemonic}' is an instruction prefix; submit one unprefixed instruction"
        )
    if mnemonic.startswith(CONTROL_FLOW_PREFIXES):
        raise CandidateFormatError(
            f"'{mnemonic}' is control flow; repetition belongs to the fixed wrapper"
        )
    return instruction


def render_candidate(source: str) -> str:
    """Embed the one instruction in the fixed wrapper assembled by every path."""
    instruction = instruction_from_submission(source)
    return f"""#include \"arena.h\"

    .text
    .globl tc_candidate
    .type tc_candidate, @function
tc_candidate:
    pushq   %rbx
    pushq   %rbp
    pushq   %r12
    pushq   %r13
    pushq   %r14
    pushq   %r15
    movq    %rsp, %r15
    xorl    %ebx, %ebx
    xorl    %ebp, %ebp
    xorl    %r12d, %r12d
    xorl    %r13d, %r13d
    xorl    %r14d, %r14d
    xorl    %ecx, %ecx
    xorl    %edx, %edx
    xorl    %r9d, %r9d
    xorl    %r10d, %r10d
    xorl    %r11d, %r11d
    movq    %rdi, %r8
    movq    %rsi, %rax
    xorl    %esi, %esi
    xorl    %edi, %edi
{BEGIN}:
    .rept TC_SPIN_COUNT
    {instruction}
    .endr
{END}:
    cmpq    %r15, %rsp
    jne     .Ltc_candidate_stack_moved
    movq    %r8, %rax
    cld
    popq    %r15
    popq    %r14
    popq    %r13
    popq    %r12
    popq    %rbp
    popq    %rbx
    ret
.Ltc_candidate_stack_moved:
    ud2
    .size tc_candidate, .-tc_candidate
    .section .note.GNU-stack,\"\",@progbits
"""


def _objdump(obj: Path) -> list[tuple[str, str]]:
    """Disassemble to ``(kind, value)`` rows in address order."""
    result = subprocess.run(
        ["objdump", "-d", "--no-show-raw-insn", str(obj)],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        raise CandidateFormatError("the submission could not be disassembled")

    rows: list[tuple[str, str]] = []
    for line in result.stdout.splitlines():
        label = re.match(r"^[0-9a-f]+ <([^>]+)>:", line.strip())
        if label is not None:
            rows.append(("label", label.group(1)))
            continue
        body = re.match(r"^\s+[0-9a-f]+:\s+(.+?)\s*$", line)
        if body is not None:
            rows.append(("instruction", body.group(1)))
    return rows


def _measured_region(rows: list[tuple[str, str]]) -> list[str]:
    inside = False
    found_begin = False
    found_end = False
    region: list[str] = []
    for kind, value in rows:
        if kind == "label" and value == BEGIN:
            if found_begin:
                raise CandidateFormatError(f"the fixed wrapper contains more than one {BEGIN} marker")
            inside, found_begin = True, True
            continue
        if kind == "label" and value == END:
            if not inside or found_end:
                raise CandidateFormatError(f"the fixed wrapper contains an invalid {END} marker")
            inside = False
            found_end = True
            continue
        if inside and kind == "instruction":
            region.append(value)
    if not found_begin or not found_end or inside:
        raise CandidateFormatError("the author-owned measured-region markers are incomplete")
    return region


def _reject_relocations(obj: Path) -> None:
    """A participant instruction must be fully resolved inside its safe wrapper."""
    result = subprocess.run(
        ["objdump", "-r", str(obj)],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        raise CandidateFormatError("the submission's relocations could not be inspected")
    if re.search(r"^\s*[0-9a-fA-F]+\s+R_", result.stdout, re.MULTILINE):
        raise CandidateFormatError("external symbols and relocations are not allowed")


def _operands(assembly: str) -> list[str]:
    """Split objdump's AT&T operands without splitting an address tuple."""
    _, separator, text = assembly.partition(" ")
    if not separator:
        return []

    operands: list[str] = []
    start = 0
    depth = 0
    for index, character in enumerate(text):
        if character in "([{":
            depth += 1
        elif character in ")]}" and depth:
            depth -= 1
        elif character == "," and depth == 0:
            operands.append(text[start:index].strip())
            start = index + 1
    operands.append(text[start:].strip())
    return [operand for operand in operands if operand]


def _is_memory_operand(operand: str) -> bool:
    """Registers and immediates are explicit; every other AT&T operand is memory."""
    return not operand.startswith(("%", "$"))


def _is_allowed_scalar_integer_mnemonic(mnemonic: str) -> bool:
    """Recognize only the reviewed scalar-integer subset used by this MVP."""
    return mnemonic in _ALLOWED_SCALAR_MNEMONICS | _ALLOWED_CONDITIONAL_INTEGER


def _unsupported_registers(assembly: str) -> list[str]:
    """Return every explicit register outside the reviewed integer GPR class."""
    return [
        token
        for token in _REGISTER_TOKEN.findall(assembly)
        if token[1:].lower() not in _GPR_NAMES
    ]


def _validate_region(region: list[str]) -> None:
    if len(region) != SPIN_COUNT:
        raise CandidateFormatError(
            f"the submitted line assembled to {len(region)} machine instructions in the fixed region; "
            f"the contract requires exactly {SPIN_COUNT} copies of one instruction"
        )

    normalized_region = [" ".join(assembly.split()) for assembly in region]
    if len(set(normalized_region)) != 1:
        raise CandidateFormatError(
            "the submitted line did not assemble to identical instruction copies"
        )

    mnemonics = [assembly.split(None, 1)[0].lower() for assembly in normalized_region]
    if len(set(mnemonics)) != 1:
        raise CandidateFormatError("the submitted line did not assemble to one repeatable instruction")
    mnemonic = mnemonics[0]
    if mnemonic.startswith(CONTROL_FLOW_PREFIXES):
        raise CandidateFormatError(
            f"'{mnemonic}' is control flow; repetition belongs to the fixed wrapper"
        )
    if (
        mnemonic in FORBIDDEN
        or "gather" in mnemonic
        or "scatter" in mnemonic
    ):
        raise CandidateFormatError(
            f"'{mnemonic}' is not allowed; the harness owns the clock, scheduler, "
            "cache preparation, call frame, and process state"
        )
    if not _is_allowed_scalar_integer_mnemonic(mnemonic):
        raise CandidateFormatError(
            f"'{mnemonic}' is outside the reviewed scalar-integer instruction set"
        )
    for assembly in normalized_region:
        if _STACK_REGISTER.search(assembly) or _INSTRUCTION_POINTER.search(assembly):
            raise CandidateFormatError("the assembled instruction reaches wrapper-owned memory")
        if _RESERVED_REGISTER.search(assembly):
            raise CandidateFormatError("the assembled instruction uses the wrapper-reserved %r15")
        if _PRIVILEGED_REGISTER.search(assembly):
            raise CandidateFormatError("the assembled instruction uses a privileged register")
        if _SEGMENT_REGISTER.search(assembly):
            raise CandidateFormatError("the assembled instruction uses segment-register addressing")
        unsupported = _unsupported_registers(assembly)
        if unsupported:
            raise CandidateFormatError(
                "the assembled instruction may use only scalar general-purpose integer "
                f"registers, not {', '.join(unsupported)}"
            )
        operands = _operands(assembly)
        memory_operands = [operand for operand in operands if _is_memory_operand(operand)]
        if memory_operands and (
            _is_memory_operand(operands[-1])
            or mnemonic.startswith(MEMORY_MUTATING_PREFIXES)
        ):
            raise CandidateFormatError(
                "the assembled instruction may not write to memory; memory may only be "
                "a read-only source with an explicit register destination"
            )
        if any(operand != "(%r8)" for operand in memory_operands):
            raise CandidateFormatError(
                "a memory read may only use the author-owned arena entry at (%r8)"
            )
        if memory_operands and mnemonic in {"cmp", "test"}:
            raise CandidateFormatError(
                "a memory read must place its result in an explicit general-purpose register"
            )


def build_candidate_object(source: str, output: Path) -> None:
    """Assemble and validate the only participant-derived executable bytes.

    Callers link ``output`` and never the participant's original ``candidate.S``.
    This is the single build boundary used by public tests, Workbench, and the
    hidden verifier.
    """
    output = Path(output)
    generated = output.with_suffix(".generated.S")
    generated.write_text(render_candidate(source), encoding="utf-8")
    assemble = subprocess.run(
        ["gcc", "-I", str(_HEADER.parent), "-c", "-o", str(output), str(generated)],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if assemble.returncode != 0:
        raise CandidateFormatError("the instruction does not assemble:\n" + assemble.stderr[-2000:])

    _reject_relocations(output)
    _validate_region(_measured_region(_objdump(output)))
