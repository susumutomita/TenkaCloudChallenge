# Boot the AI-Built RISC-V SoC

An AI assistant generated a small game-console SoC, reported that the RTL compiled,
and then left. The CPU never reaches its first UART message. You inherit the source,
firmware, a memory map, a short design log, and a regression that fails.

Your job is not to rewrite the CPU. Find the three incorrect integration
decisions in `local/solution/rv32i_cpu.sv`, justify each repair from the RV32I
contract, and make the firmware print its per-run flag.

## What runs

The Level 1 MVP is intentionally bounded and works without an FPGA:

- a single-cycle RV32I CPU;
- 4 KiB instruction ROM and 4 KiB data RAM;
- memory-mapped UART, GPIO, and a simulation-only TOHOST register;
- bare-metal assembly firmware built with the GNU RISC-V toolchain;
- Verilator simulation in Docker; and
- a loopback lab page plus TenkaCloud `/verify` endpoint.

The executable subset is `LUI`, `AUIPC`, `JAL`, `JALR`, conditional branches,
`LB/LH/LW/LBU/LHU`, `SB/SH/SW`, and the RV32I integer ALU operations. There are
no compressed instructions, CSRs, interrupts, atomics, multiply/divide, caches,
MMU, or privilege modes in Level 1.

## Run the failing baseline

From this directory:

```bash
make test
```

Docker builds a pinned lab environment containing Verilator and the RISC-V GCC
toolchain, compiles the mounted participant RTL, builds the firmware, and runs the
SoC. The inherited state is expected to fail.

Read these before editing:

- [`artifacts/architecture.md`](./artifacts/architecture.md)
- [`artifacts/memory-map.md`](./artifacts/memory-map.md)
- [`artifacts/ai-design-log.md`](./artifacts/ai-design-log.md)
- [`artifacts/toolchain.md`](./artifacts/toolchain.md)

Then edit only `local/solution/rv32i_cpu.sv` and run `make test` again. A successful
run prints:

```text
Hello from RISC-V
TENKACLOUD{rv32i_soc_booted_<per-run digest>}
SIM_PASS ...
```

The browser lab also offers **Capture waveform**. It reruns the mounted RTL and
downloads a bounded VCD containing PC, instruction/data bus, UART, GPIO, and TOHOST
signals; it is useful even while the boot is stuck.

Use `make local PROBLEM=ai-riscv-soc-repair` from the TenkaCloud platform root to
open the browser lab and submit that flag. In Codespaces the included Docker-in-Docker
environment runs the same flow; no local toolchain or FPGA is required.

## Scoring and learning

This is a hard (difficulty 4), 90–120 minute Challenge worth 300 points. A wrong
submission costs 15 points. Three progressive hints cost 30, 45, and 75 points.
After solving, the portal reveals the write-up connecting each symptom to the RV32I
specification and the broader lesson: compiling AI-generated RTL is not proof
that the hardware contract is correct.

## Cost and safety

The exercise uses local Docker CPU and memory only. Ports 18080 and 18081 bind to
`127.0.0.1`; the compose file uses no host devices, privileged mode, host networking,
AWS resources, credentials, or physical hardware. Stop it with `make down`.

Level 2 (screen timing and CDC) is deliberately separate and tracked in
[TenkaCloudChallenge #184](https://github.com/susumutomita/TenkaCloudChallenge/issues/184).
Its scoped proposal is recorded in
[`artifacts/level-2-issue.md`](./artifacts/level-2-issue.md).
