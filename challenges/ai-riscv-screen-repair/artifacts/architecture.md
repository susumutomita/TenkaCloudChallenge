# Level 2 screen architecture

This specification predates the RTL. Treat it as the contract, not as a
description reverse-engineered from the inherited implementation.

## Reused Level 1 boundary

The repaired Level 1 RV32I core is copied as a fixed, non-participant-owned
component. It retains reset vector `0x00000000`, `pc + 4` JAL links, and signed
`LB`. Level 2 adds no instructions, caches, interrupts, or privilege modes.

```text
RV32I firmware -- MMIO + byte writes --> framebuffer/control (CPU clock)
                                           |
                                 request/acknowledge toggle CDC
                                           |
                                           v
                                raster scan + pixel output (pixel clock)
                                           |
                                           `--> deterministic frame.ppm
```

## Pixel timing contract

The deliberately small raster keeps simulation fast while preserving the same
counting rules as VGA or HDMI video timing.

| Interval | Horizontal pixels | Vertical lines |
| --- | ---: | ---: |
| Active | 16 | 12 |
| Front porch | 2 | 1 |
| Active-low sync | 2 | 2 |
| Back porch | 2 | 1 |
| Exclusive total | 22 pixel clocks | 16 lines |

`h_count` therefore runs from 0 through 21 and `v_count` from 0 through 15.
The line period is 22 pixel clocks and the frame period is 352 pixel clocks.
Pixels are visible only when `h_count < 16 && v_count < 12`. `hsync_n` is low
for horizontal counts 18–19; `vsync_n` is low for vertical counts 13–14.

## Reset sequencing contract

Both domains use asynchronous assert, synchronous deassert. External reset
assertion immediately clears CPU-side control and holds video outputs inactive.
After external reset rises, each domain shifts two local clock edges through its
own reset synchronizer before leaving reset. A CONTROL request must not be
accepted while the pixel reset is active.

## CDC contract

CONTROL is a low-rate state update, not a streaming pixel bus. The CPU domain
latches the enable bit and toggles a request bit. The pixel domain passes that
toggle through a two-flop synchronizer, detects a change, samples the stable
enable payload, and returns the observed value as an acknowledge toggle. The
CPU must keep the payload stable until acknowledge matches request.

The regression proves protocol latency, stable transfer, and acknowledge
behavior in digital simulation. It does not model metastability probability or
analog settling. Those remain implementation-review and hardware-analysis
responsibilities.

## Framebuffer contract

The 16 × 12 framebuffer stores one 8-bit indexed-color pixel per byte. The CPU
writes it with RV32I `SB`; the controller must update only lanes selected by the
four-bit write strobe. The pixel domain reads the memory as a second port. The
firmware fills the buffer completely before enabling scanout, so simultaneous
read/write collision behavior is intentionally outside this exercise.

Indexed color maps to PPM RGB as `{index, index XOR 0x55, 0xff - index}`. A
successful run captures exactly one active frame to `build/frame.ppm` with no
timestamp or seed, making its bytes and SHA-256 deterministic.
