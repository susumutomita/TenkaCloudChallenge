/* Reference solution: one load that follows the ring.
 *
 * The instruction is `movq (%r8), %r8` — a single load, no control flow, no
 * privileged anything, nothing written to memory. What makes it slow is not the
 * opcode but the address: each repeat's address is the value the previous load
 * returned, so the machine cannot start the next load until this one has come
 * back. The ring is 64 MiB and shuffled, so "come back" means a trip to DRAM,
 * every time, with no prefetcher able to guess ahead and no overlap between
 * repeats.
 *
 * The baseline is the same frame around `addq $1, %rax`, so the ratio is the two
 * instructions and nothing else: same prologue, same unrolled repeat, same
 * epilogue. Measured on the reference host: ~1 cycle for the add, ~200 for this.
 */

    .text
    .globl tc_candidate
    .type tc_candidate, @function
tc_candidate:
    movq    %rdi, %r8               /* the frame does this for you */
    movq    %rsi, %rax
tc_measured_begin:
    movq    (%r8), %r8              /* the dependent load: address = last result */
tc_measured_end:
    movq    %r8, %rax
    ret
    .size tc_candidate, .-tc_candidate
    .section .note.GNU-stack,"",@progbits
