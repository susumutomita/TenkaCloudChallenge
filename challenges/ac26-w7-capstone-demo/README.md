# A claim, and the experiment that could refute it

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 720 · **Chapter:** Week 7 / Capstone Build
· **Role:** `synthesis` · **Time:** 180–360 minutes · **Points:** 300
· **Required first:** `ac26-w7-capstone-design`

## The story

Week 7's design problem ended with a selection. This is the build.

Several parties each hold one number and want the sum. Nobody hands their number to anybody.
You implement the protocol — and then produce the evidence that it does what you say it does,
and nothing else.

The protocol is the short part. Additive shares, one round to distribute, one round to open
the partial sums. Most of the work is in the four checkpoints that ask you to *demonstrate*
something rather than compute it.

## The randomness contract

`run` receives its randomness as an explicit tuple. It never calls `random`.

That is not a style rule. It is what makes privacy measurable: with the randomness fixed and
finite, the entire probability space of a toy field can be enumerated, and what a coalition
sees can be compared across two different inputs with the same sum. A call to `random` cannot
be enumerated, and a privacy claim you cannot enumerate is one you asserted.

```text
randomness has setting.randomness_length entries, each in [0, modulus)
party i draws randomness[setting.slice_for(i)] -- exactly parties - 1 values
those are its first parties - 1 shares; the last is whatever makes them add to its input
```

## Three things that decide the grade

**A right answer is not evidence of a right protocol.** Close to half the mutations in this
problem compute the sum perfectly. The `transcript` checkpoint asks the questions that catch
them: is each opened value the sum of what that party actually received, and do the opened
values add up to the reported output? Without both, an implementation that returns the right
number while its transcript describes a different run passes.

**One coalition is not every coalition.** Take a protocol that draws no randomness at all.
Every party's shares become `[0, …, 0, x]`, so the last party receives everybody's input in
the clear — while from party 0's seat every received value is zero and the opened values match
across both worlds. Against party 0 it is *perfectly private*. An experiment that only asks
one coalition reports it as private. So sweep them.

**The threshold is not a defect.** With `parties - 1` colluding, the remaining input falls
out — because subtracting your own inputs from the sum leaves exactly one party's worth. No
protocol computing this function does better. It belongs in the scope statement, not in a
defect list.

## How to play

```bash
make inspect            # your setting, and how privacy is measured
make test               # public tests
make reset              # restore starter/capstone.py
```

You edit one file, `local/starter/capstone.py`.

## Scoring

Eight checkpoints, scored independently. Wrong answers cost 15 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `scope` | 30 | Two properties claimed, two disclaimed, and the threshold stated |
| `correctness` | 30 | The sum, on party counts, moduli, and inputs never shown |
| `transcript` | 40 | Opened values match what was received and reconstruct the output |
| `privacy` | 55 | The whole space enumerated; every coalition below the threshold swept |
| `threshold` | 40 | Recovery works at the threshold and returns nothing below it |
| `detect` | 55 | Your suite catches nine broken protocols it has never seen |
| `measure` | 25 | Counts taken off a real transcript, with units and environment |
| `evidence` | 25 | Every claim tied to an experiment that ran; no non-goal omitted |

Hints on five of the eight, each inside that checkpoint's 50% cap.

## `detect` grades your test suite, not your protocol

It is handed your own protocol, which must come back `False`, and nine broken ones you have
never seen, which must all come back `True`. A function listing known-bad cases does not pass.

Breakage comes in three families, and no single check finds all three:

| Family | Example |
|---|---|
| The output is wrong | a sum that is off by one |
| The output is right, the transcript leaks | an honest party's raw shares get opened |
| Both look right, the transcript disagrees with the run | opened values that do not reconstruct |

The third is the one most often missed.

## The toy warning

The moduli are small enough to enumerate, which means they are far too small to be secure.
That is the trade — observability, not security. The protocol is also semi-honest only: a
party that lies about its own input is not detected, and a party that stops responding stops
the run. Both are in `scope` as non-goals, and claiming either fails that checkpoint.

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

`make reference-test` runs the mutation suite: nineteen broken capstones plus two verifier
defects, all killed.

Two mutations were removed rather than baselined, both after being tried:

- narrowing the privacy experiment to the single coalition `(0,)` — against a *correct*
  protocol every coalition returns the same verdict, so nothing can distinguish it. The ground
  is held instead by the hidden test running its own sweep, and by `detect` handing the suite a
  protocol that leaks only to party 2;
- dropping the `% modulus` on drawn shares — the randomness contract fixes every draw in
  range, so the reduction is a no-op on every input the problem can produce. Killing it would
  mean inventing a robustness requirement the starter never states.

The sweep-every-coalition requirement came out of building this: an early version of the
privacy experiment checked party 0 only, and three separate broken protocols passed it —
including one that hands every input to the last party in the clear.

This problem also carries the base-image and verifier-bind fixes described in
`ac26-w7-capstone-design`'s README. The other AC26 problems still need them.
