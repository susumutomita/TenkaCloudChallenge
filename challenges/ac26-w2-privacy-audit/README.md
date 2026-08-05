# The answer is right. That is all it is

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 240 · **Chapter:** Week 2 / Privacy Audit
· **Role:** `transfer` · **Time:** 60–75 minutes · **Points:** 300
· **Required first:** `ac26-w2-beaver-mul` · **Status:** draft — see "Week 2 alignment"

## The story

Three teams were asked to compute the same thing: a weighted risk total across three parties,
without anyone seeing anyone else's figure. All three shipped. All three return the right number.
The correctness suite is green on every one of them.

The privacy review did not come back the same.

## What you are auditing

A program here is an **operation list**, not Python source, and a runtime executes it and records
what an outsider could observe:

```text
open    a value is revealed to everyone
peek    a party reads somebody's raw share slot
emit    a log line carrying a value
fail    an error path carrying a value
output  the protocol's declared result
```

Local arithmetic produces no events at all. That asymmetry is the subject: a protocol is judged by
what it reveals, not by how much it computes.

Seven implementations. Four leak. Three do not — and two of those three are the awkward kind.

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

Seven checkpoints, scored independently. Wrong answers cost 15 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `allowed-opens` | 35 | The set of labels the specification permits to be revealed |
| `opened-secret` | 45 | An intermediate value opened — kind *and* position |
| `cross-party` | 45 | A party reading somebody else's slot, not its own |
| `log-leak` | 45 | A raw value escaping through a log line or an error message |
| `transcript` | 40 | The recovered private input, not just the accusation |
| `repair` | 50 | The violation removed, and every legitimate observation kept |
| `mutation` | 40 | Same verdicts under renamed labels, moved operations, an unseen seed |

Hints on six of the seven, each inside that checkpoint's 50% cap.

## A false positive costs what a miss costs

Every checkpoint mixes leaking and clean implementations, and the clean ones are chosen to punish
"flag everything":

- one logs a **weight**, which the specification publishes;
- one has a party read **its own** slot, which is what a party does.

Neither is a violation. What may be revealed is decided by the specification, not by the kind of
operation. An auditor that reports both finds every real leak and still fails.

## Why the programs are data

An auditor that greps for `reconstruct` is defeated by a rename, a wrapper, or a call through a
helper. Making the program an operation list means what gets audited is **the operations a run
actually performed** — so the mutation checkpoint can rename every label, move the independent
openings, and run under a seed you have never seen, and the verdict must not move. An auditor keyed
on label text, or on where a violation sat last time, contradicts itself there.

## Why naming the leak is not enough

The transcript of the over-opening implementation holds both a partial sum and the total. Their
difference is the last party's weighted contribution; the weight is public and `p` is prime. One
subtraction and one modular inverse hand you that party's private input.

Until you recover it, "this leaks" is a claim about the code. After you recover it, it is a fact
about somebody's data.

## Why "delete everything" is not a repair

Removing every observable operation also stops the leak, and the program still outputs the total.
So the repair checkpoint additionally requires that everything the specification permits to be
observed is **still observed** afterwards. A repair takes out the violation and nothing else.

## Threat model

Honest-but-curious parties, no collusion. Toy field, three parties, values small enough to check by
hand. This is a leakage contract you can observe in a simulator — not a security claim, and not a
model of a real MPC deployment.

The same view judged under a model that permits collusion gives a different verdict. A safety
judgement is made against assumptions, not against code.

## Where this leads

The separation drawn here — a correct output, and what was observable while producing it — is used
directly in Week 6's co-SNARK privacy audit.

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

`make reference-test` runs the mutation suite: seven broken auditors plus one aimed at the
verifier. Two of the seven are over-flagging rather than under-flagging, because a suite that only
punishes misses would certify an auditor that condemns every run.
