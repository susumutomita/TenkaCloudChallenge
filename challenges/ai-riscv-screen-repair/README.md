# Repair the AI-Built RISC-V Screen

The RV32I core from Level 1 finally boots. The previous engineer then added a
screen controller, declared that the RTL compiled, and left before the demo.
The firmware runs, but the video timing is short, neighboring pixels disappear,
and nobody can explain how the control bit crosses into the pixel clock.

Repair the integration decisions in `local/solution/video_controller.sv`. The
specification was written before the RTL; observable protocol, timing, and pixel
state are the evidence. Do not rewrite the CPU or weaken the testbench.

## What runs

This separate Level 2 Challenge reuses a fixed copy of the repaired Level 1
RV32I core and adds:

- a 16 × 12 byte-addressed framebuffer filled by bare-metal firmware;
- memory-mapped CONTROL and STATUS registers;
- independent CPU and pixel clocks with domain-local reset release;
- active-low raster sync with active area and porch intervals;
- request/acknowledge-toggle control CDC;
- a deterministic PPM frame capture; and
- a loopback lab plus state-based TenkaCloud `/verify` endpoint.

The raster is intentionally tiny, but its exclusive totals use the same
active/porch/sync counting rule as VGA or HDMI timing. There is no physical FPGA,
display, serializer, or video PHY.

## Run the failing baseline

From this directory:

```bash
make test
```

Docker builds a pinned Debian environment containing Verilator and the RISC-V
GNU toolchain. It compiles the inherited controller and runs independent
assertions for three defect classes:

```text
CDC_ASSERT_FAIL ...
TIMING_ASSERT_FAIL ...
WRITE_STROBE_ASSERT_FAIL ...
```

Read these contracts before editing:

- [`artifacts/architecture.md`](./artifacts/architecture.md)
- [`artifacts/memory-map.md`](./artifacts/memory-map.md)
- [`artifacts/ai-design-log.md`](./artifacts/ai-design-log.md)
- [`artifacts/verification-boundary.md`](./artifacts/verification-boundary.md)
- [`artifacts/toolchain.md`](./artifacts/toolchain.md)

Then edit only `local/solution/video_controller.sv` and rerun `make test`. The
regression observes request-to-acknowledge latency, sync pulses, active-video
state, every firmware-written pixel, and the exact frame digest. It does not
grade parameter names or source text.

A successful run ends with:

```text
SIM_PASS cdc_edges=3 frame_clocks=352 active_pixels=192
FRAME_SHA256 <deterministic digest>
```

The artifact is `local/build/frame.ppm`. The browser lab can rerun and download
the same frame. Submit `VERIFY` in TenkaCloud only after the mounted participant
RTL passes; `/verify` recompiles it and delegates the verdict from live state.

## Docker and Codespaces

Use `make local PROBLEM=ai-riscv-screen-repair` from the TenkaCloud platform root
to open the browser lab. GitHub Codespaces uses the platform's Docker-in-Docker
development container and the same compose file and commands. No host compiler,
USB device, privileged container, FPGA, or display is required. Ports 18200 and
18201 bind only to `127.0.0.1`.

Maintainers can prove the intended red-to-green path with `make red-green`. The
golden wrapper is stored outside the problem's Docker build context and is never
included in the participant image.

## Scoring and learning

This is a hard (difficulty 5), 120–150 minute Challenge worth 300 points. A wrong
submission costs 15 points. Three progressive hints cost 30, 45, and 75 points.
The post-solve write-up connects each symptom to a general boundary: synchronizer
latency and handshake, exclusive counter totals, and bus byte enables.

Level 1 is the conceptual prerequisite and remains a separate, unchanged
Challenge: [`ai-riscv-soc-repair`](../ai-riscv-soc-repair/README.md).

## Verification boundary and cost

Simulation proves register behavior, the declared digital CDC protocol, raster
timing, generated pixels, and deterministic artifact bytes. It does not prove
electrical HDMI behavior, metastability MTBF, constraints, synthesis or
place-and-route timing, pin behavior, or board output. Those require the later
hardware verification listed in `artifacts/verification-boundary.md`.

The exercise uses bounded local Docker CPU and memory only and creates no AWS
resource. Stop the lab with `make down`.
