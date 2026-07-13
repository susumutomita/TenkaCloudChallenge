# Level 2 memory and register map

All addresses are byte addresses. The RV32I CPU and its 4 KiB ROM/RAM boundary
are inherited unchanged from Level 1.

| Address range | Name | Access | Behavior |
| --- | --- | --- | --- |
| `0x00000000`–`0x00000fff` | Instruction ROM | read | Firmware and constants |
| `0x10000000` | UART TX | write byte | Simulation log character |
| `0x10000004` | TOHOST | write word | `1` means firmware finished; another nonzero value fails |
| `0x10001000` | VIDEO_CONTROL | read/write word | bit 0 is enable; a changed value toggles the CDC request |
| `0x10001004` | VIDEO_STATUS | read | bit 0 enable active, bit 1 request pending; remaining bits are zero |
| `0x10002000`–`0x100020bf` | FRAMEBUFFER | read/write byte | 192 indexed pixels in row-major order |
| `0x20000000`–`0x20000fff` | Data RAM | read/write | Firmware scratch memory |

`VIDEO_CONTROL` accepts a naturally aligned word write with all four strobes.
Framebuffer writes honor each lane of `data_wstrb`; an `SB` to address
`0x10002003`, for example, changes only pixel byte 3 of the first word.

Firmware writes index `i` as `(i * 13 + (i >> 4) * 7) & 0xff`, then changes four
selected pixels to a second pattern before enabling video. The second pass makes
incorrect whole-word replacement observable even if the initial fill happened
to hide a write-strobe defect.
