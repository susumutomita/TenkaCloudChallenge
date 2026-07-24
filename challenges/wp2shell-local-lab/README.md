# The Dry Run — Reproduce the Chain, Then Prove the Fix Holds

> TenkaCloud Challenge · `challenges/wp2shell-local-lab` · difficulty 4 · ~90 min · `multi-verify` scoring (8 checkpoints, 300 pts)

The **safe rehearsal** half of a training pair with
[`wp2shell-friday-night-patch`](../wp2shell-friday-night-patch/) (the live AWS incident).
A security vendor's advisory describes a chain between a WordPress-like REST API's batch
(bundling) route resolution and how it builds a data query — the kind of bug class behind
real disclosed WordPress incidents. Before anyone touches production, the CTO wants it
reproduced end to end, safely, in a disposable one-container lab: attack it yourself, then
fix it yourself, then prove the fix survives a replay.

**Everything here is a from-scratch simulator.** This is not WordPress, does not vendor or
adapt any WordPress code, and is not a copy of any specific CVE's exact mechanics — it
teaches the *shape* of the bug class (an unauthenticated path through a batch dispatcher
into a query-construction flaw) with about 300 lines of original Node.js. See "Safety
boundary" below for exactly how that is enforced and machine-checked.

## The two stages

| | Stage 1 — attack | Stage 2 — defend |
| --- | --- | --- |
| Starting point | Unauthenticated | Holding the SRE console token |
| What you do | Chain the batch-routing confusion into the query flaw to pull two passphrases | Fix both root causes, clean up the aftermath, rotate keys, then replay the attack and confirm it now fails |
| Proof | A string you found | The **live app state**, re-probed — never a submitted trivia value |

**Order matters.** Do stage 1 completely before you start stage 2: fixing the routing bug
closes the only path to the stage-1 passphrases. There is no way to "cheat" the order —
the mechanics enforce it for you.

## Checkpoints (multi-verify)

| Checkpoint | What it proves | Points |
| --- | --- | ---: |
| `chain-discovery` | You reached the internal-only report through the batch-routing confusion, unauthenticated. | 35 |
| `compromise-proof` | You chained that into the SQL flaw and read a row out of the vault table. | 45 |
| `fix-route` | The batch dispatcher's permission check is unified with the single-request path (re-tested live, two payload variants). | 40 |
| `fix-query` | The report query is parameterized + category-allow-listed (re-tested live, not just a config flag read). | 40 |
| `cleanup-persistence` | The pre-seeded rogue admin **and** persistence marker are both gone. | 35 |
| `rotate-secrets` | The signing key was actually rotated — the old SRE token no longer authenticates. | 35 |
| `replay-blocked` | The **exact original attack**, replayed end to end, now fails. | 40 |
| `site-healthy` | The index, the normal post feed, and a legitimate token-authenticated request all still return 200. | 30 |

`fix-route` and `fix-query` are graded independently on purpose: closing only the routing
bug already breaks the specific replay in this lab (the entry point is gone), but the
query still concatenates strings — the design bar this catalog holds itself to explicitly
forbids a superficial URI-only block or config-flag-only fix from earning full remediation
credit, so `fix-query` never passes on the route fix alone, no matter what `replay-blocked`
says.

## What gets deployed

One Docker container, two loopback ports, no database process (an in-memory SQLite lives
inside the app), no other services:

| Where | What |
| --- | --- |
| **Your machine (Docker)** | One Node.js process — the simulator + its own scorer |
| `127.0.0.1:18080` | Challenge surface (the mock REST API) + the SRE console (`/admin/*`) |
| `127.0.0.1:18081` | Loopback `/verify` the TenkaCloud scorer delegates to |

## Safety boundary (read this before you start)

This is the part of the issue this problem ships against, and it is enforced two ways —
by construction, and by an automated test that fails the build if either guarantee ever
regresses (`scripts/wp2shell-local-lab.test.ts`):

