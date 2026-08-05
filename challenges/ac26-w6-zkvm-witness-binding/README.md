# The proof was valid. It was a proof about a different account

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 650 · **Chapter:** Week 6 / Programmable
Cryptography Stack Design · **Role:** `assignment-companion` · **Time:** 60–90 minutes ·
**Points:** 300 · **Required first:** `ac26-w6-zkvm-exploit-predicate` · **Status:** draft

## The story

A zkVM proof says that some run of some program produced this journal. That is all it says.

It does not say **which** program. It does not say **which** inputs. It does not say **what** is
being claimed. Those are things the guest has to say out loud, in bytes, in a way that means
exactly one thing — and if it says them badly, a perfectly valid proof becomes evidence for
something nobody intended.

So nothing is proved here. No circuit, no zkVM, no Rust. What is built is the contract around
the proof:

```text
the public statement   what is being asserted, and about what
the private witness    what the prover knew
the public journal     what the run publishes, forever, to everyone
```

`ac26-w6-zkvm-exploit-predicate` settled *what counts as an exploit*. This one asks the question
a proof system asks next: what has to be true about a guest's inputs and outputs so that a valid
proof is evidence for one statement and for nothing else?

## Two things moved, and both are why this is a separate problem

**The account is public input now.** `price`, `spent` and `budget` are no longer baked into a
target spec; they travel in the statement, and the same compiled guest proves claims about every
account there is. The only thing that says *which* account a proof is about is the statement it
was bound to.

**The arithmetic is public input too.** A `semantics` profile names the width *and* what the
hardware does when a result does not fit:

```text
wrapping     reduced modulo 2 ** width — the machine this exploit needs
saturating   clamped at the largest value the machine can hold
checked      the machine traps and the run stops
```

The claim has a witness on exactly one of the three. A journal that does not say which one it
ran under is a proof about whichever machine the reader assumes.

## The pair at the centre of it

Every seed draws **two real accounts**. Both are accounts somebody could really make a claim
about. Both have real exploits. Run their statements through an encoder with no length prefixes
and the two produce the same bytes:

```text
left   price=53 spent=7  budget=272   ->  "53" "7"  "272"   ->  537272
right  price=5  spent=37 budget=272   ->  "5"  "37" "272"   ->  537272
```

So a receipt sealed under `left` verifies against `right`. What comes out is **evidence that an
account nobody has touched is over its budget**, and nothing was forged to get it.

This is not a malformed statement slipping through a validator. It is a *valid* proof about one
real thing being a valid proof about a different real thing, with nothing in the cryptography
broken while it happens.

`naive_encode` is not a straw man either. The field order is fixed, every field is present, and
nothing is dropped. It is still not an encoding, because the boundary between one field and the
next is not in the output. That is what the length prefix is for.

And that pair is not the only one that has to stay apart. Two statements differing only in
`domain`, and two differing only in `guestVersion`, are different statements — and those are the
two people drop first, because they "do not affect the computation".

## A digest is about the bytes that run

An image record carries the `body` that actually executes, and two labels a toolchain wrote next
to it. You are handed four siblings of the base image, each one change away:

```text
rebuilt     same source path, one comparison changed, a new stamp  -> a different program
restamped   the same steps, a different build stamp                -> a different image
renamed     the same bytes, another path                           -> the same program
relabelled  the same bytes, another image id                       -> the same program
```

A digest over `sourcePath` calls the rebuild the base image — and those two disagree about every
order whose total lands exactly on the budget, which is the order an attacker picks. A digest
over `imageId` calls the relabelled copy a different program, and a perfectly good proof is
refused for a reason nobody can find.

`restamped` is the one that feels arbitrary. Settle it the way proving systems settle it: a
rebuild is a different image even when nothing observable changed, because **"nothing observable
changed" is the claim under audit rather than an input to it**.

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

Eight checkpoints, scored independently. Wrong answers cost 15 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `encoding` | 45 | Length-prefixed, fixed-width, fixed-order bytes that separate every pair in the family |
| `identity` | 30 | A digest over the bytes that run, not over either label beside them |
| `ingestion` | 35 | The whole statement public, the whole witness private, and nothing in the transcript |
| `reexec` | 45 | Recomputed rather than hinted, fail-closed on the wrong image, three overflow behaviours |
| `journal` | 35 | A commitment to the whole statement, and one measurement a reader could already compute |
| `replay` | 50 | Receipts offered against something one field away, and journals edited after sealing |
| `privacy` | 35 | Six channels, and an approved name carrying a value it was never approved for |
| `transfer` | 25 | All of it on an account, a claim and a protocol version you have not seen |

