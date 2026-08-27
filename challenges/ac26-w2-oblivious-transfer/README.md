# Choosing without saying which

> 日本語版: [README.ja.md](./README.ja.md)

Week 2, problem 6. Track `advanced-cryptography-2026`, order 260.

The five earlier Week 2 problems cover arithmetic MPC. The published official assignment's
Part B takes a different route through oblivious transfer and GMW Boolean MPC. This problem
fills that missing half: how two parties who have deposited no trust with each other can
compute together without handing over their secrets.

Oblivious transfer is the smallest answer. The sender offers two messages; the receiver
takes exactly one; the receiver learns nothing about the other, and the sender does not
learn which one was taken. With it you can evaluate any Boolean circuit between two
mutually suspicious parties — which is what the second half of this problem does.

## What you build

**Part 1 — the transfer.** In a subgroup of order `q` inside `Z_p*`, the sender publishes
`A = g^a`. As receiver you send

```text
B = g^t          to ask for message 0
B = A * g^t      to ask for message 1
```

and the sender, unable to tell those apart, replies with message 0 under the key for `B^a`
and message 1 under the key for `(B/A)^a`. Exactly one of those is `A^t`, which you can
compute; the other would need a discrete log.

**Part 2 — an AND gate.** With `x = x0 ^ x1` and `y = y0 ^ y1` split across two parties,

```text
(x0 ^ x1) & (y0 ^ y1)  =  x0y0 ^ x1y1 ^ x0y1 ^ x1y0
```

The first two terms are local. Each of the other two is bought with one transfer. XOR
needs no transfer at all — it is linear over the shares.

## The part that is actually the problem

**Two of these functions have an implementation that is correct on every input and still
hands a secret to the other side.** Both pass the public tests.

- The receiver's blind. Privacy here is a statement about a *distribution*: `B` must look
  the same whichever choice was made. Draw `t` from the whole of `0..q-1` and it does.
  Exclude `0` — the reflex for a secret exponent — and `B = 1` becomes reachable only
  under choice 1, `B = A` only under choice 0. Two elements out of `q` name the bit.
- The gate's masks. They cancel when the two output shares are XORed, so reconstruction is
  correct whether you draw one mask or two. With one, each party's output share becomes a
  function of the other party's secret bits: a party holding `x0 = 0, y0 = 1` reads `x1`
  straight off its own share.

Neither is caught by "the message arrived" or "the gate reconstructed", because neither is
a property of one run.

## Participant Portal workflow

1. Start the problem in Participant Portal; the `oblivious.py` editor appears on the same page.
2. Select **Inspect evidence** to see your group, key, session, and gate shares.
3. Edit the starter in the Portal and select **Run public tests**.
4. Submit all six checkpoints. Portal sends the current source through the prepare API and
   submits the prepared value directly for scoring.

No checkout, terminal, local editor, second screen, or copy-and-paste step is required. Every
checkpoint uses the source currently shown in the editor.

Authors and local learners can also use:

```bash
make inspect   # your group, key, session, and the gate's shares
make test      # public tests: shape, and one successful transfer
make reset     # restore starter/
```

Edit `local/starter/oblivious.py` only. `make reference-test` is the authoring path and
runs the hidden and mutation suites inside the image.

## Checkpoints

| id | what it wants | points |
| --- | --- | --- |
| `request` | the choice encoded as a shift by the public key | 30 |
| `choice-privacy` | a blind range under which both choices produce the same requests | 40 |
| `transfer` | exactly one message recoverable | 35 |
| `and-gate` | AND from two transfers; XOR classified as local | 45 |
| `gate-privacy` | independent masks, so a party's view does not move with the other's secrets | 30 |
| `unseen` | the whole thing under a seed you were never shown | 20 |

Every one of the 6 checkpoints carries three hints (hint 1 = what is being asked, hint 2 = how to think about it, hint 3 = a walkthrough you can follow to a solution). Each checkpoint's hint penalties stay inside its 50% cap; opening all 18 still leaves 107 of 200.

## Assurance scope

Local mode is **self-paced, honor-system verification**. Someone who owns the Docker daemon
and every container in the compose stack cannot be prevented from inspecting hidden material.
The boundary here is misdelivery, not confidentiality against that person: the Workbench
container you build and run carries the starter, the public tests and the supplied key
derivation only — no fixtures, no hidden tests, no reference solution, no verifier. Those
live only in a second, unpublished container the Workbench reaches over the compose network,
and in the author-only image `make reference-test` builds.

What the verifier does guarantee is narrower and real: a submission cannot hang or crash it,
a checkpoint can only credit the id it echoes, results do not leak expected values, and the
fixtures come from this deployment's seed so a memorized answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs ten broken submissions plus three verifier probes. They include a
blind excluding 0, reused and one-sided masks, and a reversible encoding that carries both
plaintexts. Each names a way a protocol can work while failing to hide. If any survives, the
problem has stopped teaching the distinction it exists to teach.

## Course alignment

Companion to Week 2 of the Advanced Cryptography Program 2026, pinned to
`week2/README.md` and `week2/problems/toy-mpc/README.md`. It accompanies the official
exercise's Part B (oblivious transfer and the GMW secret AND), which the rest of this
track's Week 2 problems do not reach — see
[`docs/curricula/advanced-cryptography-2026/curriculum.md`](../../docs/curricula/advanced-cryptography-2026/curriculum.md).

Written without reading the official solution, template, or test modules;
`spoilerPolicy` is `independent-reimplementation`.

The parameters are small enough to read and far too small to use — discrete log in these
groups is a few hundred trial multiplications. They are chosen to make the failures
observable, not to withstand anything.
