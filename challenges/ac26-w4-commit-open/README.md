# Ask me first and I can pass anything

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 420 · **Chapter:** Week 4 /
Commit–Challenge–Open · **Role:** `transfer` · **Time:** 60–90 minutes · **Points:** 300
· **Required first:** `ac26-w4-arithmetization` · **Status:** draft — see "Week 4 alignment"

## The story

A proof system's skeleton is three steps:

```text
1. the prover commits to data
2. the verifier chooses what to ask about
3. the prover opens that part
```

Swap 1 and 2 and the protocol proves nothing. You will build the honest version, then
demonstrate that attack yourself: the vector the `adaptive` checkpoint has you construct is
wrong in fifteen of sixteen positions, and its opening verifies.

## What has to be in a leaf

| Bound | Or else |
|---|---|
| the **index** | a leaf makes no claim about where it came from |
| **field boundaries** | `(1, 23)` and `(12, 3)` both render as "123" |
| the **direction** at each path step | the verifier can hash two ways and the prover picks |

The weak, separator-free encoding lives in the **fixtures**, not in your file. Breaking code
you deliberately weakened yourself is not a counterexample.

## How to play

```bash
make inspect            # the vector, the tree, the root, the query and its path
make test               # public tests
make reset              # restore starter/commit.py
```

You edit one file, `local/starter/commit.py`.

## Scoring

Eight checkpoints, scored independently. Wrong answers cost 15 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `encoding` | 35 | Index bound, value bound, no two pairs colliding, order-sensitive nodes |
| `root` | 30 | The commitment, and that reordering changes it |
| `opening` | 45 | Honest accepted; value, index, direction, length and range all rejected |
| `order` | 40 | Challenge before commit and open before challenge both refused |
| `adaptive` | 45 | The challenge-first counterexample |
| `ambiguity` | 40 | Two pairs colliding under the weak encoding and not under yours |
| `transcript` | 35 | The challenge depends on commitment, domain and statement |
| `transfer` | 30 | All of it under a length, query and seed you have not seen |

Hints on five of the eight, each inside that checkpoint's 50% cap.

## A note on equivalent mutants

The index-range and path-length checks in `verify_opening` **cannot be caught if removed**.
`LEAF_TAG` and `NODE_TAG` already mean a leaf hash never equals a node hash, so a path of the
wrong length recomputes to something that is not the root and the comparison rejects it anyway.
They are not in the mutation suite.

The range check in `Session.receive_challenge` is mutated instead — there a negative index
silently wraps and the prover opens a row nobody asked about, which is detectable.

Leaving an unkillable mutant in the list teaches that a `SURVIVED` line can be ignored. So it is
not left in.

## This is not a polynomial commitment

A Merkle root commits to a **vector**. It proves nothing about a polynomial's evaluation, and one
opening says nothing about the rows nobody asked about. There is a single query here, so a
guessing prover wins with probability `1/length` — soundness amplification is out of scope.

## Binding and hiding are different

A Merkle root gives **binding**. It does not give **hiding**: with a small value space, the
contents can be recovered from the root by brute force. Hiding needs separate randomness per leaf.

## Week 4 alignment

Week 4's material was not published upstream at the pinned commit. `courseAlignment` pins
`week4/README.md` with `kind: "placeholder"` and takes the `transfer` role, one of the two
`GOVERNANCE.md` §6 permits for an unpublished week. It asserts nothing about what the official
exercise will require. #229 reconciles the row when the material appears.

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

`make reference-test` runs the mutation suite: nine broken implementations. Every one of them
commits, challenges, opens and verifies successfully. They differ only in what an adversary can
do afterwards.
