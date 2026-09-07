# Issue #716 — bridge-experiment reader and runtime evidence

2026-09-06. Work was limited to this problem, starting from Challenge main
`24ac02fc7e7f2e2683dc7ec6d6d5d893fb6a9329` in the dedicated
`codex/bridge-experiment-hints-716` clone. The seven grading IDs and points were retained.

## Sources checked

- Lecture repository at `bdbc913fa7fd4ed87ce7f0de6b1d73fb41e49732`:
  `week1/README.md` and `week1/problems/proof-of-exploit/README.md` — remainder-valued
  signals, a stated condition, and testing a counterexample as well as an honest case.
- Author notes at `58344a29ea39c25839475ba9a594c115ed89989b`:
  `week0/index.html`, sections “mod — 時計の世界”, “零因子 — mod 6 では 2·3 = 0”
  and “逆元 — 掛けて1になる相手”, plus the adjacent formula/result/explanation layout.
- Current Issue #716 and AGENTS.md §12b/§12c/§12d. The placement remains a Week 1
  diagnostic bridge. No course solution, private checker or excluded week0 PDF was copied.

## Independent first reading

The root reviewer read only participant text, hints, starter and public Inspect output
in `/private/tmp/bridge-716-reader/baseline-{ja,en}.md` and `baseline-inspect.txt`.
The first Inspect was an author-local rendering of public `show.py` with a synthetic
practice instance, not yet a live HTTP claim. The reader did not read hidden/reference code.

Real gaps found on that first pass:

1. The statement promised automatic environment submission but Inspect told the reader
   to paste the phrase manually.
2. A long introduction hid the first action and overstated prediction as the only way
   to discover an error, and failure as the only occasion for learning.
3. Recovery needed the forward `final=(start+step*k)%modulus` relation, the inverse
   condition, the allowed range of k and a worked round trip.
4. No inverse means multiple inputs can share an output; it is not the same claim as
   computational difficulty on an elliptic curve.
5. Counting's expanding pair list needed a snapshot and exclusion of its empty `(1,0)`
   selection. Otherwise infinite append or subtracting an entire interval was plausible.
   A table showing how overlaps become one count was missing.
6. “The size tells you nothing” was too broad. Unrestricted lap counts cannot be
   recovered from the final value's size alone.
7. “The numbers change on every startup” conflicted with a stable per-deployment seed.

All were corrected. Re-reading both languages caught two additional precision gaps:
the walkback step must be nonzero **after reduction**, and a shared divisor must be
**greater than 1**. The actual generator guarantees `2 <= step < modulus`; both
languages now state that range and the greater-than-one condition.

An independent code/boundary review found one further Japanese/English mismatch in
the first no-walkback hint: the Japanese version said the walk visits only multiples
of the common divisor, omitting the starting position. With the public example's
`start=9`, `step=15` and constructed `m=30`, the positions are `9 → 24 → 9`,
neither a multiple of 15. Their differences from the start are 0 and 15. The Japanese
hint now explicitly describes positions whose **difference from the start** is a
multiple of that divisor, matching the English “away from its start.” This was a
read-only review finding followed by this wording correction; grading is unchanged.

## Public-only answers and code

The independent reader explained each field's purpose and worked these values by hand:

| Field | Reason and result |
|---|---|
| environment | Check the running environment; submit its returned phrase automatically. |
| predict | Compare a paper prediction with execution: `5 → 1 → 10 → 6 → 2 → 11`. Submit 11. |
| first-broken | Check the range after each step: value 6 is outside ring 6, at position 5. Submit 5. |
| generalize | Apply the same update and list contract to other inputs, including negative steps and zero rounds. |
| walkback | Step 15 has inverse 8 modulo 17; `(16−9)*8=56`, remainder 5. Submit 5. |
| no-walkback | Construct m=30 for step 15; its products have remainders 0 or 15, never 1. Submit 30. |
| count-no-walkback | Count overlapping sets of multiples efficiently; for step 6 and 1..10, `5+3−1=7`. |

