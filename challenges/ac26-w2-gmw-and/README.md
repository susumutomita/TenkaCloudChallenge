# The one you did not choose stays closed

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 260 · **Chapter:** Week 2 / Boolean MPC
· **Role:** `mechanism` · **Time:** 50–70 minutes · **Points:** 200
· **Status:** draft — see "Week 2 alignment" below

## The story

Two parties hold XOR shares of two secret bits and need the AND — without either learning the
other's shares. XOR was free: it is linear mod 2 and finishes at home. Expand the AND and four
terms appear; two of them have their factors split across the two parties, and no amount of
local arithmetic conjures the missing half.

Somebody has already tried. Their draft skips the transfer entirely and lets each party AND its
own shares. It returns the right answer often enough to look done — and one of tonight's
recorded runs is sitting in your `inspect` output, waiting to be audited.

## The idea

1-out-of-2 Oblivious Transfer over a toy group keeps two promises at once: the **sender cannot
learn which message was chosen**, and the **receiver can read only the one it chose**. Plain
communication always breaks one of the two. Both promises turn out to be properties of where
the randomness comes from — and one of the checkpoints has you break a "hardened" receiver
whose only sin was excluding zero from its random range.

## Participant Portal workflow

1. Start the problem in Participant Portal; the problem editor appears on the same page.
2. Select **Inspect evidence** to read this deployment's group, the audited sender's public
   value, and the recorded run of the broken draft.
3. Edit the starter source in the Portal editor.
4. Select **Run public tests** and fill the direct-answer fields from your own reasoning.
5. Submit each checkpoint directly. Portal prepares and sends the current files and answers.

No checkout, terminal, local editor, second screen, or copy-and-paste step is required. Code
checkpoints use the current editor source. Direct answers are bound to the current deployment
seed, so a value copied from another deployment is rejected.

## Scoring

Five checkpoints, scored independently. Wrong answers cost 10 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `ot-request` | 40 | The request encodes the choice, accepts b = 0, rejects bad inputs |
| `ot-round-trip` | 50 | The chosen branch opens for both choices, **and** the other stays closed |
| `choice-leak` | 35 | The pair of request values that decide the choice, once 0 is dropped |
| `gmw-and` | 45 | All 16 share patterns, per-share views, and exactly two OT executions |
| `cross-term-audit` | 30 | Which patterns the OT-skipping shortcut breaks, said before running it |

Hints on three of the five (20 / 20 / 15). Opening every one still leaves 145 of 200.

## The two checkpoints that carry the problem

**`choice-leak`** is the range question made concrete. With b drawn from all of 0..q-1, both
request distributions are the whole subgroup and the wire says nothing. Exclude the single
value 0 and each choice loses exactly one request it can send — so observing that request
decides the choice. You submit the pair, with the directions right; either value alone can be
pattern-matched out of a sentence, but the pair requires seeing why each set lost a point.

**`gmw-and`** is graded per share, not per total. The XOR of the two output shares is invariant
under redistributing terms between them, so "the AND comes out right" cannot see a mask
cancelled in the wrong party's share. Each output share must be computable from the view its
party actually holds — and the hidden tests count the OT sessions, so a simulation that peeks
across the table and ANDs locally fails with a count of zero.

## What the public tests do not tell you

They run one round trip and one AND pattern. They never ask what the request reveals, whether
the branch you did not choose stays closed, or which patterns a shortcut breaks on. The
starter's encrypt seals both messages under one key: its round trip is green, and the receiver
can read the message it never chose. Only the wrong-branch probe sees that — the mutation suite
pins it.

## Week 2 alignment

Week 2's material is published upstream. The official exercise is `toy-mpc` (Part A: additive
secret sharing and Beaver multiplication over a finite field; Part B: 1-out-of-2 OT and a
GMW-style secret AND). `courseAlignment` pins `week2/README.md` as `lecture` and
`week2/problems/toy-mpc/README.md` as `assignment` at commit
`e4f33fec97c7938f27d3c6dc8ea8b1aeceb0aec9`. This problem sits beside **Part B** — the OT and
GMW AND steps — and completes the week: the five earlier companions cover Part A. The APIs,
fixtures and tests here are designed independently; nothing from the official exercise's
prose, template or tests is reproduced (GOVERNANCE.md independent-reimplementation), and
`status` stays `draft`, as it does across this track.

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

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite: seven broken implementations, one combined
mutant, and three probes aimed at the verifier. The combined mutant is the load-bearing one —
request ignores the choice *and* both branches share a key. Its round trip is green for both
choices, so a suite that only checked round trips would ship it; the suite asserts that
`check_round_trip` passes it and `check_wrong_branch` alone kills it. The mask-swap mutant is
the other trap: swapping which mask cancels in which share keeps z0 ^ z1 correct on every
pattern, which is why the hidden tests grade each share against its party's view and re-run
every seed with an unequal mask pair.
