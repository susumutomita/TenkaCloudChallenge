# Two days a year, the report is wrong

`cs-foundations` chapter 9. Nobody changed the ledger and nobody changed the code that
totals it, and yet twice a year the published daily report disagrees with it — because a
local day is not always twenty-four hours long.

## The gap this problem is built on

The starter passes every public test. Each of them totals an ordinary week, and an
implementation that reads the zone's offset once at the start of the range and adds it to
every instant is right for every week that has no switch in it.

## Layout

```
local/starter/rollup.py       the one file a participant edits
local/reference/rollup.py     the answer (author image only)
local/tests/public/           tests the broken starter passes
local/tests/hidden/           the properties that actually decide the checkpoints
local/mutants/                author-only mutant read by the mutation suite
local/mutation.py             breaks the reference ten ways and requires each to be caught
local/fixtures/generate.py    seed-derived daily report and the ledger's own count
local/verifier/server.py      hidden grading, separate image and network
local/workbench/server.py     participant editor and evidence, the only published port
```

## How the hidden properties decide

Every zone and date comes from the system tz database and moves with the verifier seed, so
a submission cannot special-case the week it saw in the public tests. The checker builds
its own expectation with the same calendar the contract names and compares day by day.

Nothing is left to chance. A wrong offset misplaces an event by carrying it across a *day
boundary*, not by carrying it across the switch, so the first and last minute of every
generated day are always occupied — otherwise whether a checkpoint caught the defect would
depend on which seed the participant happened to draw. Both directions are probed for the
same reason: when the clocks go back the spill is at the end of the shortened day, and
when they go forward it is at the start of the following day.

Two wrong answers are deliberately separated. A fixed offset is visibly wrong. Grouping by
the UTC day and relabelling the buckets with local dates produces genuine local date
labels and is still wrong, because the bucket a label names is not the day it claims —
that is the author-only mutant in `local/mutants/`.

Only zones whose switch happens away from midnight are used, so a local midnight always
exists. The lesson is that a day can be 23 or 25 hours long, not that a wall-clock time
can fail to exist at all.

## Author commands

```bash
make build           # participant + verifier images
make test            # public tests against local/starter
make inspect         # print the participant-visible evidence
make reference-test  # reference passes its hidden suite, all ten mutations die
make up / make down  # run the Compose lab locally
```

## Assurance scope

Local mode is self-paced, honor-system verification. The participant owns the machine, the Docker
daemon, and the image. The normal participant image does not
contain hidden tests, the reference, or mutations; the hidden verifier is a separate image. A
person who controls Docker can still build author stages and inspect them. The separation prevents
accidental delivery, not a malicious host owner. Submissions run with time, memory, process, and
output caps; containers run non-root, read-only, without privileges, and without a masqueraded
outbound network.

It does **not** support competition ranking, examination, or completion certification. Those uses
need a verifier the participant does not administer, tracked in
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## What you proved

You did not make every time calculation correct. For one daily report over one range, you
settled which local day each event belongs to, transition days included, for several zones
and both directions of the switch. Wall-clock times that do not exist, or that happen
twice, are not part of that claim — this problem never asks for one.
