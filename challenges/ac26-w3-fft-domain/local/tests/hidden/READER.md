# FFT domain rewrite: reader and verification record (#716)

## Initial participant-surface read (2026-09-07)

Author read the statement, hints, starter and Inspect text first. This is not an
independent blind reader: other Week 3 problems and the old verifier wrapper had
already been inspected. Before opening this problem's hidden checker/reference,
the following concrete gaps were found:

- The introduction assumes a prior NTT problem and starts with a million-row table.
- Hint 1 uses F_p, multiplicative group and subgroup before defining them locally.
- The inverse hint says n ** -1 without distinguishing modular inverse from a
  floating-point reciprocal.
- The first instructed hand calculation uses 75² and 97 despite an available p=5 example.
- Position/index and polynomial coefficient/degree terminology are not introduced.
- The interpolation procedure is behind a hint rather than explicit in the statement.
- The fft function name suggests a speed requirement, though direct evaluation suffices.
- Later checks disclose hidden-phase strategy rather than explain applying the contract.

The rewrite uses a point table and coefficient/value arrows, gives all required
formulas in the free statement, and expands five hints into fifteen rungs.
Penalties remain 16+16+12+18+18=80; checkpoint points remain 200.

## Both course inputs

Read seminar week3_zksnark_slides.pdf, printed pages 19–20 and appendix A16–A18:
coefficient/evaluation definitions, p=5 omega=2 example, inverse transform.
Read advanced-cryptography-note/week3/index.html, coefficient/evaluation and FFT
sections (around lines 2905–2980): polynomial reconstruction, even/odd split,
and the distinction between changing an answer and computing it faster.
The rewritten forward example [1,2,3,4] → [0,4,3,2] follows the seminar p=5 example.
The smaller n=2 inverse example [1,2] ↔ [3,4] shows both inverse factors explicitly.

## Baseline runtime defect (repaired below)

The current verifier accepts every checkpoint for a source containing only:

```python
print('{"failures":[]}')
raise SystemExit
```

A local call through verifier.server.evaluate returned True for domain, roundtrip,
ordering, interpolate and generalize. This is not participant work and must fail.
Do not treat the metadata gate as proof of actual grading or submit this rewrite
as complete until the parent verifies function values, the regressions reject this
shortcut, and the participant route succeeds through the actual editor component.

## Validation so far

The 116-item catalog gate and git diff --check pass after dependency installation.
An initial gate failure caught the missing premise heading; the statement now
uses the required bilingual heading around the actual remainder/point definitions.
The initial pass did not yet include runtime acceptance; the completed results follow below.


## Review follow-up: private call envelope

PR #774 exposed a remaining exception-provenance bypass: a learner could read
callId from the Python dispatch frame and print a matching errorKinds response
before the native reply. The before test accepted that source at on-curve.
A second before test rejected a valid dataclasses/copy import.

The call nonce is now parsed and retained only in C, outside the JSON supplied to
Python callbacks; the response body is fully encoded before C writes its private
envelope. Plain learner stdout and stale envelopes cannot satisfy a current call.
All mathematical values remain untrusted and checked by the parent. This is not
protection from arbitrary native memory corruption or from a user controlling Docker.
The documented standard-library list is loaded before filesystem restrictions.


## Final participant route and checkpoint reading

The author wrote reader-fftdomain.py from the starter and the displayed first-return
procedure, before opening this problem's hidden checker/reference. It changes only
_domain_ok; existing parsing and transform helpers remain. This is an author reader,
not an independent novice experiment. The frozen source hash is:
2e7ab7a2e5d811d85d07b33bf38a523bc91875de19a2318da81ae10b854bf49b

| Checkpoint | Why / concrete reasoning | Observable evidence |
| --- | --- | --- |
| domain | p=5: 2 returns after 4 steps, 4 after 2; four distinct points need the former | real evaluator accepts reader, rejects always-valid and starter |
| roundtrip | p=5,n=2: [1,2] becomes [3,4]; inverse factors 4 and 3 recover [1,2] | public roundtrip and private checkpoint pass; wrong inverse mutants fail |
| ordering | f(x)=x at [1,2,4,3] must keep that same order | public transform, private ordering pass; reversed-output mutant fails |
| interpolate | [3,4] at [1,4] recovers 1+2x; point 0 gives 1, point 4 gives 4 | public inside/outside examples and private checkpoint pass |
| generalize | p=7,omega=2 has period 3; p=5,n=3 cannot work since 3 does not divide 4 | other parameter/input rules pass in private checker |

Eight runtime regressions pass, including public/private positive controls, startup
spoofs, incorrect values, float remainders, forbidden private imports, and timeout
recovery. All eight mutations are rejected through verifier.server.evaluate,
not by loading a learner into the checker's process. Logs:
/private/tmp/fft-envelope-runtime.log; the initial adapter test failed because it
required two custom exception names, and was corrected to accept this problem's
empty exception list before the successful rerun.

The real ContainerWorkbenchPanel loaded the starter over HTTP, edited it to the
frozen reader source, displayed Inspect evidence, ran public tests, and submitted
all five checkpoints. The test verifies source snapshots, checkpoint echoes,
200 total points and disappearance of solved inputs. Test duration 1.26 s, log
/private/tmp/fft-portal-final.log. Platform API adapters/score projection are mocked;
actual local problem endpoints and the Portal component are used. This is not a
pixel/browser check, real AWS score-history verification or independent human study.

The 116-item catalog gate passes. Docker initially could not allocate another
network; the completed EC test environment was removed and FFT then started healthy.
No production environment or deployment was changed.
