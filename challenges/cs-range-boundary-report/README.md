# Last week's number counts a day that is not last week

`cs-foundations` chapter 0, the way into the track. A daily report is asked for the
last seven days, prints the right range, and totals eight of them.

Everything it needs is dates and addition. No time zones — those are
`cs-dst-daily-rollup` at order 90. No floating point — that is
`cs-numeric-aggregation-order` at order 70. Just which end of a range you count.

## The gap this problem is built on

The starter passes every public test. Those tests put rows inside the window, before
the window, and after the report; they check the returned `start` and `end`, repeats,
ordering, and every documented error. Not one of them puts a row on the day the
report runs, which is the only day where the starter and the contract disagree.

The returned window is right and the days counted are wrong. That is the whole
lesson: a test whose data never touches the boundary proves nothing about it.

## Layout

```
local/starter/report.py       the one file a participant edits
local/reference/report.py     the answer (author image only)
local/tests/public/           tests the broken starter passes
local/tests/hidden/           the properties that actually decide the checkpoints
local/mutants/                author-only mutant read by the mutation suite
local/mutation.py             breaks the reference fourteen ways and requires each to be caught
local/fixtures/generate.py    seed-derived report and ledger
local/verifier/server.py      hidden grading, separate image and network
local/workbench/server.py     participant editor and evidence, the only published port
```

## Checkpoints

| id | points | wrong-answer penalty | what it decides |
| --- | --- | --- | --- |
| `environment` | 10 | 5 | the Workbench pass phrase for this deployment |
| `observe` | 20 | 5 | the day in the total that is not in the last seven, and the total without it |
| `repair` | 35 | 5 | the default seven-day window covers exactly the seven days before the run date |
| `generalize` | 35 | 5 | the same rule at other window lengths, across month / year / leap-day ends, with gaps in the ledger, and without touching the caller's rows |

100 points for a difficulty-2 Challenge, a flat 5-point wrong-answer penalty, and
32 points of hint penalties in total — see AGENTS.md §14.

## How the hidden properties decide

Nothing is sampled and nothing races. Every case names a calendar day, states whether
that day is inside the window the contract describes, and asks for a number that can
only be right if the submission agrees. The boundary probes hand over a single row on
a single day — the run date, the day after it, the last day of the window, the first
day of the window, the day before it — so a wrong end cannot hide inside a total.

The anchor day and every row count come from the run's seed, so a total copied from
another deployment fails on the first case.

`generalize` adds the cases a plausible wrong fix survives: window lengths other than
seven, windows crossing a month, a year and a leap day, a ledger with days inside the
window that have no rows at all (a window is a run of calendar days, not the last few
days that happen to have data), repeats, shuffled input, and the caller's list coming
back unmodified.

## Author commands

```bash
make build           # participant + verifier images
make test            # public tests against local/starter
make inspect         # print the participant-visible evidence
make reference-test  # reference passes its hidden suite, all fourteen mutations die
make up / make down  # run the Compose lab locally
```

## Cost-bearing resources

None. This problem deploys no cloud resources: it is two local containers built from
`local/Dockerfile` and run by Compose, and `make down` removes them. The only
published port is the Workbench on `127.0.0.1:18590`; the verifier has no host port.
Nothing keeps billing after teardown because nothing was provisioned.

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

You did not make date arithmetic safe. You fixed one range: the days it names and the
days it counts are now the same set, for any window length and wherever the window
lands in the calendar. What a calendar day is worth in a given zone, and what the
addition does to precision, are still open — and are the next two chapters.
