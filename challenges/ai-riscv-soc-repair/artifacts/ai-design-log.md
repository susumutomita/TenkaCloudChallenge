# Recovered AI design log

The departed author left these notes. They are observations, not a
specification. Use the architecture, RV32I contract, and regression evidence
to accept or reject each claim.

- “The boot ROM has a small header, so starting at the second word should be
  harmless.”

- “Returning from a jump should skip the call and its setup word. Eight bytes
  feels consistent with the two-stage fetch/decode sketch.”

- “Loads are easiest if every sub-word value is cleared in the upper bits.
  Software can interpret signed values later.”

The implementation compiles because each statement is legal SystemVerilog. The open
question is whether those three choices satisfy the ISA and firmware boundary.
