# (0, 0) is not the point at infinity

> Independent, unofficial companion to Advanced Cryptography Program 2026. Not affiliated with or endorsed by its course operators.

## Before you start — repair the point arithmetic used by signatures

You maintain the arithmetic behind a signing program. The unfinished `curve.py` currently returns the original point when asked to add points. Open **Deploy → problem editor → Inspect evidence** to see your curve. Start by deciding whether a pair of coordinates belongs to it. Use **Run public tests**, then a checkpoint's submit button.

Here an **elliptic curve** is the set of pairs (x,y) satisfying `y² = x³ + a*x + b` when both sides are reduced to their remainders after division by a prime p. The settings are p,a,b. The supplied p is greater than 3 and `(4*a**3+27*b**2)%p != 0`; this condition lets us define the point addition below.

Adding a fixed point G to itself k times gives Q=kG. This is a building block for later signatures. **Small classroom curves allow you to recover k by trying possibilities.** For suitably chosen large curves, reversing the calculation is believed difficult. This exercise builds the arithmetic, not a signature or a zero-knowledge proof.

## Names and rules

| Name | Meaning |
|---|---|
| modulus p, mod p, `%p` | Take the remainder after division by p. Normalize negative results into 0 through p−1 |
| inverse of a number | A number that multiplies with it to remainder 1. Under 7, the inverse of 6 is 6: 6×6=35+1 |
| O, point at infinity, identity | A separate point that changes nothing when added: P+O=P. Both coordinates are None |
| −P, inverse of a point | The point adding with P to give O: (x,(-y)%p). −O=O |
| group | A set whose operation stays inside the set, with an identity, inverses and unchanged results when parentheses move |
| order | For a point: the smallest positive number of additions returning to O. For the group: the number of points, including O |
| bit | One binary digit, 0 or 1. Repeated division by 2 gives the digits from the bottom through its remainders |
| checkpoint | One independently scored part. There are eight |

Point addition here also permits swapping the order of points. Do not add points belonging to different curve settings. Separate Curve instances with the same (p,a,b) describe the same curve. Point equality depends on these settings and the coordinates. Equal points must have equal **hashes**, the integers Python uses when storing values in dictionaries and sets.

**How to divide:** reduce denominator d to its remainder, then find u such that `(d*u)%p=1`. Divide numerator v with `(v*u)%p`. Python's built-in `pow(d,-1,p)` computes u without trying every candidate. Handle the zero-denominator cases below before calling it. The earlier `field-inverse` exercise teaches how to implement that inverse algorithm itself.

## O is different from (0,0)

On `y²=x³+x` with divisor 7, (0,0) satisfies the equation and is an ordinary point. It cannot represent O.

```text
P=(1,3) → 2P=(0,0) → 4P=O
ordinary   ordinary   (None,None)
```

## Four cases of point addition

This operation is defined by these rules; it is not coordinate-wise addition. You do not need to derive the formulas.

1. O+P=P and P+O=P.
2. If x₁=x₂ and `(y₁+y₂)%p=0`, return O. This includes doubling a point whose y is zero.
3. For the same point, use `λ = (3*x₁²+a) / (2*y₁)`.
4. For two different points, use `λ = (y₂−y₁) / (x₂−x₁)`.

Division means multiplication by the inverse above. Then calculate `x₃=λ²−x₁−x₂` and `y₃=λ*(x₁−x₃)−y₁`, reducing each to its remainder.

Try P=(1,3) on `y²=x³+x` under 7. For doubling, the numerator is 4 and the denominator is 6. Its inverse is 6, so λ is the remainder of 4×6, which is 3. The new x is the remainder of 3²−1−1=7, which is 0. The new y is 3×(1−0)−3=0. Thus **2P=(0,0)**. Double once more: y=0, so **4P=O**.

## Inspect and implement

Inspect displays your curve's p,a,b, the point count including O, points whose y is zero, sample coordinates and the shape of a scalar trace. Its health token is not an answer to submit. First substitute x=0,y=0 into your own equation on paper and decide whether that coordinate pair belongs to the curve.

Edit only `curve.py`, retaining these interfaces:

- `Curve(p,a,b)` and its `params`. `contains(point)` returns a boolean for the equation; O is accepted. `point(x,y)` normalizes coordinates and raises `NotOnCurve` when they do not satisfy it. `infinity()` returns O.
- `Point.is_infinity` is true only for two None coordinates. Returned ordinary coordinates are integers from 0 through p−1. `__eq__` and `__hash__` use curve settings and coordinates.
- `__neg__` produces −P. `__add__` uses the four cases and raises `CurveMismatch` when the settings differ. Do not change the input point while computing its double.
- `scalar_mul(k)`, `k*P` and `P*k` mean the same thing. Zero gives O; a negative k means multiplying −P by |k|. Use **double-and-add**: repeatedly divide k by 2; add the current addend when the remainder is 1, and double the addend every step. One addition per unit of k cannot finish the 256-bit case. secp256k1 is the name of that large curve, whose settings are supplied to your code.
- `double_and_add_trace(point,scalar)` records nonnegative integer scalars. Zero returns an empty list. Negative scalars are required for scalar multiplication, not for this trace. Each positive scalar produces one row per binary digit, starting at the lowest digit.

