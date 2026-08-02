# SHA-256 part 1: bytes and padding

What SHA-256 actually reads is not a string but a byte sequence. Count the UTF-8 bytes, pad to whole 512-bit blocks, build the trailing bit-length field, and get the 32-bit word byte order right.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Tell a character count apart from a UTF-8 byte count
- Implement FIPS 180-4 §5.1.1 padding so any length lands on a multiple of 64 bytes
- Compute the padded length, including across the 55 / 56 boundary
- Explain and build the trailing 8 bytes as a big-endian bit count
- Read a 64-byte block as sixteen big-endian 32-bit words
- Show by counterexample that padding without the 1 bit marker is not injective

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `byte-length` | Count bytes, not characters |  |
| `padded-length` | Predict six padded lengths |  |
| `length-field` | Build the trailing 8 bytes |  |
| `pad` | Implement pad_message to the specification |  |
| `words` | Read the block as sixteen 32-bit words |  |
| `collision` | Build a counterexample for padding with no marker |  |

## Explanation

## What this checked

### Bytes, not characters

`len(text)` is a character count; `len(text.encode("utf-8"))` is a byte count. SHA-256 only ever sees the second one. Code tested against ASCII alone has only been exercised where those two numbers agree, and the moment a non-ASCII character arrives the length assumption breaks.

### Padding has three parts

FIPS 180-4 §5.1.1 says: append a single 1 bit, then as many zeros as needed, then the message length in bits as a 64-bit big-endian integer. On a byte boundary that 1 bit is exactly the byte `0x80`.

Rounding `(length + 1 + 8)` up to a multiple of 64 is the whole calculation. 55 bytes just fits one block; 56 bytes does not. Remembering the rule as "round up to the next multiple of 64" gets 56 wrong. And when the length is already a multiple of 64 the marker and the length field still need somewhere to live, so a whole extra block appears. The padding is never empty.

### The 1 bit and the length field do different jobs

These get conflated often enough to be worth separating:

- **The `0x80` marker** is what makes padding injective. Without it, `m` and `m + 0x00` collapse onto the same block — which is exactly the counterexample the collision checkpoint asks for.
- **The trailing 8-byte bit length** is Merkle–Damgård strengthening. Mixing the length into the compressed input blocks attacks that relate messages of different lengths (fixed-point chaining, part of the length-extension family). Injectivity is not its job; that belongs to the marker.

The field counts *bits*, not bytes, and it is big-endian, so a short message's field starts with a run of `0x00`. Eight bytes is also where SHA-256's message-length ceiling comes from: under 2^64 bits.

### Big-endian is the specification; little-endian is convenience

x86 and ARM default to little-endian, so `int.from_bytes(group)` with no byte order is environment-dependent, and `"little"` is simply wrong for SHA-256. The specification puts the most significant byte first: `61 62 63 80` is `0x61626380`.

This mismatch is a classic cause of an implementation that runs fine and produces the wrong digest. When your hash does not match the published test vectors, byte order is one of the first places to look.

## Passing the public tests is not the end

The public tests here use one message length and never check the value of the trailing 8 bytes, so an implementation that writes no length field at all passes every one of them. That is `misconception.public-tests-are-complete`, demonstrated rather than described.

The hidden tests sweep lengths 0, 55, 56, 63, 64, 119, and 120, plus a mixed UTF-8 message and one built only from `0x80` and `0x00` bytes — the latter to fail an implementation that finds the marker by scanning for `0x80`. They check properties rather than fixed expected values: injectivity (`m` and `m + 0x00` must differ), minimality (no extra block nobody asked for), and word round-tripping (re-joining the sixteen words big-endian gives the block back). A relation cannot be satisfied by memorizing one output.

## What to learn next

The block you just built is the input to the next problem: expanding sixteen words into sixty-four (the message schedule), the ROTR / SHR rotations and σ0 / σ1 that drive it, and the Ch / Maj / Σ0 / Σ1 functions. That is SHA-256 part 2.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
