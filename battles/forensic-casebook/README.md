# Forensic Casebook — Support Every Conclusion

A playable, bilingual post-compromise investigation pack for TenkaCloud's native
coordination host, with a loopback-only local practice adapter. All organizations,
accounts, addresses, timestamps, objects and events are synthetic. This is not a
reconstruction of, or a factual claim about, an actual incident.

## Your role and first useful action

You investigate a suspicious external-export change at fictional Aster. Open
`identity.json`, find its `account` and `session`, and join that session to the
administrative action. Then submit your conclusion **and the smallest sufficient
set of evidence files**. A correct conclusion without its supporting evidence
is not a successful checkpoint. Irrelevant extra citations also fail.

The first three connected cases follow the same incident and authority:

1. **A valid login. An approved change?** Distinguish authentication, technical
   permission, business approval, and what the records establish about a person.
2. **What left, when, and how much?** Normalize clocks, join independent logs,
   distinguish read success from observed outside receipt, reject a mismatched
   content fingerprint, and count overlapping content ranges only once. Keep
   logging gaps as uncertainty instead of declaring them safe.
3. **A backup exists. What proves recovery?** Identify shared administrative
   control, choose an independently administered and tested recovery copy, and
   separate a demonstrated isolated restore from production readiness.

Each of the first three cases has an accessible observation checkpoint (20 points), a comparison
checkpoint (30), and a synthesis checkpoint (50). The original nine total **300 points**; endpoint response adds six checkpoints totaling **100 points** (one restart checkpoint has zero points), for **400 points** overall.
There are no flags or attack endpoints. You do not modify a live service.

## Play locally

Prerequisite: Bun 1.3.11 or a compatible Bun runtime. From this directory:

```sh
make install
make dev
```

Open a complete seat link printed in the terminal. The server binds only
`127.0.0.1:5668`. A seat link contains a newly generated local credential; keep it
private. The UI renders the real `portal/StatusPanel.tsx`, defaults to Japanese,
and has an English language selector. Use the evidence reader, optional JSON
file downloads, answer field, citation checkboxes, and submission button.

Wrong answers retain your input, record an attempt, and provide generic retry
feedback without revealing the expected value. Incorrect answers cost no points.
Each question has three free, sequential hint rungs: mechanism, small worked
example, and a procedure using your actual evidence names. Hints remain readable
after solving. Correct submissions unlock a bilingual explanation. A lost
network response can be retried using the same operation ID without awarding
points twice.

The practice adapter offers a separately confirmed **new practice run**. It
creates a fresh server secret, event identifier, and generation, with new evidence
and zero score for that seat. The other seat is unaffected. Delayed operations
from an old generation are rejected. **Native competition has no reset operation**;
practice points do not contribute to the competition leaderboard. Cases may be
solved in any order; the displayed order is the recommended learning route.

See [the local adapter guide](dev/README.md) for controls and test details.

## Evidence and preservation

Twelve downloadable JSON files are generated from server-only per-match
`matchSecret`, event ID, team ID, generation, and domain-separated labels using
HMAC-SHA-256. HMAC is a keyed derivation: the host's secret prevents public event
identifiers from serving as the fixture seed. No public-seed fallback exists.
Evidence is deterministic within a run and different across teams or fresh runs.

The SHA-256 beside each file is a fingerprint of its exact UTF-8 content,
including the final newline. Downloading and comparing that fingerprint checks
whether these bytes changed. It does **not** prove that the original events were
true or identify the human actor. The case's collection and provenance notes
state what the exercise observations establish and where they stop.

All necessary timestamp arithmetic, byte-range rules, terminology and answer
formats are in the free case introductions, prompts and evidence glossaries.
For example, `12:00+09:00 = 03:00Z`; received ranges `[0,3)` and `[2,5)` cover
five unique bytes. Both a request identifier and its content fingerprint must
match before joining a receipt to a file. No external product knowledge or
cryptographic calculation is assumed.

## Authoritative runtime contract

`coordination/plugin.ts` default-exports a plain structural plugin object with
`initialState`, `validateOp`, `applyOp`, `projectForTeam`, `teamScores`, and
`stateSchemaVersion: 1`. There is no standalone dependency on the platform SDK.
The owning native host must explicitly register this pack; schema-valid runtime
metadata alone is not evidence of platform deployment support. Metadata uses the
native host's established `local / bun` runtime descriptor.

- `initialState({ eventId, teamIds, matchSecret })` requires a 32–128 character
  ASCII secret suitable for a hex/base64 representation and a unique roster of
  1–100 teams. The host generates the secret; a team never supplies it.
- Local practice may call `initialState(ctx, { generation })` to create a fresh
  state. A generation is a positive integer up to 1,000,000.
- Every operation includes `kind`, unique `id`, current `revision`, current
  `generation`, `caseId`, and `questionId`. An answer adds `answer` and
  `evidenceIds`; a hint adds `rung` (1, 2, or 3). Extra fields are rejected.
