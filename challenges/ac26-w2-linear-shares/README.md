# What you can do without talking to anyone

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 220 · **Chapter:** Week 2 / Local Linear
Operations · **Role:** `mechanism` · **Time:** 35–50 minutes · **Points:** 200
· **Required first:** `ac26-w2-secret-sharing` · **Status:** draft

## Before you start

You repair a tool that computes without collecting everyone's secret. **Start → Inspect evidence → edit linear.py → Run public tests.** Each checkpoint's Submit button grades it. Begin by fixing the public constant that the starter adds to every share.

**Multi-party computation (MPC)** lets several parties compute while hiding their inputs from one another. One ingredient is **secret sharing**: split x into numbers that add back to x. Each party's portion is a **share**. This exercise implements addition and public scaling of those shares.

## Each party uses its own row

There are at least two parties. Arithmetic uses **remainders after division by an odd prime p**. Python `% p` puts even negative results in 0..p−1. `a[i]` is party i's share of x; `b[i]` is the same party's share of y.

```text
x = (a[0] + … + a[n−1]) % p
y = (b[0] + … + b[n−1]) % p
local row calculations → new shares → their total recovers the result
```

Real parties see their own row. **This teaching editor shows all rows together so you can inspect the arithmetic.** Adding the displayed rows recovers the secret; the screen itself is not a confidentiality demonstration.

One-digit example: p=7, x=4 has shares [5,6,0], y=3 has shares [1,0,2], and the public constant c=2 is known to everyone.

| Party | Share a of x | Share b of y | x+y: add each row | 2x: double every row | x+2: add2 only to party0 |
|---|---:|---:|---:|---:|---:|
| 0 | 5 | 1 | 6 | 3 | 0 |
| 1 | 6 | 0 | 6 | 5 | 6 |
| 2 | 0 | 2 | 2 | 0 | 0 |
| Total remainder | 4 | 3 | 0 | 1 | 6 |

x+y=7 leaves0, 2x=8 leaves1, and x+2=6. Each column recovers the intended result.

## Formulas and four functions

| Function | Local calculation | Why it works |
|---|---|---|
| `add_shares(a,b,p)` | `out[i]=(a[i]+b[i])%p` | Rearranging the total gives x+y |
| `mul_constant(shares,c,p)` | `out[i]=(shares[i]*c)%p` | Distributivity gives cx |
| `add_constant(shares,c,p)` | Add c only at index0; keep the other values; normalize all with `%p` | The total gains c once |
| `communication_rounds(operation)` | Return0 or1 using the table below | Does a local row suffice, or must parties exchange values? |

The first three return integer lists of the original length. Input lists have the same party count and ordering. The last returns one integer; booleans are not accepted as integers.

The general way to add a constant is to add agreed public offsets d[i]. The notation `u≡v (mod p)` means their remainders after division by p are equal:

```text
out[i] = (shares[i] + d[i]) % p
if (d[0] + … + d[n−1]) % p = c % p, the result totals x+c
```

`d=[c,0,…,0]` is the simplest construction. If everyone adds c, the result totals x+nc; its difference from the target is `(n−1)c`. The example becomes [0,1,2], total3 instead of6. When the difference has remainder0, for example c=0, these happen to agree. **A correct method must also work outside such coincidences.**

## See the communication boundary in equations

A **communication round** is a stage of exchanging values between parties. This task classifies **0 for unnecessary, a positive integer for necessary**; it does not count an exact protocol. The model starts with each party's additive shares, at least two parties, no extra numbers shared in advance for this computation, arbitrary secret inputs, and output that remains shared.

| Operation name | Meaning | Classification in this model |
|---|---|---:|
| `add-shared` | x+y | 0 |
| `sub-shared` | x−y | 0 |
| `negate-shared` | −x (everyone scales by−1) | 0 |
| `add-constant` | x+c | 0 |
| `mul-constant` | cx | 0 |
| `mul-shared` | xy | positive |
| `square-shared` | x² | positive |
| `compare-shared` | compare x and y as integers in0..p−1 | positive |

For two parties:

```text
(a0+a1)(b0+b1) = a0b0 + a0b1 + a1b0 + a1b1
                       cross terms involve another party's share
```

Party0 lacks a1,b1; party1 lacks a0,b0. Adding local products omits the cross terms. Squaring also leaves the middle term in `(a0+a1)²=a0²+2a0a1+a1²` (hence the odd-prime condition).

Rowwise comparison also fails. With p=7, a=[6,6], b=[1,1], each row has a>b and the totals give5>2. But a=[4,4], b=[2,2] still has a>b in each row, while the totals give1<4. Reduction wraps around. This is a counterexample to simple rowwise comparison, not an impossibility proof for every cryptographic method.

## Where to submit

| Checkpoint | What you supply |
|---|---|
| `add-shares` | add_shares in linear.py |
| `add-constant` | add_constant |
| `mul-constant` | mul_constant |
| `no-communication` | JSON with exactly the four displayed operation names |
| `transfer` | all three arithmetic functions and communication_rounds for all eight names |

The four code checkpoints submit the current linear.py. For `no-communication`, classify **your four displayed names** using the table and enter single-line JSON. Only if the names are add-shared, sub-shared, mul-shared and square-shared would it look like this:

```json
{"add-shared":0,"sub-shared":0,"mul-shared":1,"square-shared":1}
```

Use exactly those displayed keys. Values are nonnegative integers;1 or2 both count as communication. Check Run public tests before Submit. Wrong answers cost10 points; all15 hints total94 points.

## What to check next

`transfer` checks the composition `c(x+y)+c` across other moduli and party counts. These are result-total and format checks, not a proof of every MPC security property. Proper randomness for the original shares and limits on who sees what remain necessary.

Finally, explain how public offsets other than [c,0,…,0] can still total c. Next, `ac26-w2-beaver-mul` addresses the cross terms of secret multiplication. These local additions alone do not implement a signature protocol or complete MPC.

## Author scope and verification

This independent companion uses the published Week 2 toy-mpc assignment and the owner's Week 2 notes. courseAlignment points to published lecture/assignment sources; the lesson remains draft. It does not copy the course's signature implementation or solutions.

`make test` runs public tests; `make reference-test` runs author reference/mutation checks. `make verifier-down` stops that Compose environment. Record participant reading and runtime evidence in local/tests/hidden/READER.md.

Values returned by submitted code are distinct from authoritative grading. Public-test inputs and the grader's additional settings are separate. These checks cover totals, formats and classification, not a proof of full malicious-secure MPC. They do not hide data from a Docker administrator.

Local Compose creates no AWS resources. Containers consume host resources until stopped.
