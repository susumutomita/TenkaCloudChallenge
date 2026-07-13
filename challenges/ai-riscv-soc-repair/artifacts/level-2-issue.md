# Draft follow-up issue: Level 2 screen-controller repair

Tracked as TenkaCloudChallenge #184:

<https://github.com/susumutomita/TenkaCloudChallenge/issues/184>

This document keeps the implementation boundary and acceptance criteria close
to the Level 1 problem source.

## Suggested title

`feat(problem): extend AI RISC-V SoC repair to simulated screen output`

## Scope

Add a separate Challenge after Level 1 is stable. Reuse the repaired RV32I core,
then introduce a memory-mapped video controller and a second pixel-clock domain.
The goal is to change a test pattern from firmware and prove
VGA/HDMI-equivalent timing entirely in simulation.

## Acceptance criteria

- Define pixel timing, register map, reset sequencing, and CDC strategy before RTL.
- Add red tests for one CDC defect, one horizontal/vertical off-by-one defect,
  and one framebuffer write-strobe defect.
- The initial design compiles but fails at least one timing/pixel assertion.
- The repaired design produces a deterministic frame artifact and passes all
  assertions.
- Run in Docker/Verilator and Codespaces without a physical FPGA or display.
- Keep real HDMI PHY, board constraints, synthesis timing, and Motion JPEG out
  of scope.
- Ship bilingual problem text, hints, write-up, and state-based delegated verification.

## External verification boundary

Simulation can prove register behavior, CDC protocol assertions, and generated frame
pixels. Electrical HDMI behavior, place-and-route timing, and board output
require a later hardware-specific issue and cannot be claimed by this follow-up.