Each trace row contains `index`, `bit`, `accumulator_before`, `addend_before`, `added`, `accumulator_after`, `addend_after`, `on_curve`. Indices start at zero. Indices and bits are integers; `added` and `on_curve` are booleans. Render a point as `"O"` or `"(x, y)"`. The accumulator is the sum so far; the addend is the point available to add at this step. After step i, they represent the low i+1 binary digits times P and `2^(i+1)*P` respectively. For k=5, the bottom-first bits are 1,0,1: the accumulator ends each row at 1P,1P,5P and the addend at 2P,4P,8P.

| Checkpoint | Methods | Observable rule |
|---|---|---|
| on-curve (30) | contains / point | Accept points satisfying the equation; reject others with NotOnCurve |
| identity (30) | infinity / is_infinity / __neg__ | P+O=P and P+(−P)=O; (0,0) is not O |
| add (45) | __add__ | Add two different points |
| double (45) | __add__ | Double a point; y=0 gives O |
| scalar (45) | scalar_mul / __mul__ / __rmul__ | Combine doubling and addition, including zero and negative counts |
| trace (35) | double_and_add_trace | Record each before/after row; zero has no rows |
| properties (40) | Combined operations | Moving parentheses or order, and equivalent separate Curve instances, preserve results |
| secp256k1 (30) | The same implementation | Finish calculations with large integer parameters |

Each **Submit (+N pt)** button sends the current file to its own checkpoint. There is no numeric answer box. Wrong submissions cost 15 points. **Run public tests** covers small examples of membership, O, addition, doubling, scalars, trace rows, curve comparisons and the displayed points. Passing them does not prove every unseen or 256-bit case. **Reset** restores the unfinished starter.

This arithmetic supports the later Schnorr signature exercises. The teaching trace branches on secret bits; those branches can themselves leak information in real implementations. It is a learning model, not production secret-key code.

## Author runtime and verification

The participant image contains the editor, starter, small public checks, and a bounded
value adapter. The unpublished verifier holds fixture derivation and the independent
point checker. Both Compose services run as nonroot with init, read-only filesystems,
limited memory/processes and dropped capabilities; only the Workbench has a
loopback host port. No private checker, fixture generator or reference solution is
copied into the participant image.

Submitted source runs in a fresh worker without the seed or checker. The parent
validates curve settings, canonical coordinates, types and operation results. It
owns the verdict. The native CPython adapter observes returned exceptions and builds
responses outside Python frames; it contains no curve-addition solution. Its compiler
exists only in the Docker builder stage. A submission implementing the live value
protocol must still satisfy the mathematical checks; native-return provenance against
arbitrary protocol implementations is not attested.

The existing computation allowance is 30 seconds, separate from the 15-second HTTP
body deadline. Verifier forwarding waits 35 seconds. The worker caps address space
at 512 MiB, processes at 64, and output frames/accumulated non-result output at
64 KiB. Linux restrictions block new file/network access, persistent IPC and changes
to supervisor state. Worker process groups are killed after use. The local Docker
owner can inspect images; these controls do not protect against that owner.

```sh
make test                    # edited starter, small public examples
make test-one ID=trace        # matching public example
make inspect K=5             # deployment evidence and trace shape
make reference-test          # author reference and ten mutations
make runtime-test            # author Linux boundary regressions
make verifier-down           # remove this local Compose environment
```

At catalog root run `make install` and `make agent-gate`. Source-reading provenance
and observed validation are recorded in `local/tests/hidden/READER.md`; intermediate
passing checks are not a claim that the final Portal route has been verified.

This problem creates no AWS resources locally. Docker CPU, memory, disk and running
containers consume local resources until stopped. Platform-hosted costs belong to
the chosen TenkaCloud deployment and event duration; no price is estimated here.
Use the platform's stop/teardown action for that deployment. No AWS rehearsal or
production cryptographic safety is claimed by this local verification.


## Runtime

These Python standard-library modules are available: `collections, copy, dataclasses, decimal, enum, fractions, functools, hashlib, hmac, itertools, json, math, operator, random, re, statistics, time, typing`. No additional package installation is needed. Access to grading files or other processes, external networking, and creating new processes is unavailable. Imports outside this list may not be available.
