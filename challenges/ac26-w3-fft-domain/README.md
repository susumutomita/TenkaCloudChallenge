# Does that domain actually divide?

## Repeated points cannot recover the original formula

You maintain input validation for a table used in proof computations. Repeated input points lose information. Fix the test in `fftdomain.py` so computation proceeds only on usable point sequences.

**First action:** Deploy → Inspect in the problem editor. Compare the point sequences and edit `_domain_ok` in `fftdomain.py`. Run public tests is a preview; Submit grades the current editor code. The starter already passes public tests, so green tests alone do not establish complete validation.

## Before you start — build four different points

Keep remainders after division by a prime `p` (called `mod p`, written `% p` in Python). For example, `7 % 5 = 2`. Every entry below uses division by 5. `omega` (ω) is the repeated multiplier and `n` is the required point count.

| Multiplications | 0 | 1 | 2 | 3 | 4 |
|---|---:|---:|---:|---:|---:|
| omega=2 | 1 | 2 | 4 | 3 | 1 |
| omega=4 | 1 | 4 | 1 | 4 | 1 |

The **order** is the number of multiplications until the first return to 1. The orders are 4 and 2 respectively. For four points the first sequence works, while the second repeats points. Both return to 1 after four steps, so that single test is insufficient.

An **evaluation point** is a number substituted into a formula. The ordered collection is an **evaluation domain**: `[1,omega,omega²,…,omega to the power n−1]`. The dots mean continuing the same rule.

For prime p, an omega of order n exists exactly when n divides p−1. That does not make every supplied omega valid. Start at 1, multiply by omega with a remainder each step, and check that the first return is at step n. Reject an earlier return, no return within n steps, or omega with remainder zero. For n=1 only remainder-one omega works.

## Coefficients ↔ values at points

A **polynomial** adds constants times powers of x, such as `f(x)=1+2x+3x²+4x³`. Its **coefficients** are `[1,2,3,4]`, constant first. Its **degree** is the largest exponent, 3; n coefficients describe degree less than n.

```text
coefficients [1,2,3,4] ── substitute each point ─→ values [0,4,3,2]
                      ←── inverse transform ───
                              points [1,2,4,3], p=5
```

For example f(2)=1+4+12+32=49, remainder 4 after division by 5. This is the second value.

In general, `f(x)=a0+a1×x+…+a(n−1)×x^(n−1)`. Position i starts at zero; `values[i]` is the remainder of `f(omega^i)`. Never sort the values.

An **inverse** is a multiplier whose product has remainder 1, computed with `pow(t,-1,p)`. Let u be the inverse of omega and v the inverse of n. The recovered coefficient at position j is:

```text
a[j] = v × (values[0] + values[1]×u^j + values[2]×u^(2j) + …)
       followed by the remainder after division by p
```

The parentheses evaluate the value list as coefficients at the point u^j. For p=5,n=2,omega=4, coefficients [1,2] become values [3,4]. With u=4,v=3, the inverse gives remainders of (3+4)×3 and (3+4×4)×3: [1,2].

**Interpolation** recovers the formula from values at points. Use ifft to recover coefficients, then `_evaluate` at point. The same procedure works at original points and other points.

**FFT (Fast Fourier Transform)** computes this transform efficiently. Here the function is named fft, but substituting each point directly is sufficient. The task tests validation and correct round trips, not speed. For more depth, split even- and odd-position coefficients into `f(x)=E(x²)+x×O(x²)`: x and −x reuse the same partial calculations. This changes the work count, not the answer.

## Functions and responses

Edit only `fftdomain.py`. Input parsing, `_evaluate` and four function skeletons are provided. In response dictionaries, `ok` says whether processing succeeded and `valid` says whether the point sequence is usable.

| Function | Successful response |
|---|---|
| validate_domain(prime,order,omega) | {"ok": True, "valid": True or False} |
| fft(coefficients,omega,prime) | {"ok": True, "values": value list} |
| ifft(values,omega,prime) | {"ok": True, "coefficients": coefficient list} |
| interpolate_and_evaluate(values,omega,point,prime) | {"ok": True, "value": value at point} |

Return malformed inputs as `{"ok": False, "error": name}`. True and False do not count as integer inputs.

| Name | Condition |
|---|---|
| invalid_prime | prime is not a prime integer from 3 through 1,000,003 |
| invalid_order | order is not an integer from 1 through 4096 |
| invalid_omega | validate_domain receives non-integer omega |
| invalid_coefficients / invalid_values | respective input is not a list of length 1–4096 containing integers from 0 through prime−1 |
| invalid_point | point is not an integer from 0 through prime−1 |
| invalid_domain | fft/ifft/interpolation cannot obtain the required distinct points from omega |

