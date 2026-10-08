# Local practice rehearsal

This harness renders the real `portal/StatusPanel.tsx` and invokes the real
`coordination/plugin.ts`. It runs on `127.0.0.1` only. All case records are
synthetic. Local points are practice progress, not official competition scores.

From `battles/forensic-casebook`:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run dev
```

Open one of the complete generated seat links printed in the terminal. Each
link contains that seat's random credential in a URL fragment. Treat it as a
local credential; do not publish it. No credentials or answer keys are included
in the JavaScript bundle. Use another seat link in a separate tab/context for an
independent exercise. A new server process creates fresh seats and evidence.

The UI defaults to Japanese; the language selector also supports English.
Choose a case, open its evidence files, optionally download them, enter your
conclusion, select the minimum sufficient supporting files, then check it.
Incorrect answers retain your input for another attempt. An uncertain network
result offers an exact-ID retry without duplicating progress. Every question has
three free sequential hints and a post-success explanation.

“Start a new practice run” requires a separate explicit confirmation. It clears
only the current seat and generates fresh evidence. The native competition
plugin has no participant reset operation. Practice reset is intentionally part
of this local adapter only, never a competitive operation.

## Verification

```sh
bun run typecheck
bun test tests game
bunx playwright-core install chromium
bun run test:browser
```

The browser script uses installed Playwright Chromium by default, or
`/usr/bin/chromium` when present. Set `BROWSER=/absolute/path/to/chromium` to
select an existing installation. It drives visible UI controls and derives
answers from rendered evidence only. It exercises all nine questions in both
languages, incorrect answers, a deliberately lost successful response with the
same operation retry, all three hint rungs, downloads and SHA-256 hashes,
separate authenticated seats, confirmed reset, and a 390-pixel viewport.
Screenshots are written under `dev/evidence/`.

The HTTP suite verifies generated bearer authentication, Host/Origin checking,
bounded JSON, strict route allowlisting, no source/answer-key exposure,
idempotency, seat separation, and reset confirmation. This local adapter is not
proof of production authentication, durable storage, deployment, or official
rankings. Native host verification is a separate rehearsal.

## Execution note (2026-10-08)

Frozen dependency installation, TypeScript checking, and the game/HTTP suites
passed in the authoring cloud. Chromium could not start there: its local IPC
socket creation was blocked by the environment, including an approved elevated
retry. The separate cloud browser could not access the loopback host either.
Therefore a successful local browser playthrough is not claimed from that
environment. The authored browser rehearsal must pass in the problem's CI job
before browser playability or screenshot results are reported as verified.
