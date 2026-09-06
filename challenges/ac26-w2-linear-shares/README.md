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
| `communication_rounds(operation)` | Classify each operation:0 if no exchange is needed, a positive integer otherwise | Does a local row suffice, or must parties exchange values? |

The first three return an ordered sequence of integers of the original length: a Python list `[0,6,0]` or tuple `(0,6,0)`. The examples below use lists. Each element must be an integer from 0 through p−1. Input lists have the same party count and ordering. The last returns one integer; booleans are not accepted as integers.

The general way to add a constant is to add agreed public offsets d[i]. The notation `u≡v (mod p)` means their remainders after division by p are equal:

```text
out[i] = (shares[i] + d[i]) % p
if (d[0] + … + d[n−1]) % p = c % p, the result totals x+c
```

`d=[c,0,…,0]` is the simplest construction. If everyone adds c, the result totals x+nc; its difference from the target is `(n−1)c`. The example becomes [0,1,2], total3 instead of6. When the difference has remainder0, for example c=0, these happen to agree. **A correct method must also work outside such coincidences.**

## See the communication boundary in equations

A **communication round** is a stage of exchanging values between parties. This task classifies **0 for unnecessary, a positive integer for necessary**; it does not count an exact protocol. The model starts with each party's additive shares, at least two parties, no extra numbers shared in advance for this computation, arbitrary secret inputs, and output that remains shared.

| Operation name | Intended computation |
|---|---|
| `add-shared` | x+y |
| `sub-shared` | x−y |
| `negate-shared` | −x (everyone scales by−1) |
| `add-constant` | x+c |
| `mul-constant` | cx |
| `mul-shared` | xy |
| `square-shared` | x² |
| `compare-shared` | compare x and y as integers in0..p−1 |

Decide by **writing the operation as an equation → listing what each party holds → checking whether the local results add to the target**. For addition, `(a0+b0)+(a1+b1)=x+y`, so no party needs to receive the other row. Apply that same check to subtraction and sign reversal.

For two parties:

```text
(a0+a1)(b0+b1) = a0b0 + a0b1 + a1b0 + a1b1
                       cross terms involve another party's share
```

Party0 lacks a1,b1; party1 lacks a0,b0. Adding local products omits the cross terms. Squaring also leaves the middle term in `(a0+a1)²=a0²+2a0a1+a1²` (hence the odd-prime condition).

Consider comparison as the bit1 when x>y, otherwise0. With two parties and p=7, fix both shares of y to0. Vary the shares a0,a1 of x:

| Party0 a0 / Party1 a1 | 0 | 6 |
|---|---:|---:|
| 0 | x=0 → comparison0 | x=6 → comparison1 |
| 1 | x=1 → comparison1 | x=0 → comparison0 |

Whatever local algorithms the parties choose, party0 returns a number F(a0) from its own share and party1 returns G(a1). F and G name arbitrary local calculations, not specific formulas. Their output-share sum must recover the comparison bit.

```text
top-left + bottom-right outputs = F(0)+G(0)+F(1)+G(6)
top-right + bottom-left outputs = F(0)+G(6)+F(1)+G(0)
```

Both right-hand sides contain the same four numbers, so their remainders must agree. But the table requires0+0=0 versus1+1=2, which differ modulo7. **No choice of local algorithms can satisfy all four cases.** Comparison therefore needs communication in this model. For any odd prime p, replace6 by p−1: the table is unchanged and0 and2 still differ. With more parties, fix their shares to0; their constant outputs occur equally on both sides and cancel. This argument concerns the stated additive-sharing model, not every cryptographic construction.

## Where to submit

| Checkpoint | What you supply |
|---|---|
| `add-shares` | add_shares in linear.py |
| `add-constant` | add_constant |
| `mul-constant` | mul_constant |
| `no-communication` | JSON with exactly the four displayed operation names |
| `transfer` | all three arithmetic functions and communication_rounds for all eight names |

The four code checkpoints submit the current linear.py. For `no-communication`, read **your four displayed names** and decide whether each formula can use only the local row. Enter single-line JSON in the shape `{"displayed-operation-name": your_integer, …}`. Replace each name and integer with your four decisions, separate the four pairs with commas, and enclose them in `{}`. This illustrates the format; complete your own four pairs before submitting.

Use exactly those displayed keys. Values are nonnegative integers;1 or2 both count as communication. Check Run public tests before Submit. Wrong answers cost10 points; all15 hints total94 points.

## What to check next

`transfer` checks the composition `c(x+y)+c` across other moduli and party counts. These are result-total and format checks, not a proof of every MPC security property. Proper randomness for the original shares and limits on who sees what remain necessary.

Finally, explain how public offsets other than [c,0,…,0] can still total c. Next, `ac26-w2-beaver-mul` addresses the cross terms of secret multiplication. These local additions alone do not implement a signature protocol or complete MPC.

## Python helpers

The computation helpers `collections`, `decimal`, `fractions`, `functools`, `hashlib`, `hmac`, `itertools`, `json`, `math`, `operator`, `random`, `statistics`, `time`, `typing` can be imported. They are loaded before your code runs. Loading other modules or accessing files/network is unsupported. Computation in public and submitted runs each allows up to20 seconds.

## Author scope and verification

This independent companion uses the published Week 2 toy-mpc assignment and the owner's Week 2 notes. courseAlignment points to published lecture/assignment sources; the lesson remains draft. It does not copy the course's signature implementation or solutions.

`make test` runs public tests; `make reference-test` runs author reference/mutation checks. `make verifier-down` stops that Compose environment. Record participant reading and runtime evidence in local/tests/hidden/READER.md.

Values returned by submitted code are distinct from authoritative grading. Public-test inputs and the grader's additional settings are separate. These checks cover totals, formats and classification, not a proof of full malicious-secure MPC. They do not hide data from a Docker administrator.

Local Compose creates no AWS resources. Containers consume host resources until stopped.
