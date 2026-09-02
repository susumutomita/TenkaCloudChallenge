# Two days a year, the report is wrong

`cs-foundations` chapter 9. Nobody changed the ledger and nobody changed the code that
totals it, and yet twice a year the published daily report disagrees with it — because a
local day is not always twenty-four hours long. And the disagreement does not stop there:
a rollup that reads its offset once at the start of the range keeps that offset to the end,
so every day after the switch is off by its boundary hour.

## The gap this problem is built on

The starter passes every `daily_totals` public test. Each of them totals an ordinary week,
and an implementation that reads the zone's offset once at the start of the range and adds
it to every instant is right for every week that has no switch in it. The one
`counterexample` public test reports "not implemented yet" until the function is written,
and only ever tries the two New York pairs the statement works through.

## Checkpoints

| id | points | kind | what decides it |
| --- | --- | --- | --- |
| `environment` | 15 | direct | the Workbench pass phrase, sent automatically |
| `observe` | 20 | direct | `[reportId, "not-24-hours"]` for the deployment's report |
| `audit` | 30 | direct | every row where the published total differs from the ledger — the switch day and every later row |
| `rollup` | 45 | code | an ordinary week, an empty range, outside events, one real transition, the contract's errors |
| `transition` | 40 | code | the hours around the switch and both ends of three days; several zones, both directions, a range spanning both switches |
| `counterexample` | 50 | code | `counterexample(zone, start_day, switch_day)` returns one event the fixed offset takes away from an ordinary day — a property, not an expected value |

## Layout

```
local/starter/rollup.py       the one file a participant edits (daily_totals, fixed_offset_day, counterexample)
local/reference/rollup.py     the answer (author image only)
local/tests/public/           tests the broken starter passes (plus one counterexample test it skips)
local/tests/hidden/           the properties that actually decide the checkpoints
local/mutants/                author-only mutant read by the mutation suite
local/mutation.py             breaks the reference twenty ways and requires each to be caught
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
when they go forward it is at the start of the following day. `transition` therefore
sweeps several zones, two years and both directions, plus a range that contains both
switches: one seed-chosen transition only ever exercises one direction, and the label
promises both.

Two wrong answers are deliberately separated. A fixed offset is visibly wrong. Grouping by
the UTC day and relabelling the buckets with local dates produces genuine local date
labels and is still wrong, because the bucket a label names is not the day it claims —
that is the author-only mutant in `local/mutants/`.

Only zones whose switch happens away from midnight are used, so a local midnight always
exists. The lesson is that a day can be 23 or 25 hours long, not that a wall-clock time
can fail to exist at all.

### The counterexample property

`counterexample(timezone_name, start_day, switch_day)` is called with 38 triples: the two
New York pairs from the statement, then three seed-chosen zones × two years × both
transitions, each with a start on the switch day itself, a start a few days earlier, and a
start months earlier whose midnight already carries the offset the switch moves *to*. The
returned input is totalled twice — the starter's fixed-offset arithmetic and the
calendar's — and passes when some day that is not a switch day comes up short. There is no
expected event to compare against. The far starts are what separate the rule the statement
gives (compare the start's offset with the day's own) from the shortcut a participant is
likely to try first (pick the boundary hour from the switch's direction): from such a start
the days after the switch are not misplaced at all. A one-second walk over the range fails
on the 15-second limit, an hour-by-hour walk with the starter's `fixed_offset_day` as the
oracle passes, which is intended — it is a real oracle the participant wrote.

Failure messages name the rule that was broken and echo only the public triple the
function was called with (AGENTS.md §15); the verifier's own zone and report never appear.

### The fixture's report

The daily report is generated the way a fixed-offset job really publishes it for a range
that starts before the switch. When the clocks went back, each day from the switch day on
loses the amount in its last hour to the next day, and the last day's share leaves the
range and is counted nowhere; when they went forward, each day after the switch loses its
first hour to the day before, and the switch day itself only gains. Consecutive moved
amounts always differ, so no row balances by accident. The `audit` answer is derived from
the rows, so it follows this shape: the switch day and every row after it.

## Author commands

```bash
make build           # participant + verifier images
make test            # public tests against local/starter
make inspect         # print the participant-visible evidence
make reference-test  # reference passes its hidden suite, all twenty mutations die
make up / make down  # run the Compose lab locally
```

`make reference-test` takes about fifteen seconds longer than it used to: one mutant is the
one-second brute force, and only the verifier's time limit can stop it.

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
and both directions of the switch — and you showed, for any zone and any range start, that
the fixed offset gets an ordinary day wrong, not only the switch day. Wall-clock times that
do not exist, or that happen twice, are not part of that claim — this problem never asks
for one.
