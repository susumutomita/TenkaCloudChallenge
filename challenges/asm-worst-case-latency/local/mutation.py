"""Break the grader eight ways and require its own properties to notice.

Each mutation removes one guarantee the grader claims to enforce, and a
submission that the intact grader rejects is used to prove the guarantee was
load-bearing. A mutation that nothing catches means the property was decoration.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden import check_candidate as grader
from tests.hidden.check_candidate import Rejected

SEED = 20260816

TEMPLATE = """    .text
    .globl tc_candidate
tc_candidate:
    movq %rdi, %r8
    movq %rsi, %rax
    movl $64, %ecx
1:
tc_measured_begin:
{body}
tc_measured_end:
    decl %ecx
    jnz 1b
    ret
    .section .note.GNU-stack,"",@progbits
"""


#: The verdict-spoofing case, kept here because it is the one that would not merely
#: score a bad answer but replace the measurement outright. See `self_contained`.
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

#: (name, what the intact grader must refuse, how the mutant breaks it)
CASES = [
    ("accepts more than one instruction in the measured region",
     TEMPLATE.format(body="    movq (%r8), %r8\n    addq $1, %rax"),
     "exactly_one_instruction"),
    ("accepts an empty measured region",
     TEMPLATE.format(body=""),
     "exactly_one_instruction"),
    ("accepts control flow as the measured instruction",
     TEMPLATE.format(body="    jmp 2f\n2:"),
     "exactly_one_instruction"),
    ("accepts a syscall inside the measured region",
     TEMPLATE.format(body="    syscall"),
     "no_forbidden_instruction"),
    ("accepts the candidate reading the clock itself",
     TEMPLATE.format(body="    rdtsc"),
     "no_forbidden_instruction"),
    ("accepts a stall instruction standing in for work",
     TEMPLATE.format(body="    pause"),
     "no_forbidden_instruction"),
    ("accepts the candidate flushing its own cache line",
     TEMPLATE.format(body="    clflush (%r8)"),
     "no_forbidden_instruction"),
    ("accepts a privileged instruction",
     TEMPLATE.format(body="    hlt"),
     "no_forbidden_instruction"),
    ("lets a submission fabricate the verdict instead of earning it",
     SPOOF,
     "self_contained"),
]


def rejects(source: str) -> bool:
    try:
        grader.grade(source, SEED)
        return False
    except Rejected:
        return True


def main() -> int:
    reference = (Path(__file__).parent / "reference" / "candidate.S").read_text(encoding="utf-8")
    starter = (Path(__file__).parent / "starter" / "candidate.S").read_text(encoding="utf-8")

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

    survivors: list[str] = []
    for name, source, guard in CASES:
        if not rejects(source):
            print(f"SURVIVED {name}")
            survivors.append(name)
            continue

        # ...and the rejection must come from the named guard, not by accident.
        original = getattr(grader, guard)
        setattr(grader, guard, lambda *args, **kwargs: None)
        try:
            still_rejected = rejects(source)
        finally:
            setattr(grader, guard, original)

        if still_rejected and guard == "no_forbidden_instruction":
            # A forbidden instruction may also fail to assemble or to run; that is
            # not the property under test, so the mutation did not prove anything.
            print(f"killed {name} (also caught outside {guard})")
        elif still_rejected:
            print(f"SURVIVED {name}: {guard} was not what refused it")
            survivors.append(name)
        else:
            print(f"killed {name} (by {guard})")

    if survivors:
        print(f"{len(survivors)} mutation(s) survived")
        return 1
    print(f"all {len(CASES)} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
