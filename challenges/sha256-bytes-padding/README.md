# SHA-256 part 1: bytes and padding

**Difficulty:** 2 · **Time:** 40–60 minutes · **Points:** 100 · **Series:** SHA-256, problem 1 of 3

## The story

You have called `sha256(...)` hundreds of times. Sixty-four hex characters come out, they match
what the other side computed, and everything works. Nothing about that experience tells you what
happened in between.

This is the first of three problems that replace the black box with a procedure you can follow by
hand. Not the whole of it at once — this one stops before the interesting arithmetic even starts.
All you do here is take a message and put it in the shape SHA-256 is able to read: a whole number
of 512-bit blocks, each read as sixteen 32-bit words.

That sounds like bookkeeping, and it mostly is. It is also where a first hand-written SHA-256
usually goes wrong, in one of four ways: counting characters instead of bytes, rounding the length
up to the wrong multiple, writing a byte count where the specification wants a bit count, and
letting the CPU pick the byte order.

## What gets deployed

A single container, no cloud account, no network surface. Everything is local:

```text
local/
├── starter/padding.py    ← the only file you edit
├── fixtures/generate.py     every fixture, derived from your per-deploy seed
├── tests/public/            the tests you can read
├── tests/hidden/            the tests the verifier runs (in the image, not bind-mounted)
├── reference/               the answer -- NOT in the image `make build` gives you
├── verifier/server.py       POST /verify on 127.0.0.1:18091
└── mutation.py              proves the hidden tests can actually fail a wrong answer
```

`make build` builds the `participant` stage of the Dockerfile, which carries the fixtures, both
test suites, the verifier and the starter. `reference/` and `mutation.py` are added only by the
`author` stage that `make reference-test` builds, so the answer is not sitting in the image you
were told to run. That is misdelivery prevention, not confidentiality — see Assurance scope.

Your fixtures come from `FLAG_SEED`, injected fresh at deploy. Same seed, same numbers, so your
session is reproducible and debuggable. Different seed, different numbers, so a value copied from
someone else's run is worthless.

## Participant Portal workflow

1. Start the problem in Participant Portal; the problem editor appears on the same page.
2. Select **Inspect evidence** to read this deployment's fixture and published evidence.
3. Edit the starter source in the Portal editor.
4. Select **Run public tests** and fill any direct-answer fields from the evidence.
5. Submit each checkpoint directly. Portal prepares and sends the current files and answers.

No checkout, terminal, local editor, second screen, or copy-and-paste step is required. Code
checkpoints use the current editor source. Direct answers are bound to the current deployment
seed, so a value copied from another deployment is rejected.

## Scoring

Six checkpoints, scored independently. Wrong answers cost 5 points each.

| Checkpoint | Points | What you submit |
|---|---:|---|
| `byte-length` | 10 | How many **bytes** the string from Workbench `inspect` is |
| `padded-length` | 15 | Six padded lengths, comma separated, worked out **before** you run anything |
| `length-field` | 15 | The trailing 8 bytes for one message length, as 16 hex characters |
| `pad` | 25 | Your `padding.py`, run against lengths you have not seen |
| `words` | 20 | Your `padding.py`, run against blocks you have not seen |
| `collision` | 15 | A second message that zero-only padding cannot tell apart from yours, as hex |

The six `padded-length` inputs always include 55 and 56 bytes, plus four seed-selected translations
of that same block-boundary decision. The rule is stable; the answer tuple is deployment-specific.

Hints are available on every checkpoint except `byte-length`. Opening all of them still leaves you
66 of 100.

On `byte-length` and `padded-length`: you can trivially get these by running code first and copying
the answer. Nobody will catch you. You will also have removed the only thing those checkpoints
measure, in the two places where being wrong is cheapest.

## The four things worth getting wrong once

**Characters are not bytes.** Workbench `inspect` prints a string with multi-byte characters in it, so
the character count and the byte count differ. SHA-256 only ever sees bytes. Any code you have
tested with ASCII alone has been exercised only where those two numbers happen to agree.

**The padded length is not "round up to 64".** Past the message itself you need one byte for the
marker and eight for the length. So `(length + 1 + 8)`, rounded up to a multiple of 64 — which is
why 55 bytes fits one block and 56 bytes does not, and why a message that is already exactly 64
bytes long still gains a whole block. The padding is never empty.

**The length field counts bits and is big-endian.** Two independent chances to be wrong in eight
bytes. A short message's field starts with a run of `0x00`, which is easy to mistake for "nothing
was written there".

**The specification decides the byte order, not your CPU.** x86 and ARM are little-endian, so the
convenient reading is the wrong one. The starter's `block_words` reads each group the way your
machine would, and that is exactly the defect.

## What the `collision` checkpoint is really asking

The `0x80` marker and the trailing bit length get conflated constantly, so this checkpoint
separates them by taking one away.

Imagine padding that just appends zero bytes up to the next multiple of 64 and stops. Lengths come
out fine. Blocks come out fine. But nothing records where the message ended, so two different
messages can produce byte-for-byte identical blocks — and a hash built on that padding has
collisions no matter how good the compression function is.

Finding a pair like that is the checkpoint. The marker is what fixes it; injectivity is its job.
The trailing bit length is doing something else entirely — Merkle–Damgård strengthening, mixing the
length into what gets compressed so that attacks relating messages of different lengths do not
work. Two mechanisms, two purposes.

## Passing the public tests is not the end

The public tests here use one message length and never check the *value* of the trailing 8 bytes.
An implementation that writes no length field at all passes every single one of them. That is the
point of including them: they show you the shape of the answer and they do not prove it.

The hidden tests sweep lengths 0, 55, 56, 63, 64, 119, and 120, add a mixed UTF-8 message, and add
one built only from `0x80` and `0x00` bytes to fail an implementation that finds the marker by
scanning. They check properties rather than fixed values — injectivity, minimality, and that
re-joining the sixteen words big-endian gives the block back — because a relation cannot be
satisfied by memorizing one output.

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine, the Docker daemon,
and the image, so nothing here is hidden from you: `tests/hidden/` is not bind-mounted and
`reference/` is not in the participant image at all, which keeps them out of your way rather than
out of reach. The source is in this repository either way, and you can build the `author` stage
yourself.

What the verifier does guarantee is narrower and real: a submission cannot hang or crash it, a
checkpoint can only credit the id it echoes, results do not leak expected values, and the fixtures
come from this deployment's seed so a memorized answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources. It is a container on your machine.

## For authors

`make reference-test` runs the mutation suite: nine broken `pad_message` implementations, six
broken `block_words` implementations, and eight mutations aimed at the verifier itself — including
one that checks an unknown checkpoint fails closed. Every one must be caught.

Two obvious-looking mutations are deliberately **not** in the list. Writing `message + b"\x80"`
instead of appending to a `bytearray`, and reading the bit length from `len(message)` before rather
than after copying the message into the buffer, both produce byte-for-byte identical output, so no
correct test could distinguish them. Listing them would produce a permanent "survived" and train
the next author to ignore the suite. See the comment at the top of `local/mutation.py`.
