/* The one file you edit.
 *
 * Between the label `tc_measured_begin` and `tc_measured_end` you place
 * **exactly one** instruction. That line is the only thing that runs: the
 * grader lifts it out and splices it into the harness's own frame, which sets
 * up the registers, repeats your instruction 64 times, and returns. Everything
 * else in this file — including the setup lines you can see — is yours to read
 * and scribble on, and none of it is assembled. That is deliberate: your code
 * shares a process with the thing measuring it, so the measurement cannot also
 * be yours to touch.
 *
 * What your instruction is handed
 * -------------------------------
 *   %r8   the arena: a 64 MiB pointer ring. Each 64-byte line holds the address
 *         of another line, in an order chosen by the seed. Mapped read-only.
 *   %r9   the seed.
 *   %rax  a running value; the frame returns it, so nothing you do is dead code.
 *
 * Every other register is zero when your instruction starts. There is no loop
 * counter to find: the frame unrolls the repeat rather than counting it.
 *
 * The rules the grader enforces, on the instruction as the assembler decodes it
 * rather than as you spell it:
 *   - exactly one instruction, written out — no assembler directives, so no
 *     `.byte`, and no label
 *   - not control flow (no jmp/call/ret/loop, direct or indirect)
 *   - no syscall, no privileged instruction, no rdtsc family of your own
 *   - nothing naming %rsp or %rbp, and no writing to memory: it may read memory
 *     freely, but its result has to land in a register
 * Break any of them and the checkpoint fails before the timing is even read.
 *
 * This starter is correct and honest: it adds one. It is also the fastest thing
 * the machine can do, so it scores 1.0 — exactly the baseline, which is the same
 * frame around the same instruction. That is the point. Your job is to find an
 * instruction the machine hates.
 */

    .text
    .globl tc_candidate
    .type tc_candidate, @function
tc_candidate:
    movq    %rdi, %r8               /* the frame does this for you */
    movq    %rsi, %rax
tc_measured_begin:
    addq    $1, %rax
tc_measured_end:
    ret
    .size tc_candidate, .-tc_candidate
    .section .note.GNU-stack,"",@progbits
