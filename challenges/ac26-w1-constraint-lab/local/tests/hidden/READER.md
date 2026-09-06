# Issue #716 — participant reading and runtime evidence

Author-only record. This file is excluded from the participant image. Evidence was collected
on 2026-09-07 JST in an isolated clone at base
`b64dfa9fe09f06ffc544c858715419ef9e8191f7`, for this problem only. No shared runtime,
platform contract, other problem, AWS resource, or real credential was changed.

## Sources read before implementing the revision

Both sources were inspected directly; the official material supplies the mechanism and the
author's notes supply the beginner-facing explanation. No course solution/fixture was copied.

- `advanced-cryptography-2026` at `bdbc913fa7fd4ed87ce7f0de6b1d73fb41e49732`,
  `week1/problems/proof-of-exploit/README.md`, lines 14–23 (constraints and witnesses),
  58–66 (missing-constraint attack), 74–103 (circuit construction).
- `advanced-cryptography-note` at `58344a29ea39c25839475ba9a594c115ed89989b`,
  `week1/index.html`, lines 863–875 and 913–915: constrain the inputs and distinguish a
  missing condition from an extra condition.
- Current `AGENTS.md` §12b/c/d: first useful action, given formulas and small examples,
  mechanism → example → actual screen/file procedure, and a transfer task at the end.

## First reading before hidden/reference access

The root reviewer read Japanese/English instructions, hints linked by checkpoint ID,
all three public starters, and actual Inspect output. The reviewer had not read this
problem's hidden checker or reference solution. This is an agent participant-role read,
not an independent human playtest. Record: `/private/tmp/constraint-lab-716-reader/first-reading.md`.

The first pass caught nine concrete gaps:

1. Direct substitution was described as private/succinct proof. It is a representation
   step; this task exposes the values and evaluates every expression.
2. `(5+x)+(3+x)-(8+2x)` is always zero and has no separately proposed output to reject.
   Replace it with `x+y−z` and compare a good and bad proposed `z`.
3. The product-zero argument needs prime `p`; `2*3` modulo composite 6 is a counterexample.
4. A three-bit range 0..7 conflicts with a divisor 7 and the promised `2**bits < p`.
   The revised three-bit example explicitly uses `p=11`.
5. Normalization must handle large positives, not just negative values.
6. The starter's constant-zero Boolean gadget admits only zero; it does not admit every value.
7. Field notation and the normalized range were undefined in the starter.
8. First-broken had no hints; other hints began at checking, while the needed range
   construction was buried in a final hint.
9. The useful action appeared only after long specialized framing.

The revision puts Start → Inspect evidence → first nonzero row first; gives the five
expressions and range construction in the statement; defines each term before use;
adds three hints to all five checkpoints; and preserves code transfer across widths,
signal names and fields. The closing question asks how an omitted Boolean constraint
could permit an out-of-range value. Hint total is 60, base score 200, wrong attempt 10.

A second reader inspected only the revised public packet and independently calculated:
with public `p=97`, the honest trace is all zero; broken row `c3` is
`34+37−88=-17`, normalized to 80. The answer is
`{"constraintId":"c3","residual":80}`. This reader caught one stale intermediate example
in `gadgets.py`: the top-down doubling explanation still said `b1+b1 → t1=0`.
For digits 1,0,1, it must say `b2+b2 → t1=2`. That example was corrected before testing.

## Unchanged participant-only code

The root reviewer wrote these files from the public statement/Inspect alone, before
hidden/reference reading, in `/private/tmp/constraint-lab-716-reader/source/`:

| File | SHA-256 |
|---|---|
| `field.py` | `c1adbdd7e74bcfc09d18f797a799b6ff51e70d4f444e32dc71e034f7824a54c2` |
| `circuit.py` | `902a7e7a40bdc46beaa9d2a8a9c63fec17c1b37ff2a4dae32844a6c0cc88a10a` |
| `gadgets.py` | `f4f69076e6185e47ce0c6c1bef65a96d99758fbabd3333c099ae840da8412e07` |

All three files were submitted unchanged. The explicit synthetic seed for the dedicated
session was `constraint-reader-716`. It is test data, not an environment credential.
Public formulas, source assertions and this hand calculation supplied the acceptance
answers; hidden/reference code was used separately only for author boundary/mutation tests.

## Reproduced boundary failures and repair

