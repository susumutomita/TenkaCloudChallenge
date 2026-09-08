# Prepare a joint proof: add without combining secrets

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. Statements, code,
> fixtures and figures are independently authored. Direct questions about this track to
> TenkaCloud, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 610 · **Week:** 6 · **Role:** `mechanism`
· **Time:** 60–90 minutes · **Points:** 300 · **Status:** draft.

## Outcome and scope

Participants build the linear preparation of a joint prover over secret-shared inputs.
A witness is the list of secret values; a share is one holder's part. Multiplication by a
public number and addition work separately for each holder by the distributive law. Their
outputs remain shares of `A = sum(a[j]*w[j]) % p` and `B = sum(b[j]*w[j]) % p`.
Initial sharing is supplied. This stage needs no communication after that preparation; it
is not free computation and does not generate a SNARK proof.

The later checkpoints audit the result's recorded origin and communication, then require a
counterexample to an optimization that removes zero coefficients but forgets their original
positions. Correct final numbers alone do not establish correct provenance, input validation,
or a truthful report. The same implementation must survive unseen parameters.

## Participant route

1. Start the problem in Participant Portal. Edit `prover.py` in the problem editor.
2. Implement `parse_relation` from its free contract and submit **relation**. A pass marks
   that checkpoint **Solved** and awards 30 points. Unfinished later functions do not block it.
3. Use **Inspect evidence** for the public configuration, share labels and operation records.
   Inspect prints no share values. Public tests use separate, public practice values.
4. Implement the label validation, local calculations, provenance audit and log report. Every
   checkpoint submits the current whole file; there are no direct-answer fields.
5. Implement `sparse_counterexample(p, width)`, check the two different results, then submit
   **transfer** together with the earlier functions.

The Japanese and English statements define the vocabulary, tuple shape, remainder arithmetic,
all required APIs, exception rules and one-digit examples for free. Each of eight checkpoints
has three optional hints: mechanism, small example, then editor action and observable feedback.
All 24 hints cost 2 points each, 48 total; the score and wrong-answer penalty remain 300 and 15.
Public tests check selected contracts and one counterexample; they are not complete verification.

## Grading

| Checkpoint | Points | Property |
|---|---:|---|
| `relation` | 30 | Normalize coefficients; reject malformed rows with `ValueError` |
| `witness` | 30 | Match shape, field, holder order and unique ids without value reads |
| `combine-a` | 40 | Scale and add the correct position of each holder's shares |
| `combine-b` | 40 | Validate inputs and calculate A and B from their respective coefficients |
| `audit` | 50 | Ask the runtime about issuance, ancestry, refused reads and reconstruction access |
| `trace` | 45 | Count operations, rounds, messages and holders from the entire post-run log |
| `equivalence` | 40 | Preserve the plain result under coefficient shapes and resharing |
| `transfer` | 25 | Pass unseen settings and construct an input exposing compacted-position errors |

`transfer` accepts any construction satisfying its public predicates; it does not compare to
one reference answer. Its checker independently computes the original and compacted products.
The author mutation run kills 30 broken implementations plus one verdict-spoofing submission.
Of the 30, 24 still reconstruct A/B correctly on every tested shape, demonstrating why the
other properties need their own checks. These are measured test results, not all-input proofs.

## Audit boundary

`Share.party`, `.field` and `.id` are public labels. The supplied runtime records operand ids,
result ids and communication flags; it does not record values. Its usual participant facade
omits `reconstruct`. `value_of` refuses cross-holder reads, and label validation must not call it.

The audit tests recorded origins. An unissued output makes `issued=False` and is excluded from
`singleParty`'s ancestry test. For issued outputs, `singleParty` checks whether any ancestor
input belongs to another holder. Empty input ancestry is valid for a zero combination.

This instrument is not a sandbox against its operator. Reading each holder's values through
separate scopes, or inspecting internal Python attributes, is not ruled out by an honest-looking
result trace. No claim that the witness was never assembled follows from this report. Real
SNARK generation, malicious-secure MPC and network protocols are outside this exercise.

## Runtime, costs and teardown

`local/docker-compose.yml` runs a participant Workbench and a separate verifier. The Workbench
image contains the starter, public tests, supplied `participant/mpc.py` and display script.
Fixture derivations, hidden checks and reference answers remain in verifier/author images.
The Workbench fetches public practice evidence and forwards verdict requests on the Compose
network. Only the Workbench publishes a loopback port (`127.0.0.1:18113`). Containers run
non-root, with read-only filesystems, temporary writable space and resource limits.

