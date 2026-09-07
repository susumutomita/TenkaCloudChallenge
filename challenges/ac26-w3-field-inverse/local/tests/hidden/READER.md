# Field inverse initial reading — root, 2026-09-07

Scope: selected Japanese/English shortDescription, instructions and all five existing hints; starter/field.py and public/test_field.py. Root had already seen the first 100 lines of the author README before this reading, including trace/mutation descriptions. This is therefore an author participant-surface reading, not an independent blind test. No hidden checker, generator, reference, or current verifier internals have been read. Frozen response derives the algorithm from the visible statement and reproduces its p7/p6 examples.

Real gaps:
1. First useful action appears after long theory. Normalize one negative number in __init__ should be the entry; it is already a separate checkpoint.
2. There are only five hints across seven checkpoints; arithmetic/errors have none, and all start from checking/strategy instead of mechanism.
3. Short description uses elliptic curve, extended Euclid, modulus and element without definitions there; statement uses ≡ before defining it parenthetically and modulus before its definition.
4. Saying Fermat's shortcut is correct only for prime moduli is too strong per-input: a=1 works under6, and other composite cases can work. It is guaranteed for every nonzero value over a prime; not guaranteed for a general composite. Prime input zero also needs exclusion.
5. Finite field is defined as prime-modulus remainders; this describes the prime fields used here, not all finite fields. General extension fields need no digression, but the scope should be explicit.
6. The extended-Euclid table is given, but why a*s+m*t=r survives each update and why gcd=1 decides invertibility is only asserted. Explain subtracting q times an identity, and why a common divisor greater than1 cannot divide1.
7. Composite hint says the answer is always smallest prime factor, then says prime returns0. Qualify the factor rule as composite-only, use p7 vs modulus6/9 comparison.
8. Public output claims no negative value tested, but the actual public check includes -1. Both statement and printed success feedback contradict it.
9. Text says only edit return bodies and value assignment, yet mismatch checks, equality/hash consistency, coefficient loops and exception branches need additional statements. Show the relevant method names and class fields plainly.
10. __eq__ starter ignores modulus while __hash__ includes it, violating equal-values/equal-hash contract across moduli; mathematical equality here needs the same modulus as well as remainder. The statement doesn't explain equality between different moduli.
11. Claims every curve-point addition calls inverse are false for identity/opposite points and implementation-dependent coordinates; motivate affine formulas without that universal claim.
12. Inspect already prints a counterexample. Asking readers to calculate before seeing that answer conflicts with the first action Inspect. Give small p7/m6 scratch tables and treat Inspect as a comparison, not a surprise/no-spoiler assertion.
13. The program/class terminology and English starter (F_p, canonical representative, ring, Z_n) still make the vocabulary bar higher than the Japanese explanation. Introduce code mappings and remove unused formal symbols.
14. Needed failure conditions for every arithmetic operation are public, but text explicitly says checker only tests '+'. Preserve actual mathematical contract and check all operations instead of relying on that blind spot.

Seven meanings and hand answers:
- normalize: same remainder, single representation; -2=7*(-1)+5, so value5; -7->0.
- arithmetic: do integer operation then reduce; 5+4->2, 5-4->1, 5*4->6 modulo7.
- egcd-trace: upper=(3,1,0), lower=(7,0,1); rows(q,r,s,t)=(0,7,0,1),(2,3,1,0),(3,1,-2,1); gcd1, s=-2, t=1. q accompanies the lower row before the subtraction.
- inverse: 3*(-2)+7*1=1, so inverse3 is5; 4/3=4*5->6 modulo7.
- errors: zero has no partner multiplying to1; different modulus operands require FieldMismatch, zero inverse/division NotInvertible.
- composite: modulo6,2 shares gcd2, hence no inverse, and it is smallest nonzero nonunit; modulo7 return0 sentinel because all1..6 invert.
- units: modulo6 only1 and5 invert, to1 and5; modulo9 units1,2,4,5,7,8 invert to1,5,7,2,4,8. Others raise. Same algorithm should distinguish both without specializing the input modulus.

Frozen reader: reader-field.py, SHA256 d95f8913442ea7879fc8447a91f2a5c1c9b2c4c35d81c9389ac91fffe3dac2ee.

## Current participant baseline and later author inspection

