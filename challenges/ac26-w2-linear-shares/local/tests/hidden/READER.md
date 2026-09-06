# Linear shares: participant reading and runtime evidence (#716)

## Reading boundary

The root reader first read only JA/EN statements, all 15 hints in each language,
`linear.py`, Inspect, public-test output and the participant prepare/verify API.
It had not read hidden checks, reference solutions or runtime code. This was an
agent acting as a junior-high-school reader, not a timed human playtest.

The separate runtime implementer then independently read the revised JA/EN packet,
all hints and starter docstrings before inspecting private code. That second read
confirmed all five checkpoint purposes and the hand classification below; it flagged
undefined congruence notation, English preprocessing terminology, the need to define
Σ locally in each hint, and `c % p` on the right of the general offset identity.
Those findings were returned to the root lesson author. Implementation/security
inspection afterwards is not claimed as participant-only reading.

## Original first-read findings and baseline

Read both language statements, all 15 hints in each language, and public linear.py. This is an agent-role reading, not a human timing measurement. No hidden checker/reference/runtime source has been read.

1. The useful Start/Inspect action comes after broad wallet/FROST claims; pure local arithmetic is not a complete threshold-signature protocol. Define MPC, secret sharing, share, and the centralized teaching view locally.
2. The opening (5+x)+(3+x)=8+2x uses one identical x and calls it each party's piece; real different-party shares are independent values whose SUM is the secret. Show rows a_i,b_i and the sum identity instead.
3. The condition that every party adding c must fail is not universal: c=0, or (n-1)c=0 modulo p, makes the sums equal. Correct arithmetic cannot be rejected merely for matching x+n*c then. Inspect the actual grader only after baseline recording.
4. Exactly one party adding c is a sufficient construction, not the only possible one. Public offsets whose sum is c also work; if n is invertible modulo p, everyone can add c/n. Do not teach asymmetry as mathematically necessary.
5. The needed add_constant formula is expressly withheld in the starter and classification is deferred to judgement. State the formulas and model conditions before paid hints.
6. Communication claims say they hold regardless of protocol; specify additive shares, at least two parties, arbitrary secret inputs, no extra correlated preprocessing and result still shared. Square over p=2 is linear, so state odd prime. Comparison needs an order on normalized integers 0..p-1, not an intrinsic finite-field ordering.
7. The comparison explanation jumps from comparison to bit decomposition to products without showing why local rows are insufficient. A small wraparound example can demonstrate that comparing shares separately does not compare their sums.
8. Hints mostly use 101-size worked numbers, with the first transfer hint beginning in debugging rather than the mechanism; final transfer says absence of literals other than0/1 implies success, which is false.
9. First move encourages a deliberately wrong paid submission. The same symptom should be visible in free public tests before a learner chooses to submit.
10. Unknown-operation advice asks to avoid KeyError although the stated input domain is exactly eight named strings. Do not promise fallback correctness outside this domain.

I will implement four functions from the public rules and classify the four displayed names without hidden answers.

Public Inspect: p101,n6,c33,shares[37,24,82,87,47,88]. Hand sum365→x62; one party+33 gives95; all6 add33 yields365+198=563→58. Classification: add-shared0 by rowwise addition; add-constant0 by one pre-agreed row; mul-shared1 because cross-party terms; square-shared1 because p101 is odd and cross-term2a_i*a_j remains. Allrows are shown centrally, so x is recoverable by the reader despite the text saying secrets are not printed; this needs explicit teaching-view framing.

Baseline actualroutes: unchanged four-function source passed4codechecks and manualclassification via prepare+verify. Hidden checker was first read only afterwards: correct degenerate add_constant totals are already accepted by a guard; the erroneous unconditional rejection claim is documentation, not a grading defect. check_rounds fails to reject negative integer values on the positive side, contradicting public0-or-more contract. Baseline submitted source printing fabricated empty failures was accepted; exactboolverdict savedwithoutseed.


The reader source was kept byte-for-byte unchanged during the runtime changes.
Its SHA-256 is `ff3e4a1dcb3240ec31f141432bcb09d13253d279a54fc619359cd446c1cd421e`:

```python
def add_shares(a,b,p):
    return [(x+y)%p for x,y in zip(a,b)]

def add_constant(shares,c,p):
    out=[s%p for s in shares]
    out[0]=(out[0]+c)%p
    return out

def mul_constant(shares,c,p):
    return [s*c%p for s in shares]

def communication_rounds(operation):
    return {"add-shared":0,"sub-shared":0,"negate-shared":0,"add-constant":0,"mul-constant":0,"mul-shared":1,"square-shared":1,"compare-shared":1}[operation]
```

The manually produced displayed-operation answer was:

```json
{"add-shared":0,"mul-shared":1,"square-shared":1,"add-constant":0}
```

`add-shared` adds each party's row; public offsets can add a known constant locally.
Multiplying secrets leaves cross-party products. Squaring over the stated odd prime
also leaves `2*a0*a1`. Thus the latter two require communication in the stated model.
This JSON was passed through the existing `/api/prepare` `tcw1.` envelope, not posted
as an unsealed grading shortcut.

