  .option norvc
  .option norelax
  .section .text.start
  .globl _start

/*
 * Reuse the repaired Level 1 CPU to fill a 16x12 indexed framebuffer through
 * byte stores. Four isolated overrides make neighboring-lane corruption easy
 * to observe. Enable scanout only after every pixel is stable.
 */
_start:
  lui t0, 0x10002
  addi t1, zero, 0
  addi t2, zero, 0x11
  addi t3, zero, 192
fill_loop:
  sb t2, 0(t0)
  addi t0, t0, 1
  addi t1, t1, 1
  addi t2, t2, 13
  bne t1, t3, fill_loop

  lui t0, 0x10002
  addi t1, zero, 0xe1
  sb t1, 1(t0)
  addi t1, zero, 0x42
  sb t1, 66(t0)
  addi t1, zero, 0x7f
  sb t1, 127(t0)
  addi t1, zero, 0xbc
  sb t1, 188(t0)

  lui t0, 0x10001
  addi t1, zero, 1
  sw t1, 0(t0)
wait_for_video_status:
  lw t2, 4(t0)
  andi t2, t2, 3
  bne t2, t1, wait_for_video_status

  lui t0, 0x10000
  addi t0, t0, 4
  sw t1, 0(t0)
halt:
  jal zero, halt
