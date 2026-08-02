# Predict, then run

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 10 · **Chapter:** Bridge 0 / Experimental
Workflow · **Role:** `diagnostic` · **Time:** 20–30 minutes · **Points:** 100

## The story

You are joining a cryptography reading group that meets for seven weeks. Before the first
lecture, someone hands you a laptop and says: "we do not debug by guessing here. You say what
will happen, then you run it, and the gap between those two is where the learning is."

Then they hand you the least interesting program in the building — a counter that adds a number
to itself over and over, modulo something — and tell you to finish it.

It is not a cryptography problem. That is the point. Every problem after this one asks you to
predict a value before running, to read a trace and say where it first went wrong, and to write
something that survives inputs you were never shown. Learning those three habits while also
learning elliptic curves means learning neither.

## What gets deployed

A single container, no cloud account, no network surface. Everything is local:

```text
local/
├── starter/counter.py    ← the only file you edit
├── fixtures/generate.py     every fixture, derived from your per-deploy seed
├── tests/public/            the tests you can read
├── tests/hidden/            the tests the verifier runs (in the image, not mounted)
├── reference/               the answer (in the image, not mounted -- see Assurance scope)
├── verifier/server.py       POST /verify on 127.0.0.1:18091
└── mutation.py              proves the hidden tests can actually fail a wrong answer
```

Your fixtures come from `FLAG_SEED`, injected fresh at deploy. Same seed, same numbers, so your
session is reproducible and debuggable. Different seed, different numbers, so a value copied from
someone else's run is worthless.

## How to play

Start the problem from the Participant Portal and open the **Browser Workbench** endpoint.
`inspect`, editing `counter.py`, the public tests, and the environment / generalize submission
values all live in the browser. The predict and inspect answers are read off by you and entered
into the Portal directly. No host terminal or checkout editing is required.

Only when authoring or verifying straight from the repository, run these in the problem directory:

```bash
make inspect             # your fixture, your health token, the broken trace
make test                # the public tests
make test-one ID=range   # re-run one public test while you iterate
make reset               # restore starter/counter.py
```

In the Workbench or the checkout you edit one file, `local/starter/counter.py`.
`advance(start, step, rounds, modulus)` must return the trace:
the value after each round, with the modulus applied **every** round, always in `[0, modulus)`,
for any sign of `step`.

## Scoring

Four checkpoints, scored independently. Wrong answers cost 5 points each.

| Checkpoint | Points | What you submit |
|---|---:|---|
| `environment` | 20 | The health token from `make inspect` |
| `predict` | 25 | The final value, worked out **before** you run anything |
| `inspect` | 25 | The 0-based index where the broken trace first leaves `[0, modulus)` |
| `generalize` | 30 | Your `counter.py`, run against parameters you have not seen |

Hints are available on `inspect` (10) and `generalize` (10, then 5). Opening every hint still
leaves you 75 of 100.

On `predict`: you can trivially get this one by running your code first and copying the answer.
Nobody will catch you. You will also have removed the only thing the checkpoint measures, in the
one problem in the track that is cheap to fail.

## The thing this problem is actually about

The public tests pass for implementations that are wrong.

They use one fixture, with a positive step. An implementation that never normalizes a negative
result passes them. So does one that skips the reduction on some rounds. The hidden tests use
several moduli, a negative step, a zero step, a start larger than the modulus, and zero rounds —
and they check *relations* rather than fixed values, so remembering one output does not help.

That gap between "my tests are green" and "my code is right" is the habit this whole track is
built on. In Week 1 it will be a constraint that is satisfied but under-specified. In Week 3 it
will be a curve operation that works everywhere except at infinity. In Week 5 it will be noise
that stays in budget for the example and blows past it for anything else.

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine, the Docker
daemon, and the image, so nothing inside that image is hidden from you: `reference/` and
`tests/hidden/` are not bind-mounted, which keeps them out of your git checkout rather than
out of reach.

What the verifier does guarantee is narrower and real: a submission cannot hang or crash it,
a checkpoint can only credit the id it echoes, results do not leak expected values, and the
fixtures come from this deployment's seed so a memorized answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources. It is a container on your machine.

## For authors

`make reference-test` runs the mutation suite: it breaks the reference implementation seven
different ways and asserts the hidden tests catch every one, plus two mutations aimed at the
verifier itself. Two obvious-looking mutations are deliberately **not** in the list — reducing
once at the end and leaving `start` unnormalized are mathematically identical to the reference
under Python's floored `%`, so no correct test could distinguish them. See the comment at the top
of `local/mutation.py`.

This problem's `courseAlignment` declares `week: 1` (Bridge 0 gates Week 1) with **no**
`sources[]`. That is deliberate, not an omission: the only upstream artifact that could plausibly
be cited is `week0/slide.pdf`, which `curriculum.md` records as out of scope — no week README
references it and this track does not map, open, or derive from it. The schema makes `sources`
optional precisely for this case. Never invent a commit SHA to fill the gap; see
`docs/curricula/advanced-cryptography-2026/GOVERNANCE.md` §5.
