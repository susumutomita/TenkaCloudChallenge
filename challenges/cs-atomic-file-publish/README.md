# Half a file is not a file

`cs-foundations` chapter 6. A publisher writes exactly the right bytes and reports
success — and a reader that looked while it was writing was holding an empty file.

## The gap this problem is built on

The starter passes every public test. Each of those tests inspects the file *after*
`publish()` returns, which is the one moment when a broken publisher looks perfect.
Nothing public looks at the moments in between, and that is where the defect lives.

## Layout

```
local/starter/publish.py      the one file a participant edits
local/reference/publish.py    the answer (author image only)
local/tests/public/           tests the broken starter passes
local/tests/hidden/           the properties that actually decide the checkpoints
local/mutants/                author-only mutant read by the mutation suite
local/mutation.py             breaks the reference nine ways and requires each to be caught
local/fixtures/generate.py    seed-derived reader log and crash survivors
local/verifier/server.py      hidden grading, separate image and network
local/workbench/server.py     participant editor and evidence, the only published port
```

## How the hidden properties decide

Nothing races. An observer wraps the file APIs the submission uses and snapshots the
destination at every write boundary — exactly the instants a reader could have looked.
Every snapshot must be a whole file: either the complete old one or the complete new
one. The same observer can raise at a chosen boundary to model the process dying
mid-publish, and the crash point is swept across every boundary the submission uses.

Overlapping publishes are checked the same deterministic way: the second publish is
started from inside the first one's write, so a submission that reuses one fixed
work-file name is caught without depending on thread scheduling.

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

You did not make the filesystem transactional. You made one replacement indivisible within one
filesystem, and durable once fsync has returned. A reader sees the whole old file or the whole new
one, and a crash at any point leaves one of those two and no debris. That is a precise, useful
guarantee—and no larger than the evidence supports.
