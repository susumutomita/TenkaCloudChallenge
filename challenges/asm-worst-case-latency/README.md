# One instruction, as slow as you can make it

`cs-foundations` chapter 11. Inspired by the idea behind
[asm-hall-of-shame](https://github.com/xoreaxeaxeax/asm-hall-of-shame) — the
implementation here is original.

## The gap this problem is built on

The starter is not broken. It is an honest measurement of the fastest thing the
machine can do, and it scores around 1.00 against the baseline because it *is*
the baseline instruction. Every public test passes. What no public test asks is
whether the number is large, and making it large is the whole task.

## Layout

```
local/starter/candidate.S     the one instruction line a participant edits
local/reference/candidate.S   the answer (author image only)
local/harness/candidate.py    safe builder: validates and creates the fixed wrapper
local/harness/measure.c       author-owned: clocks, warm-up, sampling, rejection
local/harness/arena.c         the 64 MiB seed-shuffled pointer ring
local/harness/baseline.S      the fixed comparison point
local/tests/hidden/check_candidate.py  disassembles first, measures second
local/tests/public/           tests the honest-but-slow starter passes
local/mutation.py             boundary and score regression probes
local/workbench/server.py     participant editor and evidence, the only published port
```

## How the grading decides

Shape before number. `candidate.S` contains one approved scalar-integer
instruction line, not a function. The reviewed set covers scalar arithmetic,
moves and read-only loads, shifts/rotates, bit scans, conditional moves/sets and
NOP, with GPR operands only; SIMD/x87, random, system-state and unknown
instructions are rejected. A shared safe builder embeds that line in an
author-owned wrapper and
expands it exactly 64 times. The resulting object is disassembled and must hold
64 byte-identical copies of that one non-control-flow instruction, with no relocation, syscall,
privileged instruction, home-made timing instruction, stall instruction or cache
manipulation. A memory operand may only read the author-owned arena at `(%r8)`
into an explicit GPR destination; stores and read-modify-write operations that could alter
the arena or harness state are rejected before execution. `%r15` is reserved for
the wrapper's call-frame guard. The original participant
file is never linked or run.

The score is `candidate robust cycles / baseline robust cycles`, both measured in
the same process on the same host, so the thresholds mean the same thing on a
laptop and on a server. The robust statistic is the median of the samples that
stayed on one CPU; samples that migrated and extreme high-side outliers matching
a predeclared interrupt rule are dropped rather than rewarded. A run that could
not keep a majority of its samples is refused as unmeasurable.

`generalize` grades on a seed the participant has never measured against, so a
solution tuned to one arena's shape does not carry while one that follows the
ring does.

## Author commands

```bash
make build           # participant + verifier images
make test            # public tests against local/starter
make inspect         # print the participant-visible evidence
make reference-test  # reference beats the threshold and all boundary probes pass
make up / make down  # run the Compose lab locally
```

## Host requirements

The result only means something on a **native amd64** host with `rdtscp`,
`constant_tsc`, `nonstop_tsc` and `clflush`. `runtime.compatibility` declares this, and the
platform refuses to start the problem elsewhere — emulation would run happily and
report meaningless numbers, which is worse than not running.

## Assurance scope

Local mode is self-paced, honor-system verification. The participant owns the machine, the Docker
daemon, and the image. The normal participant image does not
contain the reference candidate or the mutation suite; the grader is in a separate image. A
person who controls Docker can still build author stages and inspect them. The separation prevents
accidental delivery, not a malicious host owner. Submissions run with time, memory, process, and
output caps; containers run non-root, read-only, without privileges, and without a masqueraded
outbound network.

It does **not** support competition ranking, examination, or completion certification. Those uses
need a verifier the participant does not administer, tracked in
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## What you proved

You did not make anything fast. You showed that a single instruction's cost is a
property of its dependencies and the memory it reaches, not of its opcode — and
that the gap between the usual case and the worst case can be tens of times on
hardware you own.
