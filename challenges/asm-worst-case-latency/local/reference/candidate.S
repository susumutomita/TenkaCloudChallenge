/* Reference solution: one load that follows the ring.
 *
 * The instruction is `movq (%r8), %r8` — a single load, no control flow, no
 * privileged anything. What makes it slow is not the opcode but the address:
 * each iteration's address is the value the previous load returned, so the
 * machine cannot start the next load until this one has come back. The ring is
 * 64 MiB and shuffled, so "come back" means a trip to DRAM, every time, with no
 * prefetcher able to guess ahead and no overlap between iterations.
 *
 * Measured on the reference host: ~2.4 cycles for the starter's add, ~690 for
 * this. Same instruction count, same loop, ~290x the time.
 */

    .text
    .globl tc_candidate
    .type tc_candidate, @function
tc_candidate:
    movq    %rdi, %r8               /* setup: the ring head */
    movq    %rsi, %rax
    movl    $64, %ecx
1:
tc_measured_begin:
    movq    (%r8), %r8              /* the dependent load: address = last result */
tc_measured_end:
    decl    %ecx
    jnz     1b
    movq    %r8, %rax               /* return what we chased, so it cannot vanish */
    ret
    .size tc_candidate, .-tc_candidate
    .section .note.GNU-stack,"",@progbits
