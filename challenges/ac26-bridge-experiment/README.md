# Predict, then run

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 10 · **Chapter:** Bridge 0 / Experimental
Workflow · **Role:** `diagnostic` · **Time:** 20–30 minutes · **Points:** 100

## Why this problem exists

A plain integer talks about itself. Tell someone a running total came out at 5000 and they
already have a rough idea how many times you added — the size of the number is the clue. Compute
`mod 17` and the answer is always one of 0..16, so the size says nothing at all. Confining
numbers to a finite range is how cryptography closes that leak, and it is why nearly everything
later in this track is written "mod something".

The simplest thing with that shape is the counter you are about to finish: from `start`, add
`step` `rounds` times, folding back with the modulus every round. That is the entire program.

It is not cryptography yet, and it is worth seeing exactly why not. This walk runs backwards.
Knowing where it ended, find the number that multiplies `step` to 1 under the modulus, multiply,
and the number of steps falls out. `inspect` does that in front of you, on a walk from your own
deployment. The size leak is closed; a different way in is still wide open.

Which is why Week 3 keeps this walk and changes what is being walked on. Adding a point to
itself on an elliptic curve is the same operation, except that there the step count cannot be
recovered in practice — and that difference is the entire reason a signature means anything.
This is the cheapest place to look at it, because here you can run the recovery yourself in one
line.

You are joining a cryptography reading group that meets for seven weeks, and the person handing
you the laptop says: "we do not debug by guessing here. You say what will happen, then you run
it, and the gap between those two is where the learning is." So the problem also asks you to
predict before running, to read a trace and say where it first went wrong, and to write
something that survives inputs you were never shown. Every problem after this one assumes you
already work that way.

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
Everything lives in the browser: `inspect`, editing `counter.py`, the public tests, and
`prepare`. No host terminal or checkout editing is required.

`inspect` is the name of the command that shows you evidence. None of the checkpoints is called
that, so when this document says `inspect` it always means the command.

You edit one file, `local/starter/counter.py`. `advance(start, step, rounds, modulus)` must
return the trace: the value after each round, with the modulus applied **every** round, always
in `[0, modulus)`, for any sign of `step`.

Only when authoring or verifying straight from the repository, the same four commands exist as
make targets in the problem directory:

```bash
make inspect             # your fixture, your health token, the reversible walk, the broken trace
make test                # the public tests
make test-one ID=range   # re-run one public test while you iterate
make reset               # restore starter/counter.py
```

## Scoring

Four checkpoints, scored independently. Wrong answers cost 5 points each.

Two of the four values are produced for you by the Workbench's `prepare`; you copy them across.
The other two you work out yourself and type straight into the Portal — nothing in the problem
will compute them for you, and that is deliberate.

| Checkpoint | Points | Where the value comes from | What you submit |
|---|---:|---|---|
| `environment` | 20 | `prepare` | The health token, as printed |
| `predict` | 25 | **you, by hand** | The value after the last round, as one integer — worked out **before** you run anything |
| `first-broken` | 25 | **you, by hand** | The 0-based index where the broken trace first leaves `[0, modulus)`, as one integer |
| `generalize` | 30 | `prepare` | Your whole `counter.py`, run against parameters you have not seen |

Hints are available on `first-broken` (10) and `generalize` (10, then 5). Opening every hint
still leaves you 75 of 100.

On `predict`: you can trivially get this one by running your code first and copying the answer.
Nobody will catch you. You will also have removed the only thing the checkpoint measures, in the
one problem in the track that is cheap to fail. It matters because cryptographic output does not
show you whether it is correct — broken ciphertext is plausible-looking bytes, and an
under-constrained circuit accepts an honest witness without complaint. Deciding what must hold
before you run is the only thing that makes either visible.

## The other thing this problem is about

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

`corrupted_trace` picks the round it skips the reduction on from the rounds that actually wrap.
Picking blind looked equivalent and was not: when the skipped round would not have wrapped, the
corrupted trace equals the clean one and no entry leaves `[0, modulus)`, so `first-broken` had no
answer at all for roughly half of all seeds. The public tests pin the property over 200 seeds.

This problem's `courseAlignment` declares `week: 1` (Bridge 0 gates Week 1) with **no**
`sources[]`. That is deliberate, not an omission: the only upstream artifact that could plausibly
be cited is `week0/slide.pdf`, which `curriculum.md` records as out of scope — no week README
references it and this track does not map, open, or derive from it. The schema makes `sources`
optional precisely for this case. Never invent a commit SHA to fill the gap; see
`docs/curricula/advanced-cryptography-2026/GOVERNANCE.md` §5.
