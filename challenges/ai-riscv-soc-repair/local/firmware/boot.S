  .option norvc
  .option norelax
  .section .text.start
  .globl _start

/*
 * The firmware is also the integration oracle. It checks three CPU contracts
 * before printing anything: reset starts at address zero, JAL writes pc+4 to
 * rd, and LB sign-extends bit 7. A failure writes 2 to TOHOST; success prints
 * the generated per-run flag and writes 1.
 */
_start:
  jal zero, boot
reset_guard:
  jal zero, reset_guard

boot:
  addi s0, zero, 0
  jal ra, link_probe
  addi s0, zero, 1
link_resume:
  addi t0, zero, 1
  bne s0, t0, fail

  la t0, signed_probe
  lb t1, 0(t0)
  addi t2, zero, -128
  bne t1, t2, fail

  la a0, boot_message
  jal ra, puts

  lui t0, 0x10000
  addi t0, t0, 8
  addi t1, zero, 165
  sw t1, 0(t0)

  lui t0, 0x10000
  addi t0, t0, 4
  addi t1, zero, 1
  sw t1, 0(t0)
success_halt:
  jal zero, success_halt

link_probe:
  jalr zero, 0(ra)

puts:
  lbu a1, 0(a0)
  beq a1, zero, puts_done
  lui t0, 0x10000
  sb a1, 0(t0)
  addi a0, a0, 1
  jal zero, puts
puts_done:
  jalr zero, 0(ra)

fail:
  lui t0, 0x10000
  addi t0, t0, 4
  addi t1, zero, 2
  sw t1, 0(t0)
fail_halt:
  jal zero, fail_halt

  .section .rodata
signed_probe:
  .byte 0x80
