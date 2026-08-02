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

That distinction is the whole point. From Week 1 onward, completeness, soundness, privacy and
zero-knowledge get used as if everyone agrees what they mean. Memorizing the definitions does not
survive contact with a real protocol. Breaking one property while the other two hold does.

## The claim

All three verifiers are handed the same kind of statement:

```text
I know w such that   a*w + b == c  (mod p)   and   lo <= w <= hi
```

Small integer arithmetic on purpose. No proof system, no library — everything you reason about
fits on one screen, so the difficulty is the properties, not the plumbing.

## What gets deployed

One container. No AWS account, no cloud resources, nothing to install. It holds this deployment's
statements and verifiers — derived from a per-deploy `FLAG_SEED`, so they are not the same as
anyone else's — and the `review` command you play it with. The only published port is a loopback
`/verify` the platform posts your flag to; you never touch it yourself.

## How to play

Start the problem in the portal and **attach the container terminal**. Everything happens there,
one line at a time. There is no file to edit, no editor to open, and nothing to clone.

```bash
review                            # the list of commands
review show                       # the claim, your statements, the verifiers, what to type next
review run <verifier> <w>         # free: verdict + record, on both statements
review reject <w>
review recover <w>
review forge <w>
review classify p1=<properties> p2=<properties> p3=<properties>
review transfer reject=<w> recover=<w> forge=<w>
review status                     # what you have cleared
review flag                       # TC{...}, once all five are cleared
```

`python /problem/review.py <command>` is the same thing, if you prefer to see where it lives.

`review show` is written to be the only thing you have to read. If you lose your place, run it
again.

### `run` is free, and it is the point

`review run` prints a verifier's verdict **and its record** on both statements, and records
nothing. Submissions are scored; runs are not. Every counterexample below is meant to be found by
experiment, not by guessing and paying for it.

### The two statements

Each panel carries a `main` statement and an `edge` statement. On the edge statement the honest
witness sits exactly on **one end** of its range — which end is for you to find, and two runs
settle it. That is not decoration: a verifier whose only defect is a strict range bound behaves
*identically* to a correct one on any statement whose witness sits strictly inside the range.

### The three demonstrations

| Stage | What you submit |
|---|---|
| `reject` | a witness a statement is **true** of, that one of the three refuses |
| `recover` | the value the honest run used, read back out of a record |
| `forge` | a witness a statement is **false** of, that one of the three accepts |

### `classify` — and only then

Once all three breaks are on the table, say for each verifier which properties it **still holds**:

```bash
review classify p1=sound,private p2=complete,private p3=complete,sound
```

A label you cannot demonstrate does not count, which is why this stage is locked until the
demonstrations are done. And note what it actually measures: your counterexamples already fixed
three of the nine entries. The other six are the question — every one of these verifiers is
broken, and every one of them still guarantees two of the three things.

### `transfer` — the same three, on a panel you have not seen

Once the first four stages are cleared, a second panel arrives. The defects sit on different
verifiers, the strict bound is on the other end of the range, the usable side of the congruence
is the other one, and the record counts the other way. The questions are deliberately the same
three: what is being measured is whether the reading survives a change of shape.

## Scoring

| | |
|---|---:|
| Correct flag | **200** |
| Wrong answer | −10 each |
| Hint 1 | −40 |
| Hint 2 | −60 |

Opening both hints still leaves 100 of 200. The flag is a `TC{...}` derived from this
deployment's seed: there is nothing to memorise from someone else's run and nothing to guess.
Which verifier carries which defect is drawn from that seed too, so the classification is not a
sentence that travels.

## Progress is kept in the container

`review status` reads a file under `/tmp`, the only writable path in the container (everything
else is mounted read-only). Recreating the container starts the five stages over. Once you know
the readings they take a few minutes to redo, and a durable volume would be one more thing that
can be wrong.

## Relationship to the official course

This is a `diagnostic`: it runs **before** the course material rather than alongside it, and it
gates the track rather than accompanying a particular week. That is also why it pins no upstream
`sources` — there is no specific lecture or exercise it is written against, and inventing a commit
SHA to fill the field would be worse than leaving it empty (`CATALOG.md` §`courseAlignment`).

No expression, fixture, or solution from the course is reproduced here. See `GOVERNANCE.md` §2
and §4.

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine, the Docker daemon,
and the image, so nothing inside that image is hidden from you. Be specific about what that means
here:

- `FLAG_SEED` is in the container's environment and the flag is derived from it, so the flag can
  be computed without clearing any stage.
- `fixtures/generate.py` — in the image, because `review show` is rendered from it — carries each
  statement's honest witness. Reading it hands you the answers to three of the five stages.

The five stages are a sequence to walk, not a lock to pick, and skipping them cheats nobody but
you. What the `author` stage split does buy is narrower: the reference answers and the suite that
grades them are not in the image you run, so you do not have to avert your eyes from a file that
solves the problem for you. What the seed buys is real: the statements, the assignment of defects
to verifiers, and the flag all come from this deployment, so an answer memorised from someone
else's run does not carry. And the classification is graded against a table the judge *computes*
by running the verifiers, not against a stored answer.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

This problem is played from the container terminal, so it ships nothing for a participant to edit
and sits outside the four-target participant contract in
[`TEMPLATE.md`](../../docs/curricula/advanced-cryptography-2026/TEMPLATE.md) rather than violating
it. The Makefile is an author tool and no participant ever sees it: `make play` opens a shell in
the participant image, which is what the portal terminal attaches to, and `make test` runs the
public self-check (interface properties only — it carries no answer).

`make reference-test` is the real one. It runs the reference answers across eight seeds, refuses a
catalog of near-miss wrong answers, breaks the judge one requirement at a time to confirm that
catalog kills every broken version, sweeps 120 seeds for panels that cannot pose their own
question, and drives the CLI to check that `run` records nothing, that both locks hold, and that
the flag is released for exactly one of the thirty-two progress states.

Two things that suite changed rather than merely checked:

- The two statements are drawn independently, and on roughly one seed in forty their honest
  witnesses came out **equal** — so `reject` and `recover` had the same answer, and a participant
  who did one reading was credited for two. The edge statement is now redrawn until it differs.
- `reject` originally graded against the edge statement alone. That made its "all three accept
  it" branch unreachable, so the requirement that *somebody actually refuses* could be deleted
  without changing a verdict. It now grades over both statements, which makes the main
  statement's own witness the near miss that requirement exists for.