The well-formed `validate_domain(5,3,2)` reports valid: False, not an input error. Reduce integer omega by prime before using it.

## Five graded checkpoints

| Checkpoint | Purpose | Points |
|---|---|---:|
| domain | Reject repeated points and do not compute on invalid domains | 40 |
| roundtrip | Recover original coefficients after transforming | 40 |
| ordering | Preserve point/value correspondence | 30 |
| interpolate | Use the same formula at other points | 45 |
| generalize | Apply the rules to other primes, lengths and input forms | 45 |

Each Submit sends the current editor code. Later checkpoints also check earlier properties. Fix the reported property and resubmit after failure; wrong-answer penalties are shown for each checkpoint. All five passing completes the task.

Inspect shows the prime family, available sizes and real/repeating examples. Follow those larger numbers with the same remainder steps as the small table above. Reset starter restores the original code.

This is a check on a computational foundation used by proofs, not a proof by itself. Week 4 builds on such point sequences to turn computation tables into polynomial formulas.


---

## Layout

```
local/starter/fftdomain.py    the one file a participant edits
local/reference/fftdomain.py  the answer (author image only)
local/tests/public/           tests the broken starter passes
local/tests/hidden/           the properties that actually decide the checkpoints
local/mutation.py             breaks the reference eight ways and requires each to be caught
local/fixtures/generate.py    orientation: field family, one real and one fake domain
local/participant/server.py   the Workbench: Portal editor API, and /verify forwarded inward
local/verifier/server.py      /verify and GET /public, in a second, unpublished container
local/show.py                 `make inspect` — participant-visible orientation only
```

## How the hidden properties decide

The checker owns its copy of the order test, written from the definition rather than
imported from the reference. Every parameter set mixes primes where the textbook
``3 ** ((p-1)/n)`` rule is right with primes where it lands in a smaller subgroup, at
least half the second kind, so trusting ``omega ** n == 1`` fails by necessity. The
ordering phase transforms ``f(x) = x`` and unit coefficients, so any bit-reversal or
recursion-order leak is directly visible; the interpolation phase checks members
against their listed values and non-members against the checker's own inverse.

## Author commands

```bash
make build           # participant image
make test            # public tests against local/starter
make inspect         # print the participant-visible orientation
make reference-test  # reference passes its hidden suite, all eight mutations die
make verifier-up     # start the verifier container the two above read from
make verifier-down   # stop it
```

## Assurance scope

Local mode is self-paced, honor-system verification. Someone who owns the Docker daemon and every
container in the compose stack cannot be prevented from inspecting hidden material. The boundary
here is misdelivery, not confidentiality against that person: the Workbench container you build
and run carries the starter, the public tests and the orientation printer only — no fixtures, no
hidden tests, no reference solution, no verifier. Those live only in a second, unpublished
container the Workbench reaches over the compose network, and in the author-only image
`make reference-test` builds.

Because of that, `make test`, `make test-one` and `make inspect` bring the verifier up first
(`make verifier-up`, run for you): `make inspect` reads this deployment's field family and its two
example domains from it over the compose network instead of computing them locally.
`make verifier-down` stops it.

Submissions run with time, memory, process, and output caps; both containers run non-root,
read-only, without privileges, and only the Workbench is published, on loopback.

It does **not** support competition ranking, examination, or completion certification. Those uses
need a verifier the participant does not administer, tracked in
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## What you proved

You did not make the FFT fast. You decided whether a handed domain is real — order
exactly n, over a prime where n divides p-1 — and made the transform, its inverse, and
interpolation hold only over real ones. That is a precise, useful guarantee—and no
larger than the evidence supports.


## Runtime

These Python standard-library modules are available: `collections, copy, dataclasses, decimal, enum, fractions, functools, hashlib, hmac, itertools, json, math, operator, random, re, statistics, time, typing`. No additional package installation is needed. Access to grading files or other processes, external networking, and creating new processes is unavailable. Imports outside this list may not be available.


## Author runtime verification and resources

Run `make runtime-test` for positive/negative process-boundary regressions and
`make reference-test` for mutations through the actual evaluator. The public and
private checker processes own verdicts; submitted code only supplies function
results through a bounded native envelope. Limits are 25 seconds of computation,
512 MiB child address space, 64 processes, and 64 KiB output. HTTP body reads have
15 seconds, while forwarding allows 30 seconds for the bounded computation.
See local/tests/hidden/READER.md for the exercised route and limitations.

Local Docker consumes host CPU, memory and image storage. A platform deployment
also consumes the host's AWS compute/storage and any configured logging resources;
no standalone AWS deployment or pricing claim was tested here. Use the event's
Region and teardown workflow. `make verifier-down` stops both local services;
images remain until explicitly removed. Never leave an event host running merely
because local containers were stopped.
