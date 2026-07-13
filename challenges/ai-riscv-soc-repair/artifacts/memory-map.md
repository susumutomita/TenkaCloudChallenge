# Level 1 memory map

| Address range | Device | Behavior |
| --- | --- | --- |
| `0x00000000`–`0x00000fff` | ROM | Firmware fetch and constants |
| `0x10000000` | UART TX | `SB` emits the low byte to the simulation log |
| `0x10000004` | TOHOST | `SW 1` passes; any other non-zero value fails |
| `0x10000008` | GPIO | `SW` updates output; firmware writes `0xA5` |
| `0x20000000`–`0x20000fff` | Data RAM | Byte-addressed read/write RAM |

All addresses are byte addresses and naturally aligned for the access width
used by the firmware. Level 1 does not define exceptions for misaligned access.
