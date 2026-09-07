# Build the field before the curve

> Independent, unofficial companion to Advanced Cryptography Program 2026. Not affiliated with or endorsed by its course operators.

## Start by turning −2 into remainder 5

You are building division for cryptographic arithmetic. Instead of ordinary fractions, use an **inverse: a partner whose product leaves remainder 1**.

`FieldElement` is a type storing a modulus and a remainder. Its `__init__` method (a function inside a type) runs when an element is created.

**Start → Inspect evidence → edit `FieldElement.__init__` in `field.py` → Run public tests → submit “Normalize the remainder”.** First make `self.value` hold the remainder of `value` divided by `field.modulus`. The public tests include a negative input.

## Before you start

- The divisor `m` is the **modulus**, an integer greater than 1 here. Python `v % m` gives the remainder `r` in `v = m*q+r`, with `0 ≤ r < m`. Example: `−2 = 7*(−1)+5`, so `(-2) % 7 = 5`.
- Choosing that remainder is **normalization**. An **element** here stores a modulus and a remainder. `Field(m)` stores the modulus; `.element(v)` creates an element. `self` means this object, `self.value` its remainder, and `self.field.modulus` its modulus. A function inside a class is a **method**.
- `u ≡ v (mod m)` means that `u` and `v` leave the same remainder when divided by `m`. The symbol `≡` means precisely that. `gcd(a,m)` is their greatest common divisor.
- With a prime modulus `p`, every element except zero has an inverse. This arithmetic is an example of a **finite field**: finitely many elements with arithmetic including division by nonzero elements. The same code will handle composite moduli, where some nonzero elements cannot be divisors.

## Add, subtract or multiply → take the remainder

| Operation | General formula | Modulus 7, a=5, b=4 |
|---|---|---|
| `a + b` | `(a+b) % m` | `9 % 7 = 2` |
| `a - b` | `(a-b) % m` | `1 % 7 = 1` |
| `a * b` | `(a*b) % m` | `20 % 7 = 6` |

These are `__add__`, `__sub__`, `__mul__`. Return a `FieldElement` with the same modulus, not a plain integer. Normalizing on construction also normalizes intermediate results.

**Equality requires both the same modulus and the same remainder.** Modulus 7 with −2 equals modulus 7 with 5, but differs from modulus 6 with 5. `__eq__` performs this comparison. `__hash__` returns an integer used by Python dictionaries and sets: equal elements must have equal hashes. You can use `hash((self.field.modulus, self.value))`. Different elements are allowed to share a hash.

Reordering additions or multiplications, or changing their grouping, preserves the answer. Also `x+0=x`, `x*1=x`, `x-x=0` and `x*(y+z)=x*y+x*z`. With modulus 7, `2*(3+4)` and `2*3+2*4` both leave remainder 0.

## Divide → multiply by the partner that makes 1

For the inverse `x` of `a`, **`a*x ≡ 1 (mod m)`**. With modulus 7, `3*5=15=7*2+1`, so 3 has inverse 5. Thus `4 / 3` means `4*5 % 7 = 6`.

To find that partner, the **extended Euclidean algorithm** computes integers `s,t` and the greatest common divisor `g` such that `a*s + m*t = g`. If `g=1`, `m*t` leaves remainder zero, so **the inverse is `s % m`**. If `g>1`, every integer combination of `a` and `m` is divisible by `g` and cannot equal 1.

```text
3 * (−2) + 7 * 1 = 1  →  inverse of 3 is (−2) % 7 = 5
2 * 1    + 6 * 0 = 2  →  greatest common divisor is 2: no inverse
```

### Build the table without breaking its equation

Each row `(r,s,t)` maintains `a*s + m*t = r`.

1. Start upper = `(a,1,0)`, lower = `(m,0,1)`.
2. While lower `r` is not zero, compute quotient `q = upper_r // lower_r`. `//` is integer division.
3. Record **the current lower row**, as `{"q":q,"r":r,"s":s,"t":t}`.
4. For each column, new = `upper − q*lower`. Move upper to the old lower and lower to new. Repeat.
5. When lower `r` is zero, return upper `(r,s,t)` as `egcd`'s `(g,s,t)`.

Why does the equation survive? Subtracting the two equations gives `a*(upper_s−q*lower_s) + m*(upper_t−q*lower_t) = upper_r−q*lower_r`. Each column undergoes the same subtraction. The `r` column repeatedly takes division remainders; its last nonzero remainder is the greatest common divisor.

| a=3, m=7 | Upper (r,s,t) | Lower (r,s,t): the row to record | q | Next lower |
|---|---|---|---|---|
| 1 | (3,1,0) | (7,0,1) | 0 | (3,1,0) |
| 2 | (7,0,1) | (3,1,0) | 2 | (1,−2,1) |
| 3 | (3,1,0) | (1,−2,1) | 3 | (0,7,−3) |

`egcd(3,7)` returns `(1,-2,1)`. `egcd_trace(3,7)` returns these three rows, in order:
`[{"q":0,"r":7,"s":0,"t":1}, {"q":2,"r":3,"s":1,"t":0}, {"q":3,"r":1,"s":-2,"t":1}]`.
The three numbers of `egcd`, and the ordered rows of the trace, may use a list or tuple. Each row is a dict with `q,r,s,t`; every number is an integer, not a boolean or float. Keep negative `s,t` unchanged. Normalize when returning the inverse as an element.

The submitted tests call `egcd` and `egcd_trace` with `1 ≤ a < m`. Inside `inverse()`, use normalized `.value`. Zero can be rejected before calling the algorithm.

## When there is no inverse, do not return a number

Zero times anything is zero, never one. Under a composite modulus, the greatest common divisor still decides whether an inverse exists.

