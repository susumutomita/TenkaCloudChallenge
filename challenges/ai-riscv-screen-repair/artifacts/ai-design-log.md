# Recovered AI design log

These notes came from the departed implementation assistant. They are claims to
test against the prior specification, not a source of truth.

- “One synchronizer register should be enough in a simulation because there is
  no analog metastability.”
- “The total probably means the final counter value, so subtracting one before
  the terminal comparison avoids an extra blank pixel.”
- “Firmware writes one byte at a time, but assigning the full word is simpler;
  the surrounding bytes will be written eventually.”

All three choices are legal SystemVerilog and compile successfully. The open
question is whether their observable protocol, timing, and pixel state satisfy
the contract.