After the revised public text, the reader independently wrote both Python functions in
`/private/tmp/bridge-716-reader/reader-counter.py`. The implementation uses repeated
reduction, distinct prime factors, a copied list of `(product,count)` pairs, exclusion
of the empty pair and `F(high)-F(low-1)`. It was submitted unchanged, not replaced with
the author's reference. SHA-256:
`8b20c55ebe24c62497bb2d266f80afa658a45cc41b9a8282de435b9f82e57947`.

## Actual runtime evidence

Dedicated Compose project `bridge-716-20260906`, loopback `127.0.0.1:18143`, synthetic
practice seed. Workbench and unpublished verifier built and became healthy. The real
`/api/inspect` values matched the paper packet; only the host/container Python version
differed. The live JSON is `/private/tmp/bridge-716-reader/live-inspect.json`.

- **29 HTTP checks passed**: all seven independent reader submissions, real public
  tests, exact reader-source preservation through prepare, automatic environment,
  no automatic manual answers, incorrect/manual/out-of-range inputs, alternate valid
  ring 45, wrong implementations, bounded property feedback, slow starter count
  rejection at the timeout, and subsequent health.
- **14 mutations rejected on both host and Linux**, with correct advance and count
  reference acceptance. No grading predicate was relaxed.
- The CLI public suite passed with the independent reader source. A host `/private/tmp`
  file bind failed at OCI mount setup, so the same source was sent via stdin to a
  dedicated temporary container and the existing public test script. No shared mounts
  were changed. `show.py` was also exercised in the running Workbench and now tells
  readers to submit the environment phrase automatically.
- **Three Workbench regressions passed**: a subprocess test confirms the unused seed
  is not copied into public-test code. Two real HTTP tests confirm that all visible
  Workbench process environments, including PID 1 and healthchecks, have no `FLAG_SEED`,
  and prepare supplies exactly the documented automatic fields. The subprocess test
  also passed in Linux.
- **Catalog 116/116 passed**. Hint costs respect both the overall and per-check limits:
  the first hint on each of the first three fields costs 1; the others cost 2, total 39.

The process probe printed only boolean presence, never seed values. This verifies the
Workbench's unused-seed removal, not malicious-code isolation of the verifier. The
existing local honor-system boundary remains; no new network sandbox or common runtime
was introduced. Actual AWS and third-party play remain unrun. This evidence uses the
real participant HTTP API, not a claim that browser clicks in the full Portal were driven.

Logs and replay script:

- `/private/tmp/bridge-716-http-acceptance.py` and `.log`
- `/private/tmp/bridge-716-linux-mutation.log`
- `/private/tmp/bridge-716-live-workbench.log`
- `/private/tmp/bridge-716-linux-workbench.log`
- `/private/tmp/bridge-716-cli-public.log` (mount failure), `bridge-716-cli-public-stdin.log`
- `/private/tmp/bridge-716-cli-inspect.log`
- `/private/tmp/bridge-716-catalog.log`

To run the live regression against your own started project, set
`BRIDGE_WORKBENCH_URL=http://127.0.0.1:18091` and run
`python -m unittest discover -s local/tests/hidden -p test_workbench.py -v` from the
problem directory. The two live tests skip when no URL is supplied.

Cleanup completed: the dedicated project’s two service containers and two networks
were removed; the project-label container listing was empty. Logs:
`/private/tmp/bridge-716-cleanup.log` and `bridge-716-remaining-containers.log`.
No shared project, localhost5657, AWS resource, release or original checkout was changed.

## 2026-09-08 participant-only reread (Issue #716)

An independent reader inspected only Japanese/English participant instructions, hints and the public starter. Hidden tests, reference code and verifier internals were excluded. The first pass found no concrete way to retain and call the slow implementation after editing the only count_no_walkback function. The instructions now say to copy it as count_no_walkback_slow, edit the original name, and place the explained assert comparison for(6,4,9) after both definitions. The reader confirmed that both language versions now connect save, edit, compare and submit, and hand-checked the four matching integers4,6,8,9. This was text/hand-calculation review, not UI submission.
