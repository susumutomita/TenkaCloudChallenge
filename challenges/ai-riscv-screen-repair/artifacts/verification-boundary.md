# Verification and hardware handoff boundary

## Proven in Docker/Verilator

- the fixed RV32I core executes the firmware's byte and word MMIO operations;
- VIDEO_CONTROL follows the specified request/acknowledge toggle protocol;
- pixel-domain reset remains asserted for the required local edges;
- horizontal and vertical periods, active region, and sync pulses match the
  pre-RTL table;
- byte write strobes preserve neighboring framebuffer pixels; and
- the generated active-frame PPM has the committed deterministic SHA-256.

The delegated `/verify` endpoint recompiles the mounted participant RTL and
derives its verdict only from these runtime observations. It does not inspect
parameter names or accept a source-text signature as proof.

## Not proven by this Challenge

Verilator cannot establish electrical HDMI behavior, serializer/PHY behavior,
clock jitter, metastability MTBF, FPGA timing closure, pin constraints,
signal-integrity margins, or a physical display image. A board implementation
must separately run synthesis and place-and-route timing, CDC/RDC structural
analysis, constraint review, PHY compliance, and on-board capture. Passing this
Challenge must not be reported as those hardware checks.
