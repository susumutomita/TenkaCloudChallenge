# Verification evidence

Executed locally on 2026-10-07 with Bun 1.3.11 and dedicated Playwright Chromium. No real credentials, external targets, deployment or outreach were used.

| Route | Observed evidence |
| --- | --- |
| Problem `make install`, `make test typecheck` | 8 tests, 81 assertions: typed expression evaluation and rejection of execution/calls/oversized input; actual dummy changes; code repairs across four rounds; delegation; malicious shortcuts; historical detection; exact retries; zero idle score; 82-receipt maximum complete trace within the declared 131072-byte state envelope; private projection and browser-bundle boundary; harness authentication/origin/body checks |
| Catalog `make install agent-gate` | All 129 metadata records valid, including bilingual READMEs and native cross-references |
| Shared `bun test scripts/native-coordination.test.ts` | 3 tests, 14 assertions: native schema, legacy contracts and invalid authority/slot/entry rejection |
| Problem `make browser-test` | Two isolated browser contexts, participant-visible controls only: reproduce a dummy leak, observe a failed public test, edit expressions, improve, play all four rounds, delegated read succeeds while edit is denied; response-loss retry sends identical content; JA/EN; 390px repair screen; 200–200 final score; no page errors |
| Companion native host HTTP | 15 tests, 3173 assertions covering existing games and the new game: two-seat admission, browser allowlist, foreign/stale runId rejected before tick/receipt access, persistence and exact retry; existing Pi Siege negative-score regression stays passing |
| Companion native host browser | Organizer selects this Battle; two real host logins; code repair and four rounds through visible Portal controls; operation envelopes contain runId; lost response retried byte-for-byte; separate host process restarts on the same SQLite directory and restores score/history; JA/EN and 390px; official 200–200 ranking and +100 score events |

The browser harness derives its implementation from the displayed development rules. It does not call the reducer, read match state/fixture seeds or use a hidden answer endpoint. Tests contain operator reference expressions but are excluded from browser bundles. Author read-through covers entry action, definitions, feedback and clue rungs. These checks are not an independent human playtest or measured learning outcome.

Problem screenshots: [repair with an observed failure on mobile](evidence/repair-mobile-ja.png), [Japanese replay](evidence/replay-ja.png), [English replay](evidence/replay-en.png). Native-host screenshots are retained in the companion repository under `.tenkacloud/host-ui-review/tenant-boundary-duel/` and uploaded by its browser CI.

The companion body PR runs `make before-commit` and the host browser CI. On macOS the existing temporary-directory test compares an alias with a canonical path; its full gate is run with `TMPDIR=/private/tmp`. This changes the test's owned temporary location, not its assertions or cleanup protections. Linux CI uses its normal canonical temporary root.

Not run: third-party human playtest, real AWS/IdP, external organization deployment, and live instructor pilot. These are optional pre-event rehearsals, not assertions of shipped behavior. OAuth, cryptographic grant issuance, asynchronous export, cache/storage enforcement and grant-revocation races are outside this problem's runtime. Clearing the game does not guarantee organizational safety.
