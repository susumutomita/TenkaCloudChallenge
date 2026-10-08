# Tenant Boundary Duel

An independent two-team, four-round security game: reproduce cross-tenant notebook access with a synthetic authenticated reader, observe action logs and document changes, implement authorization and detection expressions, improve failures with public tests, then retest against an opponent and unseen data.

Session Defense Arena teaches budgeted control selection. This game complements it with implementation of identity/resource/role relationships. Strengthening login alone does not enforce document ownership. It is not an official course, certification, copied exercise or past examination question.

## Run and participant route

Use Bun 1.3.11 in this directory:

```sh
make install
make dev
```

Open the alpha and bravo URLs in two fresh browser contexts. Both press Ready. The attacker selects Orange notebook and presses Read, compares `allowed`, tenant names and the read count, then hands over evidence. The defender reads the visible rules, grammar and three free clue rungs, edits both expressions, observes Public tests failures and improves before deployment. The attacker retests; the defender rechecks work, boundaries and detection. Swap roles. Later rounds add read-only delegation.

Expressions are bounded function bodies using `== != && || ! ()`, strings, booleans and named inputs. No loops, calls, assignment or JavaScript execution. Limits: 1024 characters, 128 tokens, depth 16. All required rules and grammar are free on screen. The same expression faces unseen tenants, roles, inactive actors, grants and forged client claims.

Public tests are limited to eight per round. Each phase lasts 180 seconds with four attack tickets in baseline and retest. Startup, waiting, baseline and public tests award zero. An unauthorized document/action pair allowed in retest earns 25 attack points once, up to 100. Defense points are `floor(40×safety rate + 40×work rate + 20×detection rate) − damage`, minimum zero. Defense requires a baseline attempt, deployed expressions, completed attacker retest and explicit recheck. Highest total wins; ties draw. Waiting until timeout alone earns no defense score.

Use `?lang=en#seat=…` for English. The dev harness binds only 127.0.0.1:5678; use `PORT=5679 make dev` for another port. Ctrl-C stops it. Harness state and seat keys disappear on restart. The integrated native host provides organizer selection, authenticated seats, SQLite persistence and official score history; these are separate evidence paths.

## Verification and integration

```sh
make test typecheck
make browser-test
# Catalog root
make install agent-gate
```

Install dedicated Playwright Chromium with `bun node_modules/playwright-core/cli.js install --only-shell chromium`, or use `BROWSER=/path/to/dedicated/chromium make browser-test`. Never use a normal profile. The companion TenkaCloud PR explicitly registers the game and allows only its Portal component and CSS in the browser. Coordination, grading, unseen cases and reference answers remain server-side.

[Instructor guide, scoring and pre/post assessment](docs/INSTRUCTOR.md), [public-theme alignment](docs/ALIGNMENT.md), [verification evidence](docs/EVIDENCE.md). Catalog changes stack on catalog PR902 and native host changes on body PR3340. Both dependencies remain unmerged; this PR alone cannot introduce the feature to main.

## Safety, limits and resources

Synthetic notebooks and local operations only. No real Google/Microsoft/enterprise environment, credentials, personal data, malware or arbitrary-target traffic. Harness seat keys are separate from game input. Server state fixes identity, role and grants, and derives document IDs and unseen tenant names from a host-generated match secret. Participant code is never executed with host authority.

The server models a person/document/read-action grant limited to the current round through `grant.valid`. OAuth/OIDC, cryptographic grant signing and a grant-issuance interface are not implemented. Neither are cache isolation, list APIs, asynchronous export, revocation races or authorization in database queries. The debrief asks learners to transfer the relationship to these surfaces. Passing this model does not guarantee organizational safety. An independent human playtest is an optional pre-event rehearsal.

No AWS, Docker, billable cloud resources or Region setting. Resources are local machine time and disk storage. Stop the host and remove its owned saved event data for cleanup. No cloud teardown or deployment is necessary.
