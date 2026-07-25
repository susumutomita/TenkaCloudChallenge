# What it holds, what it breaks

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 20 · **Chapter:** Bridge 0 / Security
Properties · **Role:** `diagnostic` · **Time:** 30–45 minutes · **Points:** 200
· **Recommended first:** `ac26-bridge-experiment`

## The story

Three toy verifiers arrive for audit, written by three different teams, all shipped, all with a
green test run behind them. Your job is not to say which one is buggy — they all are. It is to
say **what each one still guarantees and what it no longer does**, and to prove each claim.

That distinction is the whole point. From Week 1 onward, completeness, soundness, privacy, and
zero-knowledge get used as if everyone agrees what they mean. Memorizing the definitions does not
survive contact with a real protocol. Breaking one property while the other two hold does.

## The claim

All three verifiers check the same statement:

```text
I know w such that   a*w + b == c  (mod p)   and   lo <= w <= hi
```

Small integer arithmetic on purpose. No proof system, no library — everything you reason about
fits on one screen, so the difficulty is the properties, not the plumbing.

## How to play

```bash
make inspect                    # your statement, what each verifier checks, a P3 transcript
make test                       # public tests
make test-one ID=classify       # iterate on one of them
make reset                      # restore both starter files
```

You edit two files:

- `local/starter/classify.py` — for each verifier, is it complete? sound? private?
- `local/starter/counterexamples.py` — prove every property you marked `False`.

## Scoring

Five checkpoints, scored independently. Wrong answers cost 10 points each.

| Checkpoint | Points | What you submit |
|---|---:|---|
| `incompleteness` | 40 | A witness that is genuinely valid, yet one verifier rejects |
| `unsoundness` | 45 | A witness outside the claimed range that one verifier accepts |
| `privacy-leak` | 40 | The witness, recovered from a transcript alone |
| `property-matrix` | 35 | The full 3 × 3 classification |
| `transfer` | 40 | Both of your files, run against instances you have never seen |

Hints are available on three of the five (15 / 15 / 12 + 8). Opening every one still leaves 150
of 200.

## The rule that makes this work

**A label you cannot demonstrate does not count.**

Marking a verifier unsound is one line of typing. The hidden tests cross-check every `False` in
your matrix against the matching counterexample, so a value that is inside the range submitted as
proof of unsoundness fails — it demonstrates nothing. Equally, a counterexample without a
consistent matrix fails, because producing a break you cannot classify is not understanding
either.

The `transfer` checkpoint then runs **your** classification and **your** generators against
instances derived from a seed you never see. A value that happened to work once will not survive
it; an expression that solves the statement will.

## Cost

Zero. No cloud account, no AWS resources. A container on your machine.

## For authors

`make reference-test` runs the mutation suite: six broken submissions plus two aimed at the
verifier itself, all of which must be caught.

One design note worth carrying to the later weeks. P1's defect is a strict lower bound on the
range, and on any instance whose witness sits strictly inside the range **P1 behaves exactly like
a correct verifier** — the incompleteness is real but unobservable. The `incompleteness`
checkpoint therefore uses a boundary instance whose honest witness is exactly `lo`. A property
being broken and a property being demonstrable are different things, and making the second one
true is the author's job, not the learner's.
