# Verification evidence — 2026-10-07

Catalog base: TenkaCloudChallenge `aeacd121`. Read-only host reference: TenkaCloud `05ffed84`. Original user checkout modifications were preserved by cloning committed state separately and creating branch/worktree `feat/session-defense-arena`.

| Check | Observed result |
| --- | --- |
| `make test typecheck` | 37 tests, 480 assertions (includes the independent suite) pass; TypeScript passes |
| Per-match/state bounds | 50 accepted operations in a full four-round trace; maximum measured serialized state 13,169 bytes; JSON restore preserves receipts and scores |
| Authoring root `make install && make agent-gate` | All existing 126 metadata definitions pass; this underscore prototype has no catalog registration |
| `make browser-test` | Two fresh independent browser contexts drove the actual Portal component through visible inputs only; 4 rounds, response-loss/same-op retry, reload, damage assets, scores 95–272, final replay, English, no page errors, 390px without horizontal overflow |
| Real host core smoke | createMatch/transitionMatch accepted the same plugin; 4 rounds, scores/deltas 170–170, JSON roundtrip, replay delta 0 |
| Real host catalog smoke | hostBrowserProblemPaths read 109 existing host-compatible entries and safely excluded `_session-defense` |
| Independent security agent | Independent 18 tests / 63 assertions pass (retained as tests/independent-security.test.ts), including authentication/authorization boundaries and the delayed timeout regression; no remaining lab-scope blocker; final report in SECURITY.md |

The browser response-loss case first executes a UI operation, drops the response, then clicks the UI's identical retry. It checks that one 40-point baseline change is present, not two. Browser tests never choose a different team through a query parameter, read state directly, or call undocumented exercise actions. Synthetic seat keys come from their dedicated test harness, not a real browser profile.

The captured images were visually inspected: [reused evidence](evidence/baseline-reuse.png), [390px defense view](evidence/defense-mobile.png), [final replay](evidence/final-replay.png). They show disposable exercise tokens only; no host secret or seat key is visible. CI runs the same unit/type/browser tests and uploads its images. A future CI result is not asserted here before its run completes.

Not run: host organizer/participant HTTP login, official portal registration, SQLite stop/restart, live cloud/AWS, independent human playtest. Pure JSON restore and real core compatibility are narrower evidence than those integration tests. No merge, deployment, paid action or OS network change was performed.