This local exercise creates no AWS resources and has no Region setting. Docker CPU, memory
and disk are used; event-hosting resources belong to the platform's separate cost model.
The intended session is 60–90 minutes. `make verifier-down` removes the Compose services and
network. Built local images remain until removed. A participant controlling the Docker daemon
can inspect all containers: this is self-study verification, not secrecy against the host owner.

## Verification and provenance

From this problem directory:

```sh
make test                 # runs public tests against the current starter; stubs fail initially
make test-one ID=parse_relation
make inspect
make reference-test       # author image: full checker and mutation suite
make verifier-down
```

The Issue #716 revision adds the three-rung hints and free function contracts, fixes claims
that exceeded the runtime's audit, and adds the participant-constructed transfer case.
It also checks bool rejection and the declared `ValueError` contract rather than accepting any
exception as a successful refusal. A zero witness now has its own case: A=B=0 must not be
misclassified as swapped outputs. Failure messages describe public properties only.

The Docker `make reference-test` run passes (31 mutants killed). The catalog gate validates all
116 metadata files. In the real local Workbench API, a parser written from only the free
contract passes `relation` while later functions remain unfinished; omitting coefficient
normalization returns the documented property-level failure. Separately, the author reference
passes all seven public tests and all eight prepared checkpoint submissions. A construction
that does not distinguish the two products is rejected with only that public property.
The CLI `make test` attempt could not import the starter through the Colima bind mount from
this temporary worktree; the Workbench API ran those same public tests from its built image
without that host-mount dependency. An independent participant-role read reviewed only the bilingual statement,
hints, starter, Workbench text and public tests. It caught a stale public-test description;
that description and the free statement's unissued-result rule were clarified. These checks
do not establish rendered Portal usability, deployed score persistence or a live AWS run.

The course alignment pins `week6/README.md` and `week6/problems/co-snark-prove/README.md` at
commit `a3aa4b56fa88fbe803b57d320fbc87c1a203b480`. This problem's runtime, coefficients and
checks are independently authored; official exercise answers are not copied.

## Parent-owned grading boundary (Issue 837)

The trusted parent runs the existing checkpoint checker. Submitted Python runs in a separate,
restricted Linux worker; typed values cross the boundary, not a grading verdict. Output text
or early process exit cannot award points. Tuple/list, integer/boolean, byte and dictionary-key
contracts are preserved where used. The worker has file, network, signal, memory, output and
process limits. A 12-second submission budget is below the Workbench proxy's 15-second timeout.
The images run non-root, and Compose and the author runner use init. These are tested controls,
not a claim that every possible isolation defect or side channel has been eliminated.

The revised Linux Docker run passed 30 logical mutations and 1 separate legacy verdict-spoofing probe, plus 11
execution-boundary regression tests. The boundary tests exercise all eight reference checkpoints,
a legal alternative, forged output/exit, private-file and parent-signal refusal, preserved types,
nesting bounds, non-root execution and timeout alignment. The native mutation tests examine
logical grading; the separate boundary tests examine execution isolation.

Actual non-root Workbench HTTP requests fetched config, live Inspect and starter; the unfinished
starter failed its first submission, while the author reference passed the 7 public tests
and all eight checkpoints through prepare and the verifier proxy. Output/exit spoofing failed
through that same route. Catalog validation passed for 116 entries. These are author and route
checks, not evidence of unaided first-time participant comprehension. Browser interaction,
deployed platform score reflection and deployment were not run for this change.

Runtime and share values stay in the parent. Per-call opaque handles route the supplied API to actual runtime operations; handles from earlier calls cannot be reused. The checker observes its actual read counters, issued shares and communication records.

The remote API also preserves its documented Python type relationship. A valid reference with explicit isinstance checks passes the evaluator, alongside all eight reference checkpoints.

### Supported computation imports / 計算用の標準ライブラリ

Supported computation imports / 計算用に使える標準ライブラリ:
array, base64, binascii, bisect, collections, contextlib, copy, dataclasses, decimal, enum, fractions, functools, hashlib, heapq, hmac, itertools, json, math, operator, random, re, statistics, string, struct, time, typing.
This list covers optional standard-library helpers. Imports already supplied by the starter (including __future__ and problem APIs) are also supported. Other optional imports and file/network access are not supported in grading.
この一覧は追加できる標準ライブラリです。スターターに最初からあるimport（__future__や教材のAPIなど）も、そのまま使えます。それ以外の追加importとファイル・通信操作には採点時は対応しません。
