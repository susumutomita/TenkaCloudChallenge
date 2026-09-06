# Multiplication is the one that has to talk

> This is an independent, unofficial companion to Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course. Statements, examples and code
> are independently written; questions belong in TenkaCloud, not with course operators.

**Week 2 · Beaver triples · 40–60 minutes · 200 points · draft**
Prerequisite: `ac26-w2-linear-shares`.

## Start in Participant Portal

Start the problem, open `beaver.py` in the editor, and implement `mask` first.
**Inspect evidence** shows this deployment's modulus and share layout. **Run public
tests** reports each function's result; unfinished functions may still fail while
`mask` passes. Submit the `mask` checkpoint, then complete the other functions and
submit the remaining checkpoints. Every checkpoint uses the current source in the
same editor. There are no manual JSON answers and no required terminal commands.

The statement and starter define party, share, modulus, opening, preprocessing and
round. They provide the formulas and a complete one-digit worked table. Each of the
five checkpoints has three hints: mechanism → example/formula → editor procedure.
Wrong answers cost 10 points; the existing hint penalties are unchanged. Opening all
15 hints leaves 102 of 200 points.

| ID | Points | Output and completion |
| --- | ---: | --- |
| `mask` | 40 | n integers in `0..p−1`, reconstructing to the masked difference |
| `open` | 30 | One integer in `0..p−1`, reconstructing the shares |
| `combine` | 65 | n integers whose sum modulo p is the product |
| `protocol` | 30 | The functions compose, and `rounds()` reports the minimum count, 1 |
| `transfer` | 35 | The same functions work with other moduli, party counts and triples |

## Arithmetic and its limits

A share is a piece of a number; all pieces sum to the number modulo the prime p.
Prepare shares of a, b and `c=a*b % p`. Open the two differences `d=x-a` and `e=y-b`
modulo p, then expand:

```text
x*y = (a+d)*(b+e) = c + d*b + e*a + d*e   (modulo p)
out_i = (c_i + d*b_i + e*a_i) % p
```

The public constant d*e contributes once to the **total**, for example by adding it
to party 0 only. Other distributions with the same total are accepted. In the
statement's p=7 example, d=3/e=4 give `[0,5,5]` before the constant and `[5,5,5]`
after it; the total remainder 1 matches `5*3`. Adding to every row instead gives
`[5,3,3]`, total remainder 4. Returning a tuple in place of a list, a bool, or a
noncanonical integer violates the declared return type or range.

The `open` range is a representation contract. An unreduced total can still produce
the same modular product downstream; it is not inherently an incorrect residue.
The two openings do not depend on each other, so their messages can be batched into
one round. `rounds()` asks for this minimum, not an arbitrary slower protocol.

This program is a central arithmetic model. Inspect displays full lists, so their
underlying values can be reconstructed. Real MPC gives each party its own share.
For a hidden difference to preserve privacy, the mask must be independent and
uniform, unavailable for the observer to reconstruct, and used once. For any fixed
d, every candidate x has exactly one `a=(x-d)%p`, with equal probability under these
conditions. Merely being unknown is insufficient. Correct arithmetic does not
establish secure preprocessing, authenticated communication or protection against
malicious parties. The exercise's nondegenerate test fixtures are chosen to expose
arithmetic errors, not to model the full distribution of real masks.

Explain what cancels in `d1-d2` if the same a is reused. Then distinguish the number
of independent multiplications, the number of triples consumed, and the number of
batched communication layers before continuing to `ac26-w2-private-aggregate`.

## Alignment

`courseAlignment` pins the published Week 2 lecture README and toy-mpc assignment
at `a3aa4b56fa88fbe803b57d320fbc87c1a203b480`, with kinds `lecture` and `assignment`.
Part A covers additive sharing and Beaver multiplication; this independent problem
splits that multiplication into four functions. It does not implement Part B's OT
or Boolean MPC. The author evidence in `local/tests/hidden/READER.md` also records
reading the owner's Week 2 notes and the exact revisions used.

## Runtime boundary and author checks

The Workbench image contains public materials, while the unpublished verifier image
contains fixtures and the private checker. Both servers run as a non-root user,
with Tini as PID 1. The trusted Workbench keeps the existing deployment seed and
`tcw1` preparation contract. Each learner process receives an explicit clean
environment and only source plus function arguments, with unrelated file descriptors
closed. Before learner code runs, Linux seccomp denies file opens, network access,
execution, process signalling and persistent System V IPC. Resource limits, a wall
clock deadline and process-group cleanup bound execution; Tini reaps descendants.

Public and private checkers run in the trusted parent and judge returned values.
Learner stdout and exit status are not grading verdicts. Fresh per-call IDs reject
stale/preprinted replies; they **do not attest that a Python function executed**.
The parent remains responsible for the arithmetic. Feedback excludes hidden inputs
and arbitrary learner logs; public initialization errors show only the submitted
filename, line and exception type.

These are tested process restrictions, not a guarantee against someone controlling
Docker or the host. This is a self-study arithmetic exercise, not certification of
real-world MPC security. No cloud account or AWS resources are used.

`make reference-test` runs eight mutation cases and the Linux execution-boundary
suite in the author image. The repository's `make install && make agent-gate`
validates catalog metadata separately. Reproducible real Portal component/API
acceptance and the original reader's writeup-exposure limitation are recorded in
`local/tests/hidden/READER.md`.
