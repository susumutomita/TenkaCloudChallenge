# Every page is right. The listing is not

`cs-foundations` chapter 10. Writes land between page calls, the same row arrives on two
pages, and a living row never arrives at all.

## The gap this problem is built on

The starter passes every public test, because each of them pages over a table that holds
still. Over a still table an offset is indistinguishable from a cursor; it stops being
one the moment the table moves, and no public test moves the table.

## Layout

```
local/starter/pagination.py    the one file a participant edits
local/reference/pagination.py  the answer (author image only)
local/tests/public/            tests the broken starter passes
local/tests/hidden/            the properties that actually decide the checkpoints
local/mutants/                 author-only mutant read by the mutation suite
local/mutation.py              breaks the reference nine ways and requires each to be caught
local/fixtures/generate.py     seed-derived listing trace and the MemoryStore
local/verifier/server.py       hidden grading, separate image and network
local/workbench/server.py      participant editor and evidence, the only published port
```

## How the hidden properties decide

The checker owns the store and applies every write itself, between page calls, so
nothing is timing-dependent. The properties are stated against the contract — strictly
newest-first, no id twice, every survivor exactly once, nothing served from a stale
copy, a cursor that never lies about the end, refusal without disturbance — and the
final phase generates seeded insert/delete schedules the author never wrote down.
This is what separates a paginator that keeps an invariant from one that was fixed
until the examples passed; nothing here inspects how the submission is written.

## Author commands

```bash
make build           # participant + verifier images
make test            # public tests against local/starter
make inspect         # print the participant-visible evidence
make reference-test  # reference passes its hidden suite, all nine mutations die
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

You did not strengthen the table's transaction isolation. Within one iteration you
settled how many times each row arrives — exactly once for every survivor, never from a
stale copy, with an explicit refusal for inputs you never issued. That is a precise,
useful guarantee—and no larger than the evidence supports.
