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
    movq    %rsi, %rax              /* seed: keeps the chain from being constant-folded */
    movl    $64, %ecx               /* TC_SPIN_COUNT */
1:
    addq    $1, %rax
    decl    %ecx
    jnz     1b
    ret
    .size tc_baseline, .-tc_baseline
    .section .note.GNU-stack,"",@progbits
