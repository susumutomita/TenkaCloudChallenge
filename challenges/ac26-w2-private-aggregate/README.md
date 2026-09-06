# Five multiplications, one round

Implement a combined incident score from additive shares. Each organization supplies a count and a severity. The same program must calculate their products, preserve the permitted opening transcript, and batch the independent openings into one modeled round.

This is an independent, unofficial companion to Advanced Cryptography Program 2026. It is not affiliated with or endorsed by the course. This problem implements an arithmetic/opening-channel model, not a deployed MPC protocol.

## Participant route

Start in Participant Portal, select **Inspect evidence**, and edit `aggregate.py`. Begin with `plan(spec)` and submit **Estimate the cost before writing it**. Plan is independently gradable before the other functions exist. **Run public tests** checks a plan shape and one score example; its score check remains incomplete until aggregate is written.

The statement supplies definitions, owner/organization index tables, all required formulas, and a p=7 example. Complete `share_inputs`, `add_public`, and `aggregate`, then submit each checkpoint from the same editor. Every field uses current source; no terminal, separate editor, manual JSON answer or new endpoint is needed.

| Checkpoint | Points | Evidence |
|---|---:|---|
| plan | 35 | Exactly three integer estimates: products, fresh triples and rounds |
| share-inputs | 30 | Supplied random pieces followed by the modular complement |
| linear | 30 | A sharing reconstructing to the original value plus a public constant |
| multiply | 55 | Returned score shares match the plain expression |
| result | 35 | Re-sharing/order invariance and the count-change relation |
| privacy | 40 | Opened values equal the supplied triples' masked differences, counting duplicates |
| cost | 35 | One actual opening batch, 2k values, matching plan |
| transfer | 40 | All four functions under other moduli, counts and inputs |

Wrong submissions cost 15 points. Each checkpoint has three hints: mechanism, small example/formula, then actions using the actual arguments and Portal controls. Existing IDs, points and hint penalties are unchanged.

## Arithmetic and observations

For each organization i and piece-owner j, form differences from `counts[i]`, `severities[i]`, and that organization's `triple_list[i]`. After opening d/e, form `c_j+d*b_j+e*a_j` and add the public d*e term once across owners. This is the expansion of `(a+d)*(b+e)`. Sum product pieces by position and add bias once. The p7 example reconstructs 4 from returned shares [6,5].

Products are independent, so their 2k masked differences can be opened in one call to `io.open_batch`. The cost model counts calls and opened values separately. Opening per product can remain correct and satisfy the opening-value criterion while failing the one-round target. Reusing a triple can remain correct and still open 2k values while exposing a difference of inputs. Privacy and cost therefore have independent verdicts.

Lists and tuples are equivalent ordered sequences for returns and opening inputs, including both levels of share_inputs. Offsets at several owners are valid when their modular sum equals the public constant. Booleans, floating-point values, wrong lengths and noncanonical elements fail the parent checks.

The opening criterion compares the **multiset of reconstructed opened values**: order may differ, but repeated values count with multiplicity. It does not require one particular source layout or attest execution of a function body. Correct arithmetic alternatives, another owner for a public term, and output redistribution with the same total are accepted.

## What the model does and does not protect

All shares are present in one Python program. It can reconstruct its arguments locally. The modeled observer sees the values requested through `io.open_batch`; the checkpoint does not certify all Python information flows, distributed secrecy, side-channel resistance, collusion handling, or real network round trips.

Fresh independent uniform masks unknown to an observer explain the ideal arithmetic argument. Fixture generation is deterministic toy data, not a cryptographic randomness guarantee; zero masks are allowed. Publishing a final score still reveals whatever follows from that score.

The Workbench retains the existing parent-owned seed/tcw1 preparation contract. Hidden fixtures and grading code stay in the unpublished verifier image. On Linux, learner code runs in a separate process with a clean environment, closed inherited descriptors and restrictions on file access and metadata changes, program/network access, process interference, scheduler writes and persistent IPC. The trusted parent validates returned values, receives opening requests, and records every accepted batch itself. Learner counters, monkeypatches and printed verdicts are not grading authority. Fresh request identifiers prevent stale/preprinted replies; they do not attest function execution. Existing 25-second evaluation deadlines remain, with bounded source/output and process-group cleanup. Tini reaps orphaned descendants.

These restrictions are tested for the stated surfaces; they do not defend against an owner of the Docker daemon or replace a hardened multi-tenant execution platform. No seed, hidden input, exception body or reference output is returned in failure feedback. Public initialization diagnostics use validated source filename, line and exception type only.

## Local verification and resources

`make test` runs the public checks against the starter or your local edits; unimplemented starter score functions are expected to fail. `make reference-test` runs the original nine mutation cases and Linux execution/observation regressions in the author image. `make agent-gate` from the repository root validates catalog contracts; it is not runtime proof.

The default Compose entry is `local/docker-compose.yml`, with host-loopback Workbench 18099 and an unpublished verifier on its internal network. Both services run as non-root and use an init process. The dedicated acceptance run used project `ac26-private-aggregate-reader-716`, localhost 18153 and synthetic seed `private-aggregate-reader-716`. See `local/tests/hidden/READER.md` for commands, before/after evidence and the retained real-Portal-components harness.

This local problem creates no AWS resources. Docker CPU, memory, images and containers consume local resources; stop its own Compose project with `make verifier-down` or the exact project-specific down command. Never stop another running project.

## Course evidence

The existing metadata alignment/status pin is retained. It records the earlier course snapshot, not a claim that Week 2 remains unpublished. This revision read the current official `week2/problems/toy-mpc/README.md` and the author's Week 2 notes on additive sharing, fresh Beaver triples, opening choices and communication cost. Exact paths, commits and hashes are recorded in `local/tests/hidden/source-readings.json`. Boolean MPC, OT and a real distributed deployment are outside this arithmetic synthesis problem.