## Concrete defects and fixes

- Before: `print('{"failures":[]}'); os._exit(0)` returned `correct: true` for
  add-shares. After: the trusted parent calls the existing checker and receives only
  untrusted JSON function values from a separate worker. All four code checkpoints
  reject this stdout grade forgery. A learner cannot load the checker or seed.
- Before: `communication_rounds` could return -1 for an interactive operation and
  pass transfer. After: booleans, fractions and negative values are rejected; positive
  integers such as 2 remain accepted because the task asks zero versus positive,
  not an exact protocol's number of rounds. Manual JSON already enforced this bound.
- Public tests now include p=7, shares=[5,6,0], c=2: the returned total must be 6.
  This exposes the all-party addition bug before a scored submission. Hidden checks
  additionally test format, reconstruction, composition and classification; their
  top-level documentation no longer claims to prove privacy of n−1 output shares.
- Both services protect their supervisor process and use `init: true`. The worker
  closes inherited descriptors, gets a clean environment without FLAG_SEED, applies
  existing problem-local Linux seccomp restrictions before source execution, and has
  bounded input/output, CPU, memory and wall time. Only the Workbench parent keeps
  the existing seed required for `tcw1` preparation. The verifier repeats its seal
  verification. No new shared runtime or platform endpoint was introduced.
- Public startup errors show only validated `linear.py:line: ExceptionType` fields.
  Filename, line range and exception type are checked; arbitrary exception messages
  and internal paths are omitted. Hidden evaluation errors stay generic, and hidden
  function prints never enter grading feedback.

## Reproducible validation (2026-09-07)

All runs used synthetic seed `linear-shares-reader-716`. The dedicated Compose project
was `ac26-linear-shares-reader-716`, with only the Workbench published on localhost
18149. No real AWS environment, account secret or browser interaction is claimed.

| Evidence | Result |
|---|---|
| `make runtime-test FLAG_SEED=linear-shares-reader-716` | 13 Linux tests pass: valid functions, value/verdict boundary, negative rounds, public p7 example, file/proc/network/exec restrictions, parent signals/limits, inherited FD closure, timeouts, descendant reaping, startup diagnostics, deeply nested stdout JSON, tcw1 preservation |
| `make reference-test FLAG_SEED=linear-shares-reader-716` | Reference passes; all 7 existing mutations killed |
| `make install` then `make agent-gate` | 116 metadata/catalog entries pass |
| Actual participant HTTP: unchanged reader + hand JSON | Public 5 tests pass; all 5 prepare/sealed/verify submissions return correct |
| Actual HTTP regressions | Four code stdout forgeries rejected; negative transfer rejected while independent add-shares passes; unsealed manual rejected; syntax/import/init locations bounded; private errors generic; public p7 wrong result detected |
| Repeated actual HTTP fork submissions | 64 successful submissions create 256 descendants; zero zombies after every settled request; verifier process count before=3, after=3, maximum settled sample=3 (includes the measurement process) |
| Participant-image public CLI, unchanged reader copied over stdin | All 5 public tests pass; no reference/hidden files used for this answer |
| Shipped starter public CLI | Intended failures remain, including the p7 public-constant error; this is not counted as a passing solution |

The process regression waits until extra PIDs disappear, not merely until no process
is currently in state Z. A dying live child can become a zombie between two samples;
checking for zero Z once is insufficient evidence of reaping. The regression requires
complete disappearance and does not treat zombies as successful cleanup.

The literal `make test` route was attempted using this dedicated Compose project.
Its `/private/tmp` host bind mount appeared empty inside Docker and failed with
`FileNotFoundError: /problem/starter/linear.py`. This environment failure is recorded
separately from the passing participant-image CLI and actual editor HTTP route; no
claim is made that this host bind mount was fixed. An initial HTTP run was interrupted
by that make target recreating the verifier; it was rerun after all builds completed,
and the complete HTTP run then passed.

Local evidence artifacts from this run:

- `/private/tmp/linear-shares-716-reader/first-reading.md` and `baseline-*.json`
- `/private/tmp/linear-shares-716-http.py` and `linear-shares-716-http.log`
- `/private/tmp/linear-shares-716-boundary.log`, `linear-shares-716-mutation.log`
- `/private/tmp/linear-shares-716-cli-public.log`, `linear-shares-716-make-test.log`
- `/private/tmp/linear-shares-716-catalog.log`, `linear-shares-716-runtime-build.log`

The acceptance boundary here is the actual participant HTTP API plus image CLI.
The root reviewer then ran the actual ContainerWorkbenchPanel and submission
components against localhost 18149, with only the Portal transport redirected to
that API. The unchanged reader source and hand JSON passed all five submissions;
the four code rows submitted the editor source, the manual row used the existing
prepare envelope, and each solved row collapsed. One harness test passed in
818 ms (4.19 seconds including setup). Artifacts:
`/private/tmp/linear-shares-716-portal-harness.test.tsx` and
`/private/tmp/linear-shares-716-real-portal-component.log`. The temporary test was
removed from the clean parent checkout. This is component-to-HTTP verification,
not a real browser, physical-device or production claim.
