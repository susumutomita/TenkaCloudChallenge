"""Break the grader one layer at a time and require the next layer to notice.

The defence here is deliberately layered: text rules on the decoded instruction,
then the author-owned frame the instruction is spliced into (`harness/wrapper.S.in`),
then the memory the frame leaves reachable (`harness/arena.c` maps the arena
read-only). Attributing a refusal to a single guard would therefore be a lie —
several of these are refused twice over.

So each case names its layers in order. Every layer is disabled in turn, and the
case must stay refused with a *different* reason each time: a layer that does not
change the reason was shadowed by the one above it and was never load-bearing.
When the last named layer is disabled the case must get through, which is what
proves the list is the whole defence rather than a comfortable subset of it.

`FRAME` is the layer that cannot be disabled from Python. It refuses with a
signal rather than a message, and it is why the text rules are a contract instead
of an enumeration.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

sys.path.insert(0, str(Path(__file__).resolve().parent / "harness"))

import splice
from tests.hidden import check_candidate as grader
from tests.hidden.check_candidate import Rejected

SEED = 20260816

#: The layer that is not a Python function: the frame's zeroed registers, its
#: read-only arena, and its refusal to return through a stack it did not leave.
FRAME = "the frame itself"

TEMPLATE = """    .text
    .globl tc_candidate
tc_candidate:
    movq %rdi, %r8
    movq %rsi, %rax
tc_measured_begin:
{body}
tc_measured_end:
    ret
    .section .note.GNU-stack,"",@progbits
"""


#: The verdict-spoofing case, kept apart because it would not merely score a bad
#: answer but replace the measurement outright. See `self_contained`.
SPOOF = r"""
    .section .rodata
fake:
    .ascii "{\"seed\":1,\"spins\":64,\"samples\":101,"
    .ascii "\"baseline\":{\"robustCycles\":1,\"kept\":101,\"rejected\":0},"
    .ascii "\"candidate\":{\"robustCycles\":9999,\"kept\":101,\"rejected\":0},"
    .ascii "\"normalizedScore\":9999.0,\"checksum\":\"0\"}
"
fake_end:
    .text
handler:
    subq    $8, %rsp
    leaq    fake(%rip), %rsi
    movl    $1, %edi
    movl    $fake_end-fake, %edx
    call    write@PLT
    xorl    %edi, %edi
    call    _exit@PLT
    .globl tc_candidate
tc_candidate:
    pushq   %rbx
    movq    %rsi, %rbx
    leaq    handler(%rip), %rdi
    call    atexit@PLT
    movq    %rbx, %rax
    movl    $64, %ecx
1:
tc_measured_begin:
    addq    $1, %rax
tc_measured_end:
    decl    %ecx
    jnz     1b
    popq    %rbx
    ret
    .section .note.GNU-stack,"",@progbits
