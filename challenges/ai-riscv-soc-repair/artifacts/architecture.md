# Level 1 architecture

## Scope

The MVP is a deterministic single-cycle RV32I simulation. The CPU has separate
instruction and data buses. The SoC supplies byte-addressed ROM/RAM and three
memory-mapped devices. There is no timing model beyond one instruction per clock,
and no FPGA-specific primitive.

```text
firmware.hex -> instruction ROM -> RV32I CPU
                                      |
                                      +-- data RAM
                                      +-- UART TX -> simulation log
                                      +-- GPIO -> regression marker 0xA5
                                      `-- TOHOST -> pass/fail/timeout
```

## Reset and execution contracts

- The linker places `_start` at `0x00000000`; reset begins there.
- Every instruction is 32 bits (`C` is not implemented), so normal sequential
  PC is `pc + 4` and JAL's link value is the address of that next instruction.
- `LB` sign-extends bit 7; `LBU` zero-extends it.
- Register x0 always reads as zero and discards writes.
- JALR clears target bit zero as required by RV32I.

The boot firmware makes those first three boundary contracts executable before it
prints any success text. This lets the regression distinguish a compile-successful
core from an ISA-conformant one.
