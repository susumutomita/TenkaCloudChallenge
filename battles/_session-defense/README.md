# Session Defense Arena — local two-player prototype

Players alternate attacking and defending a fictional ad desk. Try supplied lab evidence, observe changes to dummy admins/customer links/budget, select defenses, then retest the same operations. Four rounds award points for damage and cost-effective defense. This does not reconstruct a real incident: its entry path is unknown.

**Registration in the TenkaCloud host is unfinished.** This uses the existing coordination hook shape and real Portal slot component, but has not passed through host authentication, SQLite restart recovery or the official scoreboard. See [the required integration changes](docs/INTEGRATION.ja.md).

## Run

With Bun 1.3.11, from this directory:

```sh
make install
make dev
```

Open the separate **alpha / bravo URLs** printed in the terminal using two fresh browser environments. Their `#seat=dev_seat_…` fragments are disposable harness seat keys. Never input real credentials. Both players choose Ready. The attacker copies supplied lab evidence, tries a management operation, then hands over. The defender chooses controls costing at most 6. During retesting, the attacker tries operations and the defender checks legitimate work.

Each phase lasts 75 seconds, with four attack attempts in baseline and retest. Attack points equal retest damage. Defense points are `max(0, 100 − damage − cost×3 − 20 if legitimate work was not checked)`. The first two rounds supply pre-defense evidence; the last two also supply evidence issued after defense. Startup, waiting, baseline moves and free clues award zero. Compare accumulated scores and the final replay.

Controls cover revocation, 15-second expiry, fresh owner authorization, separate reviewer approval and reduced everyday privileges. Initial login strength and HttpOnly are simulated comparison controls. HttpOnly prevents page programs reading cookies; it does not stop reuse of already supplied evidence or every device compromise. Budget units measure fictional operational burden, not product pricing or real financial harm.

For English use `?lang=en#seat=…`. The server binds only to 127.0.0.1:5666. An alternative is `PORT=5667 make dev`. Ctrl-C stops the lab; restarting discards its state and seat keys. No AWS, Docker, billable resources, Region or external sending is involved, so no cloud teardown is required.

## Authentication and simulation boundary

Exercise evidence (`lab_session_…`), harness seats (`dev_seat_…`) and operation grants (`lab_grant_…`) are separate. Exercise evidence cannot authenticate a harness API request. The server derives evidence from a per-match secret and checks session identity, owner, round, revocation, expiry and role. Grants bind session/action/round/expiry/issuer and are consumed once on success. Inputs such as `verified=true` are rejected.

Passkeys, a second-device owner check and independent reviewer login are **simulated, not implemented**. The defender's dedicated trusted seat models an owner channel issuing grants only for legitimate actions. A distinct reviewer principal is modeled in server state. Checking legitimate work performs spending and, when approval is selected, also tests a reviewed admin change. Role restrictions still deny admin changes. A real application needs independently authenticated reviewers and transaction confirmation. Compromise of both principals, mistaken approval and interactive control of an authenticated device are outside this model's guarantees.

There is no access to real browser profiles/cookies, OS credential stores, Google/Microsoft authentication, production accounts, phishing, malware, arbitrary URL targets or OS network settings. Only this lab process's dummy data is affected.

## Verify

```sh
make test typecheck
make browser-test
# Read-only hook compatibility check against a prepared host checkout:
TENKA_ROOT=/path/to/TenkaCloud bun tests/platform-smoke.ts
# At catalog root:
make install
make agent-gate
```

Browser tests need dedicated Playwright Chromium: prepare it with `bun node_modules/playwright-core/cli.js install chromium`, or use `BROWSER=/path/to/dedicated/chromium make browser-test`. Tests create fresh ephemeral environments and use visible UI inputs. Browser bundles exclude the server's state/scoring implementation.

See [evidence](docs/EVIDENCE.md), [security review](docs/SECURITY.md) and [design](docs/DESIGN.ja.md). Host registration, SQLite restart recovery, organizer UI, independent human playtesting and cloud hosting remain unverified. JSON state recovery and compatibility with the real host core were exercised.