Dedicated localhost18155, Compose project ac26-field-inverse-reader-716, seed field-inverse-reader-716. Before hidden/reference/verifier reading, the frozen reader passed the three public tests and all seven real prepare-to-verify checkpoints. Inspect used prime137/composite111 and a46; the displayed trace ends gcd1,s3,t-1. A first direct API attempt used the wrong key flag and was rejected; the existing Portal request uses submission. This was corrected without changing the reader and recorded separately from any product defect.

After that baseline, author inspection of verifier/server.py and tests/hidden/check_field.py confirmed the child currently reports its own failures list. A minimal source that prints {"failures":[]} and exits was then accepted on all seven checkpoints through the real API. Evidence: baseline-stdout-spoof.json. The corresponding public run also prints the misleading no-negative-tested sentence despite testing -1. No revised problem code has been written yet.

Both teaching inputs were read after the initial answer was frozen: official advanced-cryptography-2026/week3/problems/schnorr-from-scratch/README.md Part1 and own advanced-cryptography-note/week3/index.html slides13/14/A4 and the inverse exercises. The note's remainder and gcd back-substitution explanations connect the numerical table to the abstract invariant. No other participant submission was consulted.


## Revised lesson and later author/runtime verification

The initial source above remains unchanged and is retained in
`portal/reader-field.py` with SHA256
`d95f8913442ea7879fc8447a91f2a5c1c9b2c4c35d81c9389ac91fffe3dac2ee`.
No independent blind-reader claim is made: the original reader had seen the first100
lines of the author README before its participant-surface review. The baseline public3
and actual sealed prepare→verify all7 PASS preceded internal/checker/reference reading.
Artifacts remain under `/private/tmp/field-inverse-716-reader/` as `baseline-*.json`.

Both teaching inputs were also read by the implementer: official
`advanced-cryptography-2026/week3/problems/schnorr-from-scratch/README.md` Part1 at
`bdbc913fa7fd4ed87ce7f0de6b1d73fb41e49732`, and the owner's
`advanced-cryptography-note/week3/index.html` slides13/14/A4 and inverse exercises
(lines600–648) at `58344a29ea39c25839475ba9a594c115ed89989b`.

The revised statement links normalization, ordinary arithmetic, the row invariant
`a*s+m*t=r`, inverse existence `gcd(a,m)=1`, and the code/submit control for every row.
Root independently reviewed revised JA/EN and all21 hints; early class terms,
unconditional inverse extraction, and existence versus checking a candidate were
corrected. `revised-{ja,en}.md`, `revised-hints-{ja,en}.json`, and `revised-field.py`
are retained in the temporary reader folder. The final hand examples are modulus7
normalization/arithmetic, egcd(3,7) with all3 rows, inverse3=5 and4/3=6, plus all units
of moduli6 and9. The latter are respectively1/5 and1/2/4/5/7/8 with inverse partners
1/5 and1/5/7/2/4/8. The table is a concrete instance of the stated invariant, not its
substitute. All7 rows are code submission; there is no separate manual number/JSON.

Scoring IDs, points, wrong-answer costs, existing hint IDs/prices, and tcw1 preparation
are preserved. Added hints have zero extra cost; existing aggregate hint cost is62.

### Correctness authority

After the baseline, a pure `print('{"failures":[]}'); os._exit(0)` was accepted on all7
real checkpoints. `baseline-stdout-spoof.json` records it. The same source now fails
all7 through actual prepare→verify, and the public route also rejects it; see
`final-stdout-spoof.json` and `/private/tmp/field-inverse-716-final-http.log`.

A problem-local worker keeps Field/Element objects and returns their value/modulus and
operation results. The trusted parent checks every returned integer remainder against
its own arithmetic, and owns the unchanged original property-case selection. Wrong
inverse/multiplication implementations cannot certify each other with a fabricated
product of one. Extra checks cover modulus/equality/hash consistency, all four mixed
modulus operations, and integer-not-bool/float trace data. List/tuple sequences,
exception subclasses and constant colliding hashes remain valid representations.

Initialization receives source only, no calls or seed/checker. Fresh128-bit IDs follow
readiness and reject preprinted/static/reused replies. These IDs are readable by
arbitrary Python and do **not** attest native return statements or exception origins.
A live-protocol implementation with correct mathematical data is accepted; the same
protocol with wrong values/moduli/bool/float data is rejected. Printed failures lists
or success messages never decide a grade. These finite checks do not prove correctness
for every possible input or implementation.