- **No shell, no command execution, ever.** `local/app/server.mjs` never calls
  `child_process`, `exec`, `execSync`, `spawn`, or `eval` — the test asserts none of those
  identifiers appear anywhere in the shipped source.
- **No outbound network, structurally, not by policy.** `local/docker-compose.yml` attaches
  the app to a compose network declared `internal: true` — Docker gives that network *no
  route* to the internet or the host's external interface at all. It is not a firewall rule
  that could be misconfigured; there is nowhere for an outbound packet to go. The test
  asserts the network declaration is present and that the service is not attached to any
  other network.
- **Loopback only.** Both published ports are bound to `127.0.0.1`; the test asserts every
  `ports:` entry carries that prefix and that neither `privileged: true`, `cap_add`, nor a
  Docker-socket bind mount is present.
- **No reusable real-world payload.** The vulnerable routes, table names, and payload
  shapes are original to this simulator. Nothing here is a working exploit against a real
  WordPress site.
- **The attack never leaves your own container.** Both the exploit in stage 1 and the
  replay-verification in stage 2 talk only to `127.0.0.1:8080` inside the same box.

## Steps

1. `make local PROBLEM=wp2shell-local-lab` starts the stack, the scoring API, and the
   portal.
2. Log in to the portal with any non-empty key.
3. `docker compose logs wp2shell-local-lab` for the SRE console token (you will need it
   for stage 2 — write it down now).
4. **Stage 1**: `curl http://127.0.0.1:18080/wp-json/` to see the namespaces, then work out
   how a bundled (batch) request can reach the internal-only report unauthenticated, and
   how the report's category filter can be turned into a data leak. Submit both
   passphrases.
5. **Stage 2**: using the SRE token, flip both root-cause settings, clean up the
   pre-planted rogue admin and persistence marker, rotate the signing key, then replay the
   stage-1 attack and confirm it is rejected. Re-submit any trigger (e.g. `done`) per
   checkpoint to re-score — state checkpoints have no wrong-answer penalty, so re-check as
   often as you like.

## The root cause (why each fix is real, not cosmetic)

- **Route confusion**: the batch dispatcher resolved the *handler* using a normalized path
  but checked *permission* using the raw path — so a sub-request with a trailing slash
  missed the permission table and fell back to "public" (fail-open). The fix unifies both
  lookups onto the same normalization, not a denylist of "one bad string".
- **Query construction**: the category filter was concatenated straight into SQL. The fix
  is a parameterized statement **plus** a category allow-list — either alone is weaker than
  both together.
- **Persistence & credentials**: root-cause fixes do not retroactively clean up what an
  earlier compromise left behind. The rogue admin and the persistence marker need their
  own remediation step, and the signing key needs rotating so a leaked token stops working
  — cleanup is not the same task as the fix.

## Learning goals

- Reproduce, hands-on, how mismatched path normalization between a REST batch route and
  its single-request counterpart lets a request slip past a permission check.
- Feel how much a string-concatenated query adds once it is chained behind a routing
  loophole.
- Learn that remediation is judged by replaying the live attack and checking real
  state — never by a submitted string or a settings value taken at face value.

## Cost

Local Docker only. No AWS resources are created (free). The image is `node:22-alpine`;
first run pulls it.

## Related files

- `local/docker-compose.yml` — the single-container stack, `internal: true` network,
  loopback-only ports.
- `local/Dockerfile` — `node:22-alpine`, no extra packages.
- `local/app/server.mjs` — the whole simulator: the mock REST surface, the batch-routing
  bug, the SQL flaw, the SRE console, and the multi-verify scorer, in one file.
- `metadata.json` — catalog entry, eight-checkpoint scoring, per-checkpoint hints.
- `scripts/wp2shell-local-lab.test.ts` (repo root) — asserts the safety boundary (no
  exec/eval, loopback-only, `internal: true` network) and the scoring/template
  cross-references.
