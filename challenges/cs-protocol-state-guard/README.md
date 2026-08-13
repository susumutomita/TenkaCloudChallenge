# The handshake was optional after all

`cs-foundations` chapter 8. A client ignores the documented order, and the server keeps
answering ok.

## The gap this problem is built on

The starter passes every public test, because each of them holds the conversation in the
documented order. A handler that only branches on the message type serves a well-behaved
client perfectly, and never asks what state it is in.

## Layout

```
local/starter/session.py      the one file a participant edits
local/reference/session.py    the answer (author image only)
local/tests/public/           tests the broken starter passes
local/tests/hidden/           the properties that actually decide the checkpoints
local/mutants/                author-only mutant read by the mutation suite
local/mutation.py             breaks the reference nine ways and requires each to be caught
local/fixtures/generate.py    seed-derived session transcript
local/verifier/server.py      hidden grading, separate image and network
local/workbench/server.py     participant editor and evidence, the only published port
```

## How the hidden properties decide

The checker keeps its own copy of the protocol, written out rather than imported from the
reference, so a submission is compared against the specification instead of against one
implementation of it.

Grading is behavioural, not stylistic. The final phase sweeps every combination of
reachable state and message type — including types outside the protocol — and compares
each cell against that model. It also re-drives the session after every refusal, so a
handler that refuses but still moves the state is caught. This is what separates a
handler that answers the whole space from one that had ifs added until the examples
passed; nothing here inspects how the submission is written.

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

You did not strengthen authentication itself. Within one session you settled which
operation is allowed when, for every combination of state and message type, and made a
refusal move neither the state nor the data already accepted. That is a precise, useful
guarantee—and no larger than the evidence supports.
