# Verification evidence — 2026-10-07

Catalog base: TenkaCloudChallenge `aeacd121`. Read-only host reference: TenkaCloud `05ffed84`. The original user checkouts are unchanged. The initial `_session-defense` prototype remains in Draft PR901; this follow-up uses branch `feat/session-defense-native` and canonical `battles/session-defense`.

| Check | Observed result |
| --- | --- |
| Canonical-path `make test typecheck` | 39 tests / 92,264 assertions pass, including the independent suite; TypeScript passes |
| Two-team capacity | All 74 legal defense combinations × 4 complete routes = 296 matches. Maximum-length host IDs/names/request IDs; every transition measured and JSON-restored. Peak 27,065 bytes within declared 32,768 bytes. 50 receipts normally; 46 with contest timeout |
| Native metadata candidate | Passes schema plus `checkNativeCoordinationRefs` against the π-owned shared candidate `77c6919d`, read without editing its checkout |
| Own root `make agent-gate` before shared integration | Blocked: old schema requires one exposed port and rejects native empty `exposedPorts`; 1 of 127 metadata fails. Shared files were deliberately not edited; this is a linked-PR dependency |
| Canonical-path `make browser-test` | Two fresh independent contexts drive the real Portal component through visible inputs only: 4 rounds, response-loss/same-op retry, reload, dummy assets, scores 95–272, replay, EN, no page errors, 390px without overflow |
| Real host core smoke | Same plugin through createMatch/transitionMatch: 4 rounds, 170–170 deltas, JSON roundtrip, replay delta 0 |
| Old host catalog smoke | 109 supported entries load safely; `session-defense` is not in the old host's reviewed allowlist. This is an explicit missing integration, not an exclusion claimed as completion |
| Independent security agent | 18 independent tests / 63 assertions retained in tests/independent-security.test.ts; no remaining lab-scope blocker. See SECURITY.md |

The browser response-loss case executes a UI operation, drops its response, then clicks the identical retry. One 40-point baseline change is present. Tests use only participant-visible controls; they do not read private state or operate real browser profiles. Disposable synthetic seat keys come from the test harness.

The updated images were visually inspected: [reused evidence](evidence/baseline-reuse.png), [390px defense](evidence/defense-mobile.png), [final replay](evidence/final-replay.png). They show exercise tokens only, no host secret or seat key. Dedicated CI performs the unit/type/browser suite and uploads images; its result is reported only after completion.

DBSC descriptions in Japanese/English UI and docs distinguish renewal protection on another device from activity on the original device. DBSC, device compromise, cookie reading, real passkeys and independently authenticated reviewers are not implemented.

Still pending: coordinated host/catalog SHA, host organizer/participant login, official score/history, SQLite normal-stop/restart, event locks and roster regression. These require the shared owner's integration worktree. No live AWS/cloud deployment or independent human playtest was run. No merge, deployment, paid action or OS network change occurred.
