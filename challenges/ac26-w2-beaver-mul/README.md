# Multiplication is the one that has to talk

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 230 · **Chapter:** Week 2 / Beaver Triples
· **Role:** `mechanism` · **Time:** 40–60 minutes · **Points:** 200
· **Required first:** `ac26-w2-linear-shares` · **Status:** draft — see "Week 2 alignment"

## The story

The auditors can now add, scale, and combine their split-up figures without ever meeting. One
thing still defeats them: multiplying two numbers that are *both* split. Every attempt turns into
"well, first you tell me yours", which is the thing they built the scheme to avoid.

Someone points out that the hard part does not depend on the numbers. You can grind out the
awkward material in advance — the week before, overnight, whenever — and then the meeting itself
is short.

## The construction

A preprocessed triple `(a, b, c)` with `c = a*b`, shared out ahead of time and independent of
both inputs:

```text
d = x - a        e = y - b              each party, locally
open d, open e                          one round of talking
x*y = c + d*b + e*a + d*e               linear again, d and e now public
```

Three of those four terms are handled exactly the way the previous problem handled them. **The
fourth is not a sharing at all.**

## Browser workflow

1. Start the problem in Participant Portal and open **Browser Workbench**.
2. Run `inspect` to read this deployment's fixture and published evidence.
3. Edit the starter source in the in-browser editor.
4. Run `test` for the published checks and fill any direct-answer fields from the evidence.
5. Run `prepare`, then paste every prepared checkpoint value into Participant Portal.

No checkout, terminal, or local editor is required. Code checkpoints submit the edited source.
Direct answers are wrapped by `prepare` and bound to the current deployment seed, so a value copied
from another deployment is rejected.

## Scoring

Five checkpoints, scored independently. Wrong answers cost 10 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `mask` | 40 | `x - a` reconstructs correctly, across four settings |
| `open` | 30 | A canonical field element in `[0, p)`, not merely a congruent one |
| `combine` | 65 | Reconstructs to `x*y` — and the classic wrong answer is named |
| `protocol` | 30 | Your own four pieces run end to end, plus the round count |
| `transfer` | 35 | All of it under a seed you have never been shown |

Hints on two of the five (20 + 12 on `combine`, 10 on `protocol`). Opening all three still leaves
158 of 200.

## The term that is not like the others

`c + d*b + e*a` is linear in the shares, so each party computes its own row and stops. `d*e` is a
**public scalar**, and exactly one party folds it in. If everyone adds it, the shares sum to
`x*y + (n-1)*d*e`.

That is the same rule as adding a public constant in the previous problem — but it arrives in the
middle of a protocol, next to three terms that genuinely are per-party, which is why it is so much
easier to miss here.

It also hides well:

- at `n = 1` it is **indistinguishable** from correct;
- whenever `d` or `e` happens to be zero, `d*e` vanishes and it is again indistinguishable.

The hidden fixtures force `d ≠ 0` and `e ≠ 0` for exactly that reason, and the wrong total is
named explicitly rather than being left to an inequality. Those parameters are chosen for
observability — a real protocol draws a uniform mask and tolerates `d = 0`.

## Why d and e are safe to publish

`a` is uniform, made during preprocessing, and held by nobody in the clear. So `d = x - a` is `x`
under a one-time mask and reveals nothing about `x`.

Reuse the triple and that stops being true: the same `a` would mask two different secrets. This is
why each multiplication consumes its own triple, and why the offline cost scales with the number
of multiplications rather than being paid once.

## The round count is one, not zero

`d` and `e` open together, so a Beaver multiplication costs **one** round. Preprocessing does not
buy silence; it moves the input-independent work offline. A multiplication circuit of depth `D`
costs `D` rounds, which is why MPC latency tracks multiplicative depth rather than gate count.

## Where this leads

With multiplication in hand, any arithmetic circuit can be evaluated under MPC. What remains is
which openings leak what — the last two problems of Week 2.

## Week 2 alignment

Week 2's material was not published upstream at the commit `curriculum.md` records, so
`courseAlignment` pins `week2/README.md` with `kind: "placeholder"`, and `status` stays `draft`.
The pin records the *absence* of material at that commit rather than an alignment to it — which is
what lets `bun run course:drift` report `PUBLISHED` the day the material appears. #219 reconciles
the row before this leaves draft.

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

`make reference-test` runs the mutation suite: six broken submissions plus one aimed at the
verifier. Three of the six are near-miss forms of the public-scalar trap — folded into every
share, dropped entirely, and the two cross terms swapped — because each of those reconstructs to
something different and a test that only catches one is not enough.
