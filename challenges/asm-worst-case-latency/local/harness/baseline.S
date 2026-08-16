#include "arena.h"

/* The fixed comparison point. Author-owned: the participant's score is their
 * candidate divided by this, measured on the same host in the same run, so a
 * fast machine and a slow machine agree on the answer even though they disagree
 * on the cycle counts.
 *
 * A dependent chain of `addq`: each add waits for the previous one, so this
 * measures add's latency rather than the several adds per cycle the machine
 * could retire if they were independent.
 */

    .text
    .globl tc_baseline
    .type tc_baseline, @function
tc_baseline:
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
    .rept TC_SPIN_COUNT
    addq    $1, %rax
    .endr
    cmpq    %r15, %rsp
    jne     .Ltc_baseline_stack_moved
    movq    %r8, %rax
    cld
    popq    %r15
    popq    %r14
    popq    %r13
    popq    %r12
    popq    %rbp
    popq    %rbx
    ret
.Ltc_baseline_stack_moved:
    ud2
    .size tc_baseline, .-tc_baseline
    .section .note.GNU-stack,"",@progbits
