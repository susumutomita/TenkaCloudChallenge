# A set of things that must be zero

> This is an independent, unofficial companion to Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. The problem,
> code, fixtures, and examples were written independently. Questions go to TenkaCloud.

**Track:** `advanced-cryptography-2026` · **Order:** 110 · **Chapter:** Week 1 / Arithmetic
Circuits · **Role:** `mechanism` · **Time:** 60–90 minutes · **Points:** 200
· **Recommended first:** `ac26-bridge-experiment`, `ac26-bridge-properties`

## Participant route

An entry-condition checker only says “rejected.” Make it show each condition's result
and identify the first violation. Select **Start → Inspect evidence** in the Portal.
The editor shows the divisor `p`, the ordered `circuit`, and two value assignments:
`honestWitness` and `brokenWitness`. Substitute the broken values from the first row.
The first nonzero result is the clue for `first-broken`; you can start on paper.

A **constraint** requires an expression to equal zero; a **circuit** is a list of
constraints. Its variables are **signals**. A **witness** assigns their values, and a
**residual** is the expression's result. All calculations use remainders after division
by a prime `p`, from 0 through `p−1`: Python's `value % p` normalizes the result.
For `x=2,y=3,z=5`, the sum condition `x+y−z` is zero. If the separately proposed `z`
is 6, it is −1, whose remainder for `p=7` is 6, so the condition fails.

| kind | Expression before normalization |
|---|---|
| `mul` | left × right − out |
| `add` | left + right − out |
| `const` | signal − value |
| `boolean` | b × (b − 1) |
| `member` | product of (signal − a), one factor per allowed value a |

Prime `p` matters: a zero product of remainders has a zero factor. Thus the Boolean
expression permits only zero and one; the membership expression permits any listed
value. The analogous claim fails for a composite divisor: 2×3 has remainder zero modulo 6.
This task directly substitutes visible values. It teaches a representation used in
cryptographic proofs; it does not implement a private or succinct proof itself.

Edit `field.py`, `circuit.py`, and `gadgets.py` in the Portal, then select **Run public
tests**. Submit the four code questions from their rows; the editor supplies all three
files. For `first-broken`, enter JSON with keys `constraintId` and `residual`, for example
`{"constraintId":"row_id","residual":6}`, using your displayed instance. Note that a
trace row uses `id`, while the answer uses `constraintId`. All five correct completes
the exercise. No host terminal is required.

For the final range question, use zero/one digits: with three digits, prime `p=11`, and
value 5, the digits 1,0,1 combine as `(1×2+0)×2+1=5`. Constrain each digit with Boolean;
use additions for doubling and the next digit, ending on the original signal. Build the
matching witness with `(value // 2**i) % 2` and all intermediate values. One digit needs
only a Boolean constraint. Generally this uses `3×bits−2` constraints, within `5×bits`.
The statement supplies these formulas before the implementation task. The closing
question asks how an invalid value could pass if a digit's Boolean constraint disappeared.

## Scoring

| Checkpoint | Points | Evidence |
|---|---:|---|
| `residuals` | 45 | Normalization, each residual, trace order, missing-signal errors on unseen prime fields |
| `first-broken` | 40 | The first violated public row and its nonzero normalized residual |
| `boolean` | 35 | Submitted constraint admits exactly zero and one |
| `membership` | 30 | Submitted constraints admit exactly the listed values |
| `range` | 50 | Every in-range value has a valid witness; no auxiliary assignment admits an out-of-range value |

Wrong answers cost 10 points. Every checkpoint has three hints: mechanism, small worked
example, then actions using actual screen/file names. All 15 hints cost 60 points total.

Gadgets are evaluated by the trusted checker's evaluator, which knows the five documented
kinds. A custom kind in the submitted evaluator cannot extend it. Range permits only
`boolean`, `add`, `mul`, and `const`, at most `5×bits` constraints. Widths cover 1–6 bits,
with `2**bits < p`. Its existing exact search, including the fallback that fixes each
out-of-range value, retains its 200,000-assignment budget per width. Unconstrained padding
and an extra value hidden behind a Boolean selector are rejected; valid doubling and
constant-weight constructions remain accepted. One public example passing does not prove
that every invalid assignment is excluded.

## Runtime and safety boundary