Hints on seven of the eight (14–24 each). Opening every one still leaves 174 of 300.

## The happy path is the easy half

This problem ships 55 deliberately broken guests, and **42 of them still produce a receipt that
verifies on the happy path and still refuse one offered against a different program** — the two
questions anybody writing a test for a guest contract asks first. `make reference-test`
re-measures that count on every run.

Both of those are written out in the problem text above, so nobody has to discover them, and a
suite that asks only those two agrees with forty-two wrong contracts. What is not written out —
that two real accounts can share an encoding, that the host's account of the run is confidently
wrong, that a journal field a verifier reads is a journal field an attacker writes, and that an
approved name is not an approved value — is why there are checkpoints instead of one test.

## The host's account is an input, not the answer

`env.hints()` carries the host's own account of what the run produced. On the runs the checker
builds, every field of it is wrong. The host is the party being proved about, so its answer is
an input to the guest's work and never a substitute for it. A guest that takes the hint is fast,
is right almost always, and proves nothing at all.

The same reasoning is why an image the statement does not name is refused **before a single step
runs**. Executing first and reporting which program it was afterwards produces a run somebody can
quote out of context.

## One mutation was dropped rather than left to survive

Having `run_guest` report `statement["imageDigest"]` instead of the digest it computed is
**undetectable**. The function refuses before running whenever the two differ, so on every input
that reaches the report they are equal, and no input separates the two spellings.

The distinction is real one level up — the refusal is what makes them equal, and the mutation
that removes *that* dies immediately. The unkillable one was written and then removed rather
than shipped as a survivor, because a `SURVIVED` line that can be explained away teaches that
`SURVIVED` lines can be explained away.

## What the suite proves, and what it does not

It proves that these eight checkpoints catch the 55 defects shipped with the problem, that the
reference clears all eight, and that the shipped starter clears none. It does **not** prove that
the contract has no other hole: a defect nobody wrote down is a defect nobody measured.

## Where this leads

Week 6 ends here. Week 7's capstone starts from a brief that names actors, assets and trust, and
names no primitive at all. What carries over is the habit this one drills: a proof is evidence
for exactly the statement it was bound to, and everything that makes that sentence true is
something you have to write down yourself.

## Not in scope

Actual zkVM proof generation and receipt verification, production binary reproducibility
systems, the zero-knowledge property of a specific zkVM, and remote attestation.

## This is not secure

The width is seven to thirteen bits, there is one account, the program is four steps, and a
receipt carries no seal. Verifying a seal is precisely the part cryptography already does for
you, which is why it is out of scope — and why the binding it is useless without is not. In a
real zkVM the statement is a program's ELF digest and a list of public inputs, and the journal is
the output the proving system commits to.

## Source alignment

Week 6's material is published upstream, so `courseAlignment` pins `week6/README.md` and
`week6/problems/zkvm-exploit/README.md` at commit `5e80999306608a45aecf9a0e4e3394a0b62f34d2`.
Nothing is reproduced from the official exercise: the statement shape, the image format, the
opcode set, the fixtures, the disclosures and the solution are written independently, and the
official exercise is Rust while this one is Python. The subject — what a guest has to publish so
that a proof is about one thing — is the one the course names, and it is named in the course's
own README, so nothing here is a shortcut through that assignment.

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine, the Docker daemon,
and the image, so nothing inside that image is out of your reach: `reference/` and
`tests/hidden/` are not bind-mounted, which keeps them out of your git checkout rather than out
of your way. The same is true of the replay verdicts and the disclosure answers the hidden
checker compares against — a contract that imports them has bound nothing, and only you can
decide not to.

What the verifier does guarantee is narrower and real: a submission cannot hang or crash it, a
checkpoint can only credit the id it echoes, results do not leak expected values, and the width,
the account, the protocol namespace and the guest build come from this deployment's seed, so a
memorized answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite inside the image: 55 broken guests plus one aimed
at the verifier itself. It first confirms that the reference clears all eight hidden phases, then
breaks the reference fifty-five ways and prints how many of them still get the easy two right.
That count is the number this README quotes — if a later edit makes the checkpoints cheaper, the
number moves and the claim has to move with it.