"""

#: A submission the grader must accept, and the property its acceptance proves.
#: These are the other half of the argument: a boundary that refuses everything
#: is not a boundary, it is a wall.
ACCEPTED = [
    ("clobbering a callee-saved register does not corrupt the harness",
     "movq %rax, %rbx",
     lambda score: score <= 2.0),
    ("clobbering every callee-saved register does not corrupt the harness",
     "xorq %r15, %r15",
     lambda score: score <= 2.0),
    # If the repeat count still lived in a register, writing zero to it would cut
    # the measured region short and the score would collapse towards 1/64.
    ("writing to %ecx cannot cut the repeat count short",
     "movl $0, %ecx",
     lambda score: score > 0.5),
]

#: (name, submission, the layers that refuse it, outermost first)
CASES = [
    ("more than one instruction in the measured region",
     TEMPLATE.format(body="    movq (%r8), %r8\n    addq $1, %rax"),
     ("measured_source", "decoded_form", "exactly_one_instruction")),
    ("an empty measured region",
     TEMPLATE.format(body=""),
     ("measured_source", "decoded_form", "exactly_one_instruction")),
    ("control flow as the measured instruction",
     TEMPLATE.format(body="    jmp 2f\n2:"),
     ("measured_source", "check_no_directive", "check_operands", "exactly_one_instruction")),
    ("a syscall inside the measured region",
     TEMPLATE.format(body="    syscall"),
     ("self_contained", "no_forbidden_instruction")),
    ("the candidate reading the clock itself",
     TEMPLATE.format(body="    rdtsc"),
     ("self_contained", "no_forbidden_instruction")),
    ("a stall instruction standing in for work",
     TEMPLATE.format(body="    pause"),
     ("self_contained", "no_forbidden_instruction")),
    ("the candidate flushing its own cache line",
     TEMPLATE.format(body="    clflush (%r8)"),
     ("check_operands", "self_contained", "no_forbidden_instruction")),
    ("a privileged instruction",
     TEMPLATE.format(body="    hlt"),
     ("self_contained", "no_forbidden_instruction", FRAME)),
    # The advertised operand contract: what the participant is told the one
    # instruction may touch.
    ("a store into harness memory",
     TEMPLATE.format(body="    movq %rax, (%r8)"),
     ("check_operands", FRAME)),
    ("a read through the stack pointer",
     TEMPLATE.format(body="    movq (%rsp), %rax"),
     ("check_operands",)),
    ("a read of the frame pointer",
     TEMPLATE.format(body="    movq %rbp, %rax"),
     ("check_operands",)),
    ("an indirect branch out of the measured region",
     TEMPLATE.format(body="    jmp *%rax"),
     ("check_operands", "exactly_one_instruction", FRAME)),
    # The ways an instruction writes memory without an operand that says so.
    # These are why the contract is checked on the decoded form and why the frame
    # exists: the text rules alone would not see any of them.
    ("an encoding smuggled in as raw bytes",
     TEMPLATE.format(body="    .byte 0x90"),
     ("check_no_directive",)),
    # The one the decoded-form check exists for: the text rules see a directive,
    # and once that is gone what they would see is a byte list. The assembler is
    # asked what it built, and the answer is a store through %rsp.
    ("a store encoded as raw bytes",
     TEMPLATE.format(body="    .byte 0x48,0x89,0x04,0x24"),
     ("check_no_directive", "check_operands", FRAME)),
    # One line is not one statement: GAS separates them on ';', and a directive
    # riding along behind an instruction reaches the frame as data the
    # disassembler never looks at. A constructor placed this way runs before the
    # harness, outside the region, with none of the frame's guarantees.
    ("a constructor smuggled in behind the instruction",
     TEMPLATE.format(body='    nop; .section .init_array,"aw"; .quad tc_candidate'),
     ("check_no_directive", FRAME)),
    ("an implicit stack write",
     TEMPLATE.format(body="    pushq %rax"),
     ("check_operands", FRAME)),
    ("a string store to its implicit destination",
     TEMPLATE.format(body="    stosq"),
     ("check_operands", FRAME)),
    ("a masked store to its implicit destination",
     TEMPLATE.format(body="    maskmovdqu %xmm0, %xmm1"),
     ("check_operands", FRAME)),
    ("a symmetric instruction writing through its first operand",
     TEMPLATE.format(body="    xchg %rax, (%r8)"),
     ("check_operands", FRAME)),
]


def _region_verbatim(submission: str) -> str:
    """`measured_source` with only its one-instruction rule removed.

    Disabling a guard has to remove the property and nothing else. Replacing the
    extraction outright would hand the next layer nothing to judge, and a layer
    that refuses an empty hand has not been tested.
    """
    lines = submission.splitlines()
    marks = [index for index, line in enumerate(lines) if line.strip() in ("tc_measured_begin:", "tc_measured_end:")]
    return "\n".join(line.strip() for line in lines[marks[0] + 1 : marks[1]] if line.strip())


#: How a layer is removed. The default stand-in returns None, which is right for a
#: check: it decides nothing. A layer that also produces a value needs one that
#: keeps producing it.
STAND_IN = {"measured_source": _region_verbatim}


def refusal(source: str) -> str | None:
    """The reason the grader gives, or None if it graded the submission."""
    try:
        grader.grade(source, SEED)
        return None
    except Rejected as error:
        return str(error)


def check_layers(name: str, source: str, layers: tuple[str, ...]) -> bool:
    restored: list[tuple[object, str, object]] = []
    seen: list[str] = []
    try:
        for layer in layers:
            gone = ", ".join(entry[1] for entry in restored) or "nothing"
            reason = refusal(source)
            if reason is None:
                print(f"SURVIVED {name}: nothing refused it with {gone} disabled")
                return False
            if reason in seen:
                print(f"SURVIVED {name}: {layer} never refused it; the layer above shadows it")
                return False
            seen.append(reason)
            if layer == FRAME:
                print(f"killed {name} (down to {FRAME}: {reason.splitlines()[0][:70]})")
                return True
            holder = splice if hasattr(splice, layer) else grader
            restored.append((holder, layer, getattr(holder, layer)))
            setattr(holder, layer, STAND_IN.get(layer, lambda *args, **kwargs: None))

        # Every named layer is gone. The submission must now get through: if
        # something unnamed still refuses it, the list above is not the defence.
        leftover = refusal(source)
        if leftover is not None:
            print(f"SURVIVED {name}: refused by something its layers do not name ({leftover[:60]})")
            return False
    finally:
        for holder, layer, original in restored:
            setattr(holder, layer, original)

    print(f"killed {name} (by {' then '.join(layers)})")
    return True


def main() -> int:
    here = Path(__file__).parent
    reference = (here / "reference" / "candidate.S").read_text(encoding="utf-8")
    starter = (here / "starter" / "candidate.S").read_text(encoding="utf-8")

    result = grader.grade(reference, SEED)
    if result["normalizedScore"] < 10.0:
        print(f"the reference only reached {result['normalizedScore']:.1f}x the baseline")
        return 1
    print(f"reference: {result['normalizedScore']:.1f}x the baseline")

    starter_result = grader.grade(starter, SEED)
    if starter_result["normalizedScore"] > 2.0:
        print(f"the starter already scores {starter_result['normalizedScore']:.1f}x: no gap to close")
        return 1
    print(f"starter:   {starter_result['normalizedScore']:.2f}x the baseline")

    try:
        spoofed = grader.grade(SPOOF, SEED)["normalizedScore"]
    except Rejected:
        spoofed = None
    if spoofed is None or spoofed > 2.0:
        print(f"SURVIVED the verdict-fabricating payload reached the run (score {spoofed})")
        return 1
    print(f"neutralised the verdict-fabricating payload: it scores {spoofed:.2f}, not 9999")

    failures: list[str] = []
    for name, body, holds in ACCEPTED:
        try:
            score = grader.grade(TEMPLATE.format(body="    " + body), SEED)["normalizedScore"]
        except Rejected as error:
            print(f"REFUSED  {name}: {error}")
            failures.append(name)
            continue
        if not holds(score):
            print(f"BROKEN   {name}: scored {score:.2f}")
            failures.append(name)
            continue
        print(f"held     {name} (scored {score:.2f})")

    for name, source, layers in CASES:
        if not check_layers(name, source, layers):
            failures.append(name)

    if failures:
        print(f"{len(failures)} propert(ies) did not hold")
        return 1
    print(f"all {len(CASES)} mutations killed, all {len(ACCEPTED)} accepted properties held.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