Compose runs two non-root, read-only services. Workbench publishes only on
`127.0.0.1:18093`; the verifier has no published port and communicates over the internal
network. Only the verifier receives `FLAG_SEED`. The participant image has the starter,
public tests, and adapter, with no fixture generator, hidden checker, or reference solution.

Public tests and private grading execute learner functions in a separate Linux process.
The trusted parent inspects returned JSON values; learner stdout is never a grade. The
private checker keeps its bounded subprocess and exact search. Before learner code runs,
the worker receives only source and function inputs, uses a seed-free environment, and
installs process restrictions that deny opening files, network access, program execution,
and signals/resource changes targeting the supervisor. This covers `/proc/1/environ`
as well as other process environments. Missing Linux isolation fails closed. Preloaded
standard-library modules support this exercise; imports needing another file are denied.

The value channel has a 15-second deadline, bounded frames/logs, and CPU/memory/process
limits. The private grader retains its 20-second limit. Process groups are removed on
completion or timeout, including nested children. Property-level failed-code messages
are capped at 1,900 characters; manual-answer failures carry no explanation. These
controls were exercised with synthetic probes, not asserted as a guarantee against every
host or kernel attack. The Docker administrator can inspect the verifier; local execution
does not keep secrets from someone who controls Docker. A hosted competition must keep
that authority outside the participant's control.

## Local verification and teardown

Author commands, from this problem directory:

```bash
make inspect                   # public evidence from the running verifier
make test                      # public tests against your edited starter files
make test-one ID=trace          # narrow the public suite
make reference-test            # author-only mutation and Linux boundary suites
python3 local/probes/range_exactness.py  # pure exact-search cross-check
make verifier-down             # stop this problem's Compose services and networks
```

The shipped starter intentionally fails until repaired. `make reset` restores all three
tracked starter files and discards your edits. `make reference-test` builds the author
image, which contains reference and hidden material; it is not a participant image. Its
mutation suite covers broken implementations and a valid-range control, followed by actual
Linux isolation checks. `range_exactness.py` compares 400 small random gadgets with brute
force and checks three legitimate constructions. The repository-root `make install` and
`make agent-gate` validate metadata/catalog contracts separately.

The author-only [reader record](local/tests/hidden/READER.md) documents the first reading,
unchanged reader code, actual HTTP/Portal route, and negative boundary tests. No AWS event
or independent human playtest is claimed. The official Week 1 exploit exercise is the next
application: recognizing which expression enforces a condition, and which condition is
missing. No course fixtures or solutions were copied.

## Resources and cost

This local problem creates no AWS resources and has no AWS Region dependency. The two
containers consume local CPU, memory, temporary disk, and image/build-cache space for the
expected 60–90 minute session. Services remain running until `make verifier-down` (or
platform teardown). Docker images and build cache remain afterwards and can be removed
separately by their owner; no fixed monetary cost is claimed.

## Filesystem metadata boundary follow-up

The learner's Linux filter also denies file/directory creation, links, renames, removal and metadata writes. Blocking file opens alone did not stop those operations from persisting after a worker exited. The problem-local regression applies the actual filter in 16 disposable children, checks 19 operations return EPERM, and verifies unchanged parent-owned fixture contents, directory entries, permissions, ownership, timestamps and extended attributes. Its temporary fixture is removed afterward. This adds no API, scoring, mathematical rule or execution deadline; existing positive sources and suites remain the acceptance baseline. See `local/tests/hidden/READER.md` for before/after scope and commands.

## Computational tools and execution time

Available computational standard libraries (tools included with Python): `collections`, `decimal`, `fractions`, `functools`, `hashlib`, `hmac`, `itertools`, `json`, `math`, `operator`, `random`, `statistics`, `time`, `typing`. Import them in your submitted files. Installing packages, file access and network access are unavailable. Submitted code has a 15-second execution deadline.


### Hint reader check (Issue #716)

An independent reader used only the participant statement, hints and starter. The Japanese member procedure could be read as multiplying the allowed values themselves. It now explicitly multiplies each difference (x−a), matching the formula table and the English statement. With p=7, allowed=[2,5] and x=2, this product is zero. The reader did not inspect hidden tests or reference implementations and did not submit to a running verifier.
