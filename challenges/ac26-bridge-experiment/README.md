# Predict, then run

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 10 · **Chapter:** Bridge 0 / Experimental
Workflow · **Role:** `diagnostic` · **Time:** 40–60 minutes · **Points:** 100

## Start here

Think about a clock. Three hours after 10 o'clock is 1 o'clock, not 13. Go past 12 and you come
back round.

Do the same thing with, say, 10. As soon as a number reaches 10, take 10 off it.

```text
12 reaches 10 -> 12 - 10 = 2
 9 does not   ->  9 stays as 9
```

Every answer is one of 0 to 9. "Take the remainder after dividing by 10" is another way of
saying the same thing. Instead of climbing forever, you go round a ring.

```text
        0
    9       1
  8           2     <- a ring of just 10 numbers, 0 to 9
  7           3
    6       4
        5
```

From 6, three steps takes you to 9. From 9, three steps is not 12: you pass 0 and land on 2.

That 10 is only an example for this page. The numbers you work with come from `inspect`.

## Why this problem exists

With ordinary addition, the size of the answer is a clue. Tell someone a running total came out
at 5000 and they already have a rough idea how many times you added. Going round a ring, every
answer is one of 0 to 9 and the size says nothing at all. Penning numbers in like this is how
cryptography closes that leak, and it is why nearly everything later in this track is written
"the remainder after dividing by something".

What you are about to write is a walk round that ring: from one number, add a fixed number each
time, take the excess off whenever it goes past the end. That is the entire program.

It is not cryptography yet, and it is worth seeing exactly why not. The number of times you
added comes back out with a single multiplication. `inspect` does that in front of you, with the
numbers from your own deployment. The size of the answer is hidden; a different way in is still
wide open.

Which is why Week 3 keeps this walk and changes what is being added — a thing called an elliptic
curve. The operation is the same, except that there the number of times cannot be recovered in
practice, and that difference is the entire reason a signature means anything. This is the
cheapest place to look at it, because here you can run the recovery yourself in one line.

You are joining a cryptography reading group that meets for seven weeks, and the person handing
you the laptop says: "we do not debug by guessing here. You say what will happen, then you run
it, and the gap between those two is where the learning is." So the problem also asks you to
predict before running, to read a list of numbers and say where one does not belong, and to
write something that survives inputs you were never shown. Every problem after this one assumes
you already work that way.

## What gets deployed

Two containers, no cloud account, no network surface reaching outside your machine. Everything
is local:

```text
local/
├── starter/counter.py       ← the only file you edit
├── participant/server.py    the Workbench you actually talk to, on 127.0.0.1:18091
├── fixtures/generate.py     every fixture, derived from your per-deploy seed (verifier only)
├── tests/public/            the tests you can read
├── tests/hidden/            the tests the verifier runs (verifier only, not mounted)
├── reference/               the answer (author-only image, not mounted -- see Assurance scope)
├── verifier/server.py       POST /verify, reachable only from the Workbench container
└── mutation.py              proves the hidden tests can actually fail a wrong answer
```

The Workbench you build and run never has `fixtures/`, `verifier/`, or `tests/hidden/` on its
filesystem at all: it asks the second, unpublished container for the evidence it shows you, over
a network nothing outside this machine can reach either.

Your fixtures come from `FLAG_SEED`, injected fresh at deploy. Same seed, same numbers, so your
session is reproducible and debuggable. Different seed, different numbers, so a value copied from
someone else's run is worthless.

## How to play

Start the problem from Participant Portal. Its editor appears on the same page as the statement.
Inspect the evidence, edit `counter.py`, and run the public tests there. No host terminal or
checkout editing is required.

`inspect` is the name of the command that shows you evidence. None of the boxes you fill in is
called that, so when this document says `inspect` it always means the command.

You edit one file, `local/starter/counter.py`. `advance(start, step, rounds, modulus)` must
return the numbers you get, in order, one for each time you add: with the excess taken off
**every** time, always 0 or more and smaller than `modulus`, whether `step` is positive or
negative.

Only when authoring or verifying straight from the repository, the same four commands exist as
make targets in the problem directory:

```bash
make inspect             # your four numbers, your pass phrase, the run that comes back out,
                         # and the list with one number out of place
make test                # the public tests
make test-one ID=range   # re-run one public test while you iterate
make reset               # restore starter/counter.py
```

## Scoring

Seven boxes, marked independently. Wrong answers cost 5 points each.

| Box | Points | Where the value comes from | What you write |
|---|---|---|---|
| `environment` | 10 | Portal | Just press Submit; the pass phrase is sent for you |
| `predict` | 10 | **you, by hand** | The number you end on, as one number — worked out **before** you run anything |
| `first-broken` | 10 | **you, by hand** | Which position holds the number that does not belong, counting from 0 at the left |
| `generalize` | 20 | Portal | Your whole `counter.py`, run against numbers you have not seen |
| `walkback` | 15 | **you, by hand** | From the second walk's final number, how many rounds it took (the recipe is in the statement) |
| `no-walkback` | 15 | **you, constructed** | Keeping that walk's step, one ring size on which no undo number exists (graded as a property) |
| `count-no-walkback` | 20 | Portal | `count_no_walkback` in `counter.py`: how many ring sizes in a range cannot undo the step; ranges reach 10^12, so a one-by-one walk times out |

Hints are available on `first-broken` (5), `generalize` (5, 5), `walkback` (4, 3), `no-walkback` (4, 3) and `count-no-walkback` (5, 5). Opening every hint
leaves 61 of the 100 points.

On `predict`: you can trivially get this one by running your code first and copying the answer.
Nobody will catch you. You will also have removed the only thing the box measures, in the one
problem in the track that is cheap to fail. It matters because cryptographic output does not
show you whether it is correct — broken ciphertext is plausible-looking bytes, and an
under-constrained circuit accepts an honest witness without complaint. Deciding what must hold
before you run is the only thing that makes either visible.

## The other thing this problem is about

The public tests pass for implementations that are wrong.

They add a positive number, one set of values only. An implementation that never brings a
negative result back into range passes them. So does one that forgets to take the excess off
on some of the additions. The hidden tests use several moduli, a negative step, a zero step, a
start larger than the modulus, and zero rounds — and they check *relations* rather than fixed
values, so remembering one output does not help.

That gap between "my tests are green" and "my code is right" is the habit this whole track is
built on. In Week 1 it will be a constraint that is satisfied but under-specified. In Week 3 it
will be a curve operation that works everywhere except at infinity. In Week 5 it will be noise
that stays in budget for the example and blows past it for anything else.

## Assurance scope

Local mode is **self-paced, honor-system verification**. Someone who owns the Docker daemon and
every container in the compose stack cannot be prevented from inspecting hidden material. The
boundary here is misdelivery, not confidentiality against that person: the Workbench container
you build and run carries the starter, the public tests, and nothing else — no fixtures, no
hidden tests, no reference solution, no verifier. Those live only in a second, unpublished
container the Workbench reaches over the compose network, and in the author-only image
`make reference-test` builds.

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
