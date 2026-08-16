/* The one file you edit.
 *
 * Contract
 * --------
 *   tc_candidate(void *arena, uint64_t seed) -> uint64_t
 *     %rdi  the arena: the head of a 64 MiB pointer ring. Each 64-byte line
 *           holds the address of another line, in an order chosen by the seed.
 *     %rsi  the seed.
 *     %rax  whatever your instruction produced. Return it — the harness folds
 *           it into a checksum so nothing here can be optimised away.
 *
 * Between the label `tc_measured_begin` and `tc_measured_end` you may place
 * **exactly one** instruction, and the loop repeats it 64 times. Everything
 * outside that region is setup and is not measured.
 *
 * The rules the grader enforces on the measured region:
 *   - exactly one instruction, and it is not control flow (no jmp/call/ret/loop)
 *   - no syscall, no privileged instruction, no rdtsc family of your own
 *   - no sleep, no signal games, no self-modifying code
 * Break any of them and the checkpoint fails before the timing is even read.
 *
 * This starter is correct and honest: it adds one. It is also the fastest thing
 * the machine can do, so it scores 1.0 — exactly the baseline. That is the
 * point. Your job is to find an instruction the machine hates.
 */

    .text
    .globl tc_candidate
    .type tc_candidate, @function
tc_candidate:
    movq    %rdi, %r8               /* setup: the arena head, yours to use */
    movq    %rsi, %rax              /* setup: the seed */
    movl    $64, %ecx
1:
tc_measured_begin:
    addq    $1, %rax
tc_measured_end:
    decl    %ecx
    jnz     1b
    ret
    .size tc_candidate, .-tc_candidate
    .section .note.GNU-stack,"",@progbits
