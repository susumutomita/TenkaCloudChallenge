# PLONK participant evidence — 2026-09-06

## Inputs and revision

The teaching design was checked against both the seminar Week 4 PDF (printed slides 27 and 29, PDF pages 31 and 33) and the author's Week 4 derivations §§3.1–3.2. The earlier design used a three-gate table, separate gate/fingerprint primes and twelve prose steps for eight answer fields. Its reader pass found a weak first action, unexplained field conversion and a closing enumeration task.

The revision uses two gates and six cells over the same prime 7, eight matching answer fields, and a final nonzero-product counterexample construction. Three hint rungs per field follow mechanism → formula/example → displayed-input procedure. Necessary formulas remain in the statement.

## Independent hand reader

A separate agent received only the participant statement, hints, starter and public snapshot. It did not read the generator, verifier or reference implementation and did not execute code. It solved all eight checkpoints by hand. Its remaining finding was undefined F(Y), G(Y), Z(Y) in the deeper explanation; these are now defined immediately before use in both languages.

Public snapshot: p=7, a0=4, b0=2, g=2, w=6, tags=(2,3,1), beta=1, gamma=5.

| Field | Hand answer |
|---|---|
| outputs | 6,1 |
| bad-row | 1,6,6 |
| addresses | 2,3,1,5,4,6 |
| sigma-addresses | 2,3,5,4,1,6 |
| marks | 4,3,5 |
| grand-product | 5,5 |
| bad-product | 6,2 |
| miss-count | 0,2,0 |

The final row breaks both copies, preserves multiplication, and gives equal nonzero products (3,3). The independently calculated alternate (2,4,1) gives products (5,5). The public linear equation constructs these without reading the answer checker.

## Actual Compose route

Both participant and verifier services were built and started in a dedicated local Compose project. The test retrieved `/api/config`, `/api/inspect` and `/api/starter`, then used only the hand answers above with `/api/prepare` → `/verify` through the published participant port.

Observed:

- All eight prepared hand answers passed. All eight unprepared answers and eight deliberately wrong answers failed, with only checkpointId/correct returned.
- The alternate final construction passed. Honest, one-copy-only, wrong-output, zero-product and out-of-range rows failed.
- The exact first editor line supplied in the statement passed `outputs` while later starter functions remained unfinished.
- An independent scratchpad translating the public formulas, including the linear construction, passed all public tests on the running instance.
- The learner subprocess had neither FLAG_SEED nor an importable fixture-generator module.
- Japanese and English config summaries matched the revised eight-field construction task.

This is runtime API evidence, not a full rendered Participant Portal walkthrough. It proves the actual public-input/preparation/scoring path and optional editor execution; it does not claim browser layout, all UI controls or real AWS deployment were tested for this PLONK change.

## Author gates

`make reference-test` passed: 10 mutation cases, 8 learning-contract tests, 5 network/process-isolation tests. Learning tests cover 150 generated instances, all address-tag permutations, public/private construction agreement on all 49 input pairs over 30 instances, linear-construction completeness, zero-product rejection, interpolation/accumulator equations, binding/row checks, and 24 hints within the score budget.

`make install && make agent-gate` passed at the catalog root. Parent `make before-commit` passed in a clean TenkaCloud worktree whose platform content matched current main; this is platform baseline evidence, not proof of a new catalog pin or deployed revision. Real AWS and a human seminar rehearsal remain optional and were not run.