Original25s wall,512MiB address space and64process settings remain. The original64KiB
source/log bound is retained for accumulated non-result output; the new value protocol
uses64KiB frames and bounded parent-issued calls. CPU limit25s aligns with the wall
limit. Child env contains no seed/checker, inherited FDs are closed. Both servers call
protect_supervisor; nonroot services use init reaping. Seccomp denies filesystem and
network/exec access, persistent IPC, filesystem metadata writes and changes to the
supervisor's scheduler. Zombies are failures, not cleaned-up processes.

Public initialization failures disclose only validated source filename/line/type;
private failures remain generic/public-rule messages. Public7 tests now include
negative normalization, small modulus7 arithmetic/trace/inversion and zero/mixed
exceptions. The14 documented computational stdlib modules are preloaded before file
isolation; correct source importing all14 (including fractions/statistics/random)
passes public and every checkpoint. Additional packages/file/network access are not
part of the documented environment.

### Commands and observed evidence

Dedicated project `ac26-field-inverse-reader-716`, localhost18155, synthetic seed
`field-inverse-reader-716`. Compose copy `/private/tmp/field-inverse-716-compose.yml`
uses the problem source context and remaps only the default18100 host port. The verifier
remains internal18146. It is left running for parent review. No real AWS, unrelated
stack or production secret was used.

From the problem directory:

```sh
make runtime-test
make reference-test
AC26_WORKBENCH_URL=http://127.0.0.1:18155 sh local/tests/hidden/portal/run.sh /Users/susumu/product/TenkaCloud
```

From catalog root: `make install` then `make agent-gate`.

- Linux20PASS,129.915s: `/private/tmp/field-inverse-716-runtime-final20.log`.
  Includes64 successive accepted submissions ×4 forks=256 descendants with no extra
  PIDs/zombies after each;16 IPC attempts;19 filesystem metadata operations ×16
  workers all EPERM and unchanged parent content/list/mode/ownership/mtime/xattr;
  four actual scheduling calls denied, parent scheduling unchanged; private files,
  env, network/exec, inherited FDs, signal/rlimit changes, timeout/cleanup and malformed
  startup diagnostics; live-ID correct/wrong mathematical controls.
- Original14 mutants killed, reference and the four units near-misses through the
  trusted evaluator: `/private/tmp/field-inverse-716-mutations-final.log`.
- Catalog116PASS: `/private/tmp/field-inverse-716-catalog-final.log`.
- Frozen reader actualHTTP public7 / sealed prepare→verify all7PASS:
  `/private/tmp/field-inverse-716-final-http.log`, `final-verdicts.json`.
- Final participant image's existing `tests/public/test_field.py` CLI7PASS:
  `/private/tmp/field-inverse-716-public-cli.log`. Frozen source was placed in a temporary
  directory, `SUBMISSION_DIR` selected it, and it was deleted afterwards. Literal default
  `make test` was not run against the intentionally unfinished starter or a second stack.
- Retained real ContainerWorkbenchPanel test1PASS,16.74s test/40.25s total:
  `/private/tmp/field-inverse-716-portal-final.log`. Actual config/starter/Inspect/public
  tests/prepare/verify; frozen source pasted into the editor; all7 submissions pass and
  each solved row folds. Only the outer auth/scoring adapter is mocked. This problem's
  metadata supplies IDs/names/points; no sibling grading metadata is copied.

Harness corrections: the live-ID positive control originally emitted an intermediate
inverse during a division call. It was limited to direct element construction so its
claimed correct output is correct. Broad test-template renaming changed method names
containing 'change'; those names were restored. A direct probe initially read config
checkpoint objects as string IDs; it now uses id. The first Portal run exceeded Testing
Library's default1s result wait during concurrent work, so the harness now explicitly
waits15s for the actual result without changing product execution limits. Final retained
runs above passed.

These are component+HTTP/Docker checks, not a real browser session, timed human playtest,
AWS deployment, or production cryptographic-safety proof. The branching Euclidean table
is not a constant-time secret-key implementation. No commit or push was made here.


## Root review and forwarded execution window

Root reviewed the parent-side modulus/value/equality/hash/exception checks and
worker isolation after the participant-surface read. A correct constant-hash
implementation and declared exception subclasses remain valid; a child's ready
frame or object handle is not proof of a native Python return.

