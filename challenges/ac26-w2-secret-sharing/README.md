# Split it, and still nobody knows

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 210 · **Chapter:** Week 2 / Additive Secret
Sharing · **Role:** `mechanism` · **Time:** 60–90 minutes · **Points:** 200
· **Status:** draft — see "Week 2 alignment" below

## The story

Five auditors need to compute a total across their books without any of them learning another's
figures. The plan on the whiteboard is simple enough: each number gets split into pieces, one per
auditor, and only the pieces added together mean anything.

Somebody has already written the split. It adds up correctly. It is also, as written, useless —
and the difference between "adds up correctly" and "keeps a secret" is the whole of this problem.

Then the auditors notice the other side of that split: lose one piece and the total is gone for
good. The last checkpoint asks for a split of a different shape — any two of three pieces bring
the secret back, and one piece alone still says nothing.

## The idea

Additive sharing over `F_p`: a secret `s` becomes `n` values summing to `s`. The arithmetic is
three lines. What makes it cryptography is that **any n-1 of those values are independent of the
secret** — and that is a claim you demonstrate, not one you assert.

## Participant Portal workflow

1. Start the problem in Participant Portal; the problem editor appears on the same page.
2. Select **Inspect evidence** to read this deployment's fixture and published evidence.
3. Edit the starter source in the Portal editor.
4. Select **Run public tests** and fill any direct-answer fields from the evidence.
5. Submit each checkpoint directly. Portal prepares and sends the current files and answers.

No checkout, terminal, local editor, second screen, or copy-and-paste step is required. Code
checkpoints use the current editor source. Direct answers are bound to the current deployment
seed, so a value copied from another deployment is rejected.

## Scoring

Five checkpoints, scored independently. Wrong answers cost 10 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `share-and-reconstruct` | 50 | Round trip across four settings, **and** the split is not trivial |
| `hides-the-secret` | 45 | Your completion works for **every** secret in the field |
| `threshold` | 45 | How many shares are needed, plus two witnesses |
| `rerandomize` | 30 | Secret preserved, output not identical to the input |
| `two-of-three` | 30 | A line split: any 2 of 3 points walk back to the secret (6 orders), each point alone fits every secret, on unseen moduli including two around 10⁴ |

Every one of the 5 checkpoints carries three hints (hint 1 = a self-check you can run before submitting, hint 2 = the case that is easy to miss, hint 3 = a walkthrough you can follow to a solution). Each checkpoint's hint penalties stay inside its 50% cap; opening all 15 still leaves 101 of 200.

## The three checkpoints that carry the problem

**`hides-the-secret`** sweeps the entire field. If, holding the same n-1 shares, you can produce a
consistent final share for *every* secret, then those n-1 shares are not evidence about the
secret. That is an executable definition of "it does not leak", and it beats any amount of prose.

**`threshold`** will not accept a number. You submit the count *and* two different secrets that
are both consistent with the same n-1 shares. Guessing the number is easy; building two witnesses
is not.

**`two-of-three`** is the ceiling. `share_line` / `reconstruct_line` are graded as a *pair*, by
property rather than against the reference: every choice of two of the three points, in either
order, must walk back to the secret, and for each party's point every secret in the field must be
producible at that position by some slope — checked by calling the participant's own `share_line`
p × p times, so any correct construction passes, not only a line. The moduli differ from the one
on screen and two are around 10⁴: the trial search for "the number that multiplies the divisor to
1" the statement offers costs ~p steps and fits the 12-second limit, a (secret, slope) brute force
costs ~p² and does not. The starter ships the tempting fix — a copy of the secret for everyone —
which passes the public tests and fails the privacy property, the first checkpoint's lesson replayed.

## What the public tests do not tell you

They check the round trip, and for the line split they check one pair of points. They never ask
whether a partial set hides anything — so the trivial split (hand the secret to party 0, give
everyone else zero) passes them cleanly while party 0 knows everything from the start, and so does
the starter's copy-to-everyone `share_line`. The hidden tests reject both by property.

## Week 2 alignment

Week 2's material was **not published upstream** at the commit `curriculum.md` records. This
problem therefore pins `week2/README.md` with `kind: "placeholder"` — a record of the *absence* of
material at that commit, not an alignment to it. `status` stays `draft`.

That pin is what lets `bun run course:drift` report `PUBLISHED` rather than `DRIFT` the day the
material appears; the Week 2 course-sync issue then reconciles the planned row and this problem's
alignment before it leaves draft.

## Assurance scope

Local mode is **self-paced, honor-system verification**. Someone who owns the Docker daemon and
every container in the compose stack cannot be prevented from inspecting hidden material. The
boundary here is misdelivery, not confidentiality against that person: the Workbench container
you build and run carries the starter and the public tests only — no fixtures, no hidden tests,
no reference solution, no verifier. Those live only in a second, unpublished container the
Workbench reaches over the compose network, and in the author-only image `make reference-test`
builds.

What the verifier does guarantee is narrower and real: a submission cannot hang or crash it,
a checkpoint can only credit the id it echoes, results do not leak expected values, and the
fixtures come from this deployment's seed so a memorized answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite: six broken additive submissions, eight
self-consistent two-of-three mutants (each one's `share_line` and `reconstruct_line` agree with
each other, so only a property can reject it), and three checks aimed at the verifier — a
`threshold` answer without witnesses, the starter's copy-to-everyone line split, and a
`reconstruct_line` that tries every (secret, slope) pair. That last one is correct and waits out
the verifier's 12-second limit on the ~10⁴ moduli, so the suite takes about 12 seconds; the limit
is surfaced as its §15 message, since the statement documents both the limit and that trying every
secret cannot meet it. One additive mutant — `reconstruct` forgetting the modulus — **survived the
first version of the hidden tests**, because `check_roundtrip` was normalizing the learner's answer
before comparing it. The check now requires the canonical element. That is the mutation suite doing
its job on the tests rather than on the submission.

The two-of-three privacy check is deliberately scheme-agnostic: for each party's point it searches
all p slopes for each of the p candidate secrets through the participant's own `share_line`, on the
small-modulus cases only (about 10⁵ calls, well under a second for the reference). The large-modulus
cases run only the pair check, with the secret drawn from the upper half of the field so that a
brute force counting up from 0 cannot finish early. Failure messages name the property (which pair
check, which party's point) and never a hidden value; the pair message does not say which pair, so
the paid hint that explains the pair whose x differ by 2 is not pre-empted (AGENTS.md §15).