| Modulus | Nonzero elements with an inverse → partner | Nonzero elements without an inverse | Smallest nonzero element without an inverse |
|---|---|---|---|
| 6 | 1→1, 5→5 | 2, 3, 4 | `non_invertible_element(6) = 2` |
| 9 | 1→1, 2→5, 4→7, 5→2, 7→4, 8→8 | 3, 6 | `non_invertible_element(9) = 3` |
| 7 | 1→1, 2→4, 3→5, 4→2, 5→3, 6→6 | none | `non_invertible_element(7) = 0` |

The function's zero means “no such **nonzero** element”. Search from 2 up to modulus−1 and return the first `a` with `gcd(a,m)>1`; return zero if none exists. One is always its own inverse.

In `inverse()` and `/`, absence of an inverse requires `raise NotInvertible("no inverse")`. Before combining different moduli with `+ - * /`, use `raise FieldMismatch("different moduli")`. Both exception classes are provided; the explanation string is yours.

For prime `p` and nonzero `a`, `a` to the power `p−1` leaves remainder 1 (Fermat's little theorem), so `pow(a,p-2,p)` gives the inverse. There is no such guarantee for a general composite modulus. Modulus 6 with 5 has inverse 5, yet `pow(5,4,6)=1` and `5*1 % 6=5`, which fails. The Euclidean algorithm handles both without first deciding whether the modulus is prime.

## Seven submission rows and where to edit

| Row | Code to edit | What to establish |
|---|---|---|
| normalize | `FieldElement.__init__`, `__eq__`, `__hash__` | Negative inputs normalize too; same modulus/remainder means equality and equal hash |
| arithmetic | `__add__`, `__sub__`, `__mul__` | Correct remainders, including intermediate results |
| egcd-trace | `egcd`, `egcd_trace` | Every table row, greatest common divisor and coefficient |
| inverse | `inverse`, `__truediv__` | Invert every nonzero prime-modulus element; division undoes multiplication |
| errors | Inverse and four arithmetic methods | Reject zero divisors and mixed moduli |
| composite | `non_invertible_element`, `inverse` | Find the smallest nonzero element without an inverse and refuse to invert it |
| units | The same `inverse`, `__truediv__` | Handle every nonzero element under unseen prime and composite moduli |

You may add branches and loops inside `field.py`'s methods and functions. Keep the names and arguments. **All seven rows submit code: no separate number or JSON answer.** Each “Submit (+N pt)” sends the current file. The rows are independently graded, with a 10-point penalty per wrong answer.

“Inspect evidence” shows this deployment's moduli, table, inverse and verification. After calculating a small example above, follow the same steps with the table's `a` and `modulus`. “Run public tests” checks small examples and the displayed prime; it does not exhaust unseen moduli. “Restore starter” discards your edits.

This component also supplies division in slope formulas for elliptic curves, the curves whose points are used in cryptography. You are not implementing the curve's special cases or a complete signature scheme here.

Available computational standard-library modules (tools included with Python): `collections`, `copy`, `dataclasses`, `decimal`, `enum`, `fractions`, `functools`, `hashlib`, `hmac`, `itertools`, `json`, `math`, `operator`, `random`, `re`, `statistics`, `time`, `typing`. You may import them in your code. This environment does not support installing extra packages, file access or network communication. The required integer arithmetic can also use only built-in operations.

## Local runtime and author verification

The participant image contains the editor, public examples and worker, but no hidden
checks, fixtures or reference answer. A second, unpublished verifier derives public
parameters and holds the mathematical checker. Both services use nonroot users,
`init: true`, read-only filesystems and a loopback-only host port.

Source initializes in a fresh worker without the seed or checker. After readiness,
requests carry fresh identifiers. The parent validates integer values, moduli,
operations, equality/hash consistency and expected exceptions. A printed failures list
is not a verdict. Identifiers stay in a private C envelope, outside Python dispatch and JSON callbacks.
Only matching replies are processed, and their values still undergo mathematical checks. The finite tested cases are not a proof about
all possible inputs or implementations.

Exception observation and response construction use a small CPython native adapter
inside the isolated worker. The learner cannot replace these through Python frame
locals or closure cells. This observes the actual type returned by a dispatched
Python call. The C adapter removes the nonce before JSON decoding and attaches it
only after response serialization, preventing Python frame inspection from forging a reply.
Arbitrary native memory access remains outside this boundary.
The compiler is used only in the Docker build stage and is absent from runtime
images. The adapter implements no field solution or private test.

The per-run limits remain 25 seconds, 512 MiB address space, 64 processes and 64 KiB
output frames / accumulated non-result output. Linux restrictions deny file/network,
persistent IPC, filesystem metadata changes and changes to supervisor scheduling.
Worker process groups are removed and init reaps exited descendants. Public source
initialization errors expose only a validated filename/line/type; private failure
messages contain public rule names, never hidden operands or expected answers.

The local Docker owner can inspect containers; these controls do not protect secrets
from that owner. Production deployment and real-world cryptographic safety are not
claimed. The Euclidean table branches on input and is not a constant-time secret-key
implementation. This local exercise creates no AWS resources; it uses local Docker
CPU, memory and disk. `make verifier-down` removes the local Compose environment.

```sh
make test                         # public suite against your edited local starter
make test-one ID=small-seven       # matching public examples
make inspect                      # public evidence; optional A=3 P=7
make reference-test               # author reference + 14 existing mutants
make runtime-test                 # author Linux boundary regressions
make verifier-down
```

Run `make install && make agent-gate` at the catalog root. The retained real Portal
component harness is `local/tests/hidden/portal/run.sh`; its URL is configurable with
`AC26_WORKBENCH_URL`. Reader provenance, actual commands and observed results are in
`local/tests/hidden/READER.md`. Browser-on-AWS checks are not part of this local evidence.