A further actualHTTP check found that the Portal proxy waited15s despite the25s
computation window. The unchanged reader plus16s startup failed after15.03s.
The proxy now allows30s for computation/cleanup/transport; the evaluator25s and
request-body15s limits remain. Two new actual-loopback regressions pass in0.273s,
including rejection after its forwarding deadline and of mismatched checkpoint
IDs (`/private/tmp/field-716-forward-tests.log`). These are additional to the20
Linux tests already passed above; no mathematical or isolation check was removed.

The retained `check_allowance_http.py --base-url http://127.0.0.1:18155` passed
public examples and all7 sealed submissions. The same16s startup succeeds in16.421s,
while26s startup fails in25.056s; helper imports succeed
(`/private/tmp/field-716-final-root-http.log`). The root reran the retained real
Portal component against the rebuilt services: all7 fields and solved-row folding
pass,1 test/11.82s total/5.11s test (`/private/tmp/field-716-root-portal.log`).
The frozen reader SHA and all scoring/hint IDs and amounts remain unchanged.


## PR770 exception classification review

At d7ccd9f the original image reproduced both review cases: appending
`NotInvertible=ValueError; FieldMismatch=TypeError` to the unchanged frozen answer
incorrectly passed all7 checkpoints; a class inheriting both supplied exceptions
incorrectly failed the errors checkpoint.

The worker now validates that supplied error names refer to custom exception
classes, captures those references once after initialization, and reports every
matching membership. Rebinding a module global later does not change that lookup.
The trusted parent computes the permitted error from its own validated operands
and operation: different moduli require FieldMismatch; an inverse or divisor with
nonunit gcd requires NotInvertible. An error for an otherwise valid operation is
rejected. Multiple inheritance therefore does not depend on classification order.
These protocol fields remain untrusted data; this does not attest the origin of
native Python exception objects against an arbitrary implementation of the wire
protocol, just as handles do not attest native objects.

Validation after this correction:24 Linux tests PASS in18.515s, including both
new regressions and the prior20 mathematical/isolation cases plus2 forwarding
cases. Builtin aliases are rejected in all7/private and public routes; late
rebinding is rejected; the dual-inheritance answer passes all7/private and public
routes, but using that class to refuse an invertible value fails. The frozen answer
and ordinary subclass/constant-hash positive controls remain unchanged. All14
existing mutants are killed, reference passes, catalog116 passes. Runtime and
mutation logs: `/private/tmp/field-770-exception-runtime.log` and
`/private/tmp/field-770-mutations.log`.

### Additional review regressions (2026-09-07)

At `6a6bc0a9`, a submitted exception metaclass whose `__instancecheck__` always
returns true allowed builtin exceptions to pass the errors checkpoint. A separate
mutant comparing `self.field is other.field` passed normalization. Two new tests
reproduced both failures before the fix (26 tests, exactly these two failures).
The worker now uses the actual exception type's MRO and identity comparisons,
without submitted instance-check or equality hooks. Both public and private
normalization checks construct an equivalent element through a separate `Field(p)`.
Ordinary exception subclasses, multiple inheritance, and colliding valid hashes
remain positive controls. The Japanese operational section now mirrors the English
runtime, safety, resource and verification information in Japanese.

After these changes, all 26 Linux regressions passed (20.171 seconds), the existing
14 mutants were rejected with the reference accepted, and catalog validation passed
for all 116 entries. These are local author tests, not a new independent reader run
or an AWS deployment check.

### Separate Field instances in arithmetic (2026-09-07)

At `b87f88c2`, four separate mutants restricted one of `+`, `-`, `*`, or `/`
to identical Field instances. Each passed its private checkpoint despite violating
the documented same-modulus contract. The new regression reproduced all four
failures before the fix. Public modulus-seven examples and private arithmetic and
division cases now construct the operands from separate Field instances with the
same modulus. Existing identity, distributivity, and different-modulus rejection
checks remain in place.

All 27 Linux regressions pass after the fix, including rejection of each mutant by
both the private checkpoint and public tests. The frozen reader and reference
remain positive controls; all 14 existing mutants are rejected. Logs:
`/private/tmp/field-770-arithmetic-before.log` and
`/private/tmp/field-770-arithmetic-after.log`. This is a grading regression check,
not a new participant read-through or cloud deployment.
