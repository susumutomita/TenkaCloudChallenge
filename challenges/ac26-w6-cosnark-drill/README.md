# Type one line, paste the value — the co-SNARK prover that never puts the witness back together

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 605 · **Chapter:** Week 6 / Drill:
co-SNARK on shares · **Role:** `mechanism` · **Time:** 40–60 minutes · **Points:** 200
· **Status:** draft — new companions need human play evidence (#465) before leaving draft

## What this is

Not a write-a-function problem. You open your own `python3`, paste the numbers the Portal's
"Inspect evidence" shows you, and then **type one line, paste the value it prints**, fourteen
times. The fourteen lines produce the core of a co-SNARK: two parties build a proof's pieces
(A, B, C) from a secret witness, without either one ever holding the witness whole.

```
1  (p, w)                          the witness, seen once for cross-checking   (no answer field)
2  (w0[1], w1[1])                  each wire's new share entry                 shares
3  reconstruct back to w           the check that sharing round-trips          (no answer field)
4  vary the secret, fix r0         a single share reveals nothing              (no answer field)
5  A's shares                      a linear form, computed on shares alone     ashares
6  (A opened, A direct)            shares and the clear computation agree      aopen
7  (B_sh, B)                       same recipe as A, for B                     bshares
8  (naive product, A*B)            the share-wise product is NOT the answer    crossmul
9  confirm a, b, c = a*b           the Beaver triple, opened once              (no answer field)
10 (d, e)                         the one round of communication               beaveropen
11 C's shares                      built from d, e and the triple's shares     cshares
12 C opened                        the reconstructed product                   csum
13 the textbook identity           why the shares reconstruct correctly        (no answer field)
14 candidate A's vs. d             why opening d never narrows down A          (no answer field)
```

Every line comes with "what this line means"; every matching value unlocks "read after it
matches". Eight of the fourteen lines have an answer field — the platform's per-problem maximum;
the other six are a one-time look, a cross-check, Beaver bookkeeping, or the closing reveal.

Three points the statement carries on purpose:

- **A linear combination (multiply by public coefficients, then add) finishes on shares alone.**
  Each party computes it locally from their own share; nobody sends anything. This is why most of
  a real SNARK prover's work (MSM, FFT) is "free" under co-SNARK.
- **The share-wise product is not the correct product.** Expanding the sum of shares produces
  cross terms that multiplying share-by-share drops — multiplication needs communication in a way
  addition does not.
- **A Beaver triple resolves the one multiplication in a single round.** Opening only `d = A - a`
  and `e = B - b` — values shifted by a triple's own random factors — lets each party build their
  share of C without ever seeing A, B, or the other party's share.

## Why the numbers are small and seed-derived

The field modulus is a 2–3 digit prime, the witness has two wires, and the Beaver triple's two
factors are similarly small — every line is a one-screen computation. The procedure is the
assignment `co-snark-prove`'s; the modulus, the witness, both coefficient vectors, and the Beaver
triple come from this deployment's `FLAG_SEED`. The assignment's own worked example (modulus 97,
witness [3, 5], coefficients [1, 2] / [4, 1], Beaver triple 5/9/45) and every value drawn from its
`tests/public.py` are excluded from generation, so no deployment can be solved by copying the
course material. There is one right value per line per seed; only the value your own Python
printed passes.

The witness `w` is shown on purpose: you are watching from outside the protocol, the way an
author verifying the mechanism would, not one of the two provers. What stays hidden is every
graded value — the drill is producing them yourself.

## Participant Portal

1. Start the problem in the Participant Portal. The problem editor appears on the same page.
2. Press **Inspect evidence**: the numbers are printed as Python assignment statements. Paste
   them into `python3` first.
3. Type the lines in order from line 1. On a line that has an answer field (line 2 is the
   first), paste the value into that field, submit, and read its "read after it matches" note.
   Continue to line 14. **Each answer field is a single-line input.**
4. If you cannot open Python: fill in the functions of `co_snark_drill.py` in the editor
   and press **Run public tests** — it prints your functions' values on this deployment's
   numbers, which is exactly what the REPL would print.

Direct answers are bound to the current deployment seed, so values copied from another
deployment are rejected.

## Scoring

Eight checkpoints, graded independently. A wrong answer costs 10 points.

| Checkpoint | Points | What it checks |
|---|---:|---|
| `shares` | 20 | each wire's newly-revealed share entry |
| `ashares` | 25 | A's linear form, computed on shares alone |
| `aopen` | 20 | the opened shares against the value computed directly from w |
| `bshares` | 25 | B's shares and B opened, same recipe as A |
| `crossmul` | 30 | the share-wise product (wrong) against the correct A*B |
| `beaveropen` | 25 | the one round of communication — d and e |
| `cshares` | 30 | C's shares, built with the Beaver correction |
| `csum` | 25 | C opened |

One hint per checkpoint (penalty 6), naming the usual slip on that line.

## Assurance scope

Local mode is **self-paced, honor-system verification**. Someone who owns the Docker daemon
and every image in the compose stack cannot be prevented from inspecting hidden material.
The boundary here is misdelivery, not confidentiality against that person: the participant
Workbench image contains the Portal editor API, the starter and the public tests only.
Like its Week 5 predecessors (`ac26-w5-rotation-drill`, `ac26-w5-negacyclic-drill`), this
problem's `fixtures/generate.py` derives the expected values in the same function as the public
numbers, so the module ships only in the separate, unpublished verifier image (Issue 537/543
option B2); the Workbench fetches this deployment's public half from the verifier's
`GET /public` over the Compose-internal network. `reference/` and `mutation.py` are added only
to the `author` stage.

Only the Workbench is published, at host `127.0.0.1:18163`; the verifier has no host port.
Both services run non-root with a read-only root filesystem, no capabilities, `no-new-
privileges`, and bounded memory/PIDs. A checkpoint can only credit the id it echoes, results
do not leak expected values, and the fixtures come from this deployment's seed so a memorized
answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer at all, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite: twelve broken references (the wire share built by
adding the randomness back instead of subtracting, a linear form's coefficients swapped,
crossmul's correct side added instead of multiplied, the Beaver open with the sign flipped, the
constant `d*e` correction forgotten in C's shares, the `a*b` term dropped from the textbook
identity, …) that the hidden suite must kill — both against this deployment's seed and against a
hand-checkable worked example independent of any seed — plus twelve verifier-level near-misses
(a coefficient vector mistaken for an answer, one Beaver factor mistaken for the opened value,
another line's value, a truncated tuple, a boolean, another deployment's answer) that the value
grader must refuse. The hidden suite also unit-tests the shared value-normalizer contract
(int / bool / hex / str, scalar and tuple) that this drill's sibling problems rely on. `make test`
and `make inspect` run through Compose because the participant image has no `fixtures/`: the
public numbers come from the verifier's `GET /public`.