Before repair, actual `/verify` accepted a source that printed `{"failures":[]}` and
exited for each of the four code checkpoints. `/api/test` also reported that submitted
code could see `FLAG_SEED` in its environment and a process environment. Probes recorded
only booleans, not the value. Log: `/private/tmp/constraint-716-baseline-boundary.log`.

The prior runner put hidden checks and learner imports in the same interpreter. The
replacement keeps the existing trusted, bounded checker process but moves learner
functions to a separate value worker. The checker never imports submitted modules.
Each returned value remains untrusted and is checked by the existing evaluator. Worker
stdout cannot become the parent's failures list. The public runner uses the same value
boundary and published assertions. The participant image/Compose environment has no seed.

Linux filters deny file opening (including `/proc` and private source paths), network,
program execution, and signals/resource-limit changes to the supervisor. The value
channel is bounded, uses nonblocking input/output, and shares one deadline. Nested
children remain in the launcher-owned process group and are terminated on completion
or timeout. This is a problem-local boundary, not a claim of secrecy from Docker admins
or immunity to every host/kernel attack. The existing exact range search and its
200,000-assignment budget were preserved without loosening tests.

## Actual route and regression results

Dedicated Compose project `ac26-constraint-reader-716` exposed only `127.0.0.1:18146`.
Only that project was rebuilt for verification. The verifier stayed unpublished.

- Actual HTTP: **34 checks passed**. Unchanged reader public tests, four prepared code
  bundles, all four code verdicts, and the manual c3/80 answer passed. Wrong manual
  shapes/value types failed without hints; forged grade output and private imports failed
  on all four phases; invented kinds and unconstrained range failed with property-level
  messages; seed/proc/private-file/network probes returned only negative booleans; private
  paths, incomplete submissions, and post-negative health were checked.
  `/private/tmp/constraint-716-http-acceptance-final.log`.
- Real parent Portal components at parent revision `6bce083`: **1 test passed** (7.15 s).
  Root rendered the product components and replaced only transport with local 18146.
  It edited the same three reader files, submitted the four code rows and the manual
  first-broken JSON, observed all five correct, each solved row folded, and zero unanswered.
  `/private/tmp/constraint-716-portal-harness.test.tsx` and
  `/private/tmp/constraint-716-real-portal-component.log`. The temporary parent test was
  removed afterwards. This is a component/HTTP test, not a browser screenshot or AWS run.
- Actual CLI public/adapter assertions: **14 passed** using the same reader files in a
  temporary submission directory; the starter checkout was not replaced.
  `/private/tmp/constraint-716-cli-public.log`.
- Actual Linux execution boundary: **10 tests passed**, including multi-seed reference
  phases, stdout forgery/private imports, all process environments enumerated by the
  trusted parent (plus self and PID 1), supervisor signals/resource changes, partial
  output/no newline, blocked input, successful/timeout process-group cleanup, hidden-input
  print suppression, and manual-answer shape. `/private/tmp/constraint-716-linux-boundary.log`.
- Existing mutation suite: **25 cases passed** (24 negative cases plus a valid-range
  acceptance control), with rule-specific messages for targeted mutations. No mutation/checker was changed.
  `/private/tmp/constraint-716-linux-mutation.log`.
- Pure exact search: **400 random gadgets, zero disagreement with brute force**; 134 used
  the value-by-value fallback and none exceeded the budget. The selector exploit was
  rejected and all three legitimate constructions passed on three seeds.
  `/private/tmp/constraint-716-range-exactness.log`.

The author `reference-test` target now runs mutation plus Linux boundary checks in
restricted disposable containers. The final repository-root `make install` and `make agent-gate` passed: **116 metadata
records valid** (`/private/tmp/constraint-716-catalog.log`). The documented `make
reference-test IMAGE=constraint-716 FLAG_SEED=constraint-boundary-synthetic` target
also passed, recorded in `/private/tmp/constraint-716-reference-target.log`. The catalog
gate is separate from these runtime claims.
Host-only tests skip Linux isolation intentionally; the actual Linux results above supply
that evidence. After the final 34-check HTTP rerun, the dedicated project was stopped: both containers
and both project networks were removed; project-filtered listings were empty. Logs:
`/private/tmp/constraint-716-cleanup.log`, `constraint-716-remaining-containers.log`, and
`constraint-716-remaining-networks.log`. Images/build cache remain; no broad Docker cleanup
was performed. The initial final-HTTP attempt met sandbox localhost EPERM before any
request; the same scoped test passed after normal approval review, without an approval rejection.