- `validateOp(state, authenticatedTeamId, op)` returns `{ ok: true }` or
  `{ ok: false, error }`. A wrong conclusion is a valid operation, reflected as
  `lastResult.status = "incorrect"` after `applyOp`; malformed or stale requests
  do not mutate state. The authenticated team is supplied by the host, never
  trusted from an operation body.
- `applyOp` is immutable and rejects invalid operations even if the caller skips
  validation. Each accepted new operation advances that team's revision. A
  checkpoint pays once. Hints never change the score.
- The last 64 operation IDs and digests are retained per team. An exact replay is
  a no-op; reusing its ID with different content fails. An evicted old operation
  remains stale by revision. Generation is checked before replay receipts.
- `projectForTeam` explicitly selects public fields. It never returns state,
  secrets, expected values, citation predicates, operation receipts, or another
  team's evidence. Explanations appear only for solved checkpoints; unopened
  hints are not projected. Unknown teams fail closed.
- `teamScores` returns absolute authoritative scores for the host leaderboard.
  There is no uptime target, automatic starting score, time bonus, or hidden
  penalty. Equal scores remain ties unless the host's documented event rules
  provide another ordering. Event start/stop is the host's responsibility.

Operations cap answers at 512 characters, citations at four unique file IDs,
IDs at 64 characters, and each team's accepted operations at 1,000,000. The server
stores only secret/context and compact team progress; evidence is regenerated,
not copied into each saved team state. A saturated serialization test bounds the
declared budget of 2,048 base bytes plus 16,384 bytes per team, below 2 MiB at the
100-team maximum. Durable persistence, authentication, event lifecycle, and
concurrent compare-and-swap are host responsibilities, not claims about the
in-memory practice adapter.

## Verification

```sh
make test              # game authority plus practice HTTP boundary
make typecheck
make browser-test      # real Portal component; participant-visible evidence only
# If Chromium is not already installed:
bunx playwright-core install chromium
# Or point BROWSER at an existing Chromium binary.
```

The game suite solves the original nine and six endpoint checkpoints from public evidence over eight
generations, requires the correct citation sets, rejects overclaiming and
mismatched/overlapping evidence shortcuts, verifies secret/team/event isolation,
checks strict operation validation, JSON persistence, replay behavior,
post-success hints, old-generation rejection, no competitive reset, and the
worst-case state budget. Browser and HTTP suites belong to the local adapter;
the browser covers both languages, all questions, downloads, wrong/retry,
lost-response replay, hints, seat isolation, confirmed reset, and a narrow
viewport. These are local rehearsals, not an independent third-party playtest.

Local verification (2026-10-09): typecheck, game/HTTP/endpoint suites and catalog
agent-gate passed. Existing Chrome exercised the real Portal component in JA and
EN, all 15 checkpoints, downloads and fingerprints, wrong-answer recovery,
lost-response retry, two-seat isolation, confirmed reset and 390px layout.
Screenshots are generated under `dev/evidence/endpoint-ja.png` and `endpoint-en.png`.
Real OS/cloud behavior, long-term observation and third-party playtesting were not run.

From the repository root, also run `make install && make agent-gate`. Catalog
validation proves catalog contracts only. The coordinated native-host change
must run its own registry, HTTP persistence, and browser integration tests.
Neither a live AWS event nor a cloud deployment is performed by this pack's tests.

## Components, cost, safety, and teardown

- `game/`: server-only evidence generator, grading predicates and pure reducer
- `coordination/`: native host plugin entry
- `portal/`: participant component; only public projection types cross this edge
- `dev/`: authenticated loopback practice server and application wrapper
- `tests/`: game, HTTP and participant-route verification

No EC2, S3, database service, external network destination, or other cloud
resource is provisioned. Region is not applicable. A session is intended for
90–120 minutes. Local CPU, memory and optional browser installation disk space are
used; an independently deployed host may have its own existing service costs.
Stop the practice process with Ctrl-C to remove its in-memory runs and credentials.
Generated screenshots under `dev/evidence/` can be deleted. No resource in this
pack continues cloud billing after local shutdown. Do not publish practice seat
credentials, server state, or test/operator-only materials as participant assets.

## Endpoint response and compatibility

Case 04, **The deleted updater returns**, adds ordered diagnosis, pre-change
custody of original content and SHA-256, targeted containment, approved-updater
recovery, simulated restart and assessment. File-only deletion, normal-object
removal, global traffic blocking, insufficient citations and skipped steps fail
without advancing simulated response state. Incorrect attempts remain recorded.
Restart itself awards zero; evidence-supported absence of recurrence and normal
update success earns the final 30 points. An unobserved helper stays unknown.
One simulated restart does not establish real eradication or long-term safety.
Team points never certify an individual. No malware, OS settings, credentials or
external communication are used.

State schema is now 2. The native host requires a migration hook for versions
above 1; `migrateState` explicitly refuses to rebuild or expand an in-progress
v1 event. Existing events continue with their pinned v1 bundle; start a new event
for v2 (400 maximum points). No new catalog entry or main-repository source change
is needed. Full main-host HTTP persistence, deployment and live-event operation
were not exercised for this edition.
