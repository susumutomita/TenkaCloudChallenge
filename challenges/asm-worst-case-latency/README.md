# One instruction, as slow as you can make it

`cs-foundations` chapter 11. Inspired by the idea behind
[asm-hall-of-shame](https://github.com/xoreaxeaxeax/asm-hall-of-shame) — the
implementation here is original.

## The gap this problem is built on

The starter is not broken. It is an honest measurement of the fastest thing the
machine can do, and it scores exactly 1.00 against the baseline because it *is*
the baseline instruction. Every public test passes. What no public test asks is
whether the number is large, and making it large is the whole task.

## Layout

```
local/starter/candidate.S     the one file a participant edits
local/reference/candidate.S   the answer (author image only)
local/harness/measure.c       author-owned: clocks, warm-up, sampling, rejection
local/harness/arena.c         the 64 MiB seed-shuffled pointer ring
local/harness/baseline.S      the fixed comparison point
local/verifier/grader.py      disassembles first, measures second
local/tests/public/           tests the honest-but-slow starter passes
local/mutation.py             breaks the grader eight ways
local/workbench/server.py     participant editor and evidence, the only published port
```

## How the grading decides

Shape before number. The measured region is disassembled and required to hold
exactly one non-control-flow instruction, with no syscall, privileged
instruction, home-made timing instruction, stall instruction or cache
manipulation. Only then is it built and run.

The score is `candidate robust cycles / baseline robust cycles`, both measured in
the same process on the same host, so the thresholds mean the same thing on a
laptop and on a server. The robust statistic is the median of the samples that
stayed on one CPU; samples that migrated are dropped rather than rewarded, and a
run that could not keep a majority of them is refused as unmeasurable.

`generalize` grades on a seed the participant has never measured against, so a
solution tuned to one arena's shape does not carry while one that follows the
ring does.

## Author commands

```bash
make build           # participant + verifier images
make test            # public tests against local/starter
make inspect         # print the participant-visible evidence
make reference-test  # reference beats the threshold, all eight mutations die
make up / make down  # run the Compose lab locally
```

## Host requirements

The result only means something on a **native amd64** host with `rdtscp`,
`constant_tsc` and `nonstop_tsc`. `runtime.compatibility` declares this, and the
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
that the gap between the usual case and the worst case is two orders of
magnitude on hardware you own.
