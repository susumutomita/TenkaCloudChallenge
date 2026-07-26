# StackStack base app

One small message-board web app, shared by every problem in the StackStack
family. It is not a problem itself — it has no `metadata.json` and never appears
in the catalog. It is the workload the StackStack problems act on.

## Why it is shared

The StackStack Challenges each teach one step of taking an AI-generated app to
production: build it, ship it, expose it safely, fix its secrets and
permissions, observe it, defend it, recover it. Those steps only add up if they
happen to *the same application*. A participant who learns where this board
keeps its config, its log, and its posture in the onboarding problem still knows
it three problems later, and the integrated StackStack Battle replays the same
moves against the same surface on AWS.

## Layout

```
stackstack-base/
├── Dockerfile          the shared image (node:22-alpine, no dependencies)
└── app/
    ├── server.mjs      the two HTTP surfaces: the board (:8080) and /verify (:8081)
    ├── board.mjs       posts, and the seeded/participant distinction checkpoints rely on
    ├── config.mjs      the participant-owned config file, re-read on every request
    ├── log.mjs         the bounded app log served by GET /api/logs
    ├── posture.mjs     measured state — never self-reported
    ├── secrets.mjs     every unguessable value, derived from FLAG_SEED
    └── scenarios/      one module per problem: seed posts, gates, checkpoint handlers
```

## How a problem uses it

The problem's `local/docker-compose.yml` builds this directory and selects a
scenario:

```yaml
services:
  stackstack-onboarding:
    build:
      context: ../../../stackstack-base
      dockerfile: Dockerfile
    environment:
      SCENARIO: onboarding
      CONFIG_HINT: problems/challenges/stackstack-onboarding/local/config/app.json
      FLAG_SEED: "${FLAG_SEED:-local-dev-seed}"
    volumes:
      - ./config:/app/config:ro
    ports:
      - "127.0.0.1:18080:8080"
      - "127.0.0.1:18081:8081"
```

The relative build context resolves against the problem's `local/` directory,
which the platform's local runner pins with `--project-directory` even when it
remaps host ports — so the same compose file works whether the problem is
started first or fifth.

## The scenario contract

A scenario module exports three things, all optional:

| export             | shape                                                | meaning                                                       |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------- |
| `seedPosts`        | `{ author, title, body, at }[]`                       | posts the board ships with; marked `seeded` so a checkpoint can tell them from a participant's |
| `gates`            | `Record<string, (context) => boolean>`                | the posture gates, as pure predicates over measured state      |
| `checks`           | `Record<string, (submission) => boolean \| Promise>`   | one handler per `scoring.checks[].id` in the problem's metadata |
| `routes`           | `Record<"METHOD /path", (request, response, url) => …>` | the surface this problem adds to the board                     |
| `gateTokens`       | `true`                                                | opt in to a per-gate receipt on `/posture` (see below)         |
| `postureContext`   | `() => object`                                        | scenario-owned state to expose to its own gate predicates      |

### Routes

A scenario declares its own surface rather than this module growing a branch per
problem — at which point the shared board would be a platform and no longer
shared in any useful sense. Scenario routes are dispatched and observed exactly
like the board's own, and redeclaring one of the board's routes is a boot
failure: a scenario silently shadowing `GET /healthz` would be found by whoever
debugged it next, which is the wrong person at the wrong time.

### Gate receipts

Onboarding's answers are displayed on the board and in the log on purpose. Every
later problem grades *behaviour* — "the endpoint returns what the spec says" has
no answer written anywhere — so the app has to be the thing that says it
happened. With `gateTokens: true`, `/posture` carries a `tokens` map alongside
`gates`, and a gate's token appears only while that gate is true. The submission
is then a receipt for measured behaviour rather than a claim.

Receipts are derived from a secret generated at boot, **not** from `FLAG_SEED`.
`FLAG_SEED` arrives in the environment, and on Linux `/proc/self/environ` keeps
the exec-time copy no matter what is deleted from `process.env` — so anything
derived from it is forgeable by participant code running inside the app, which
later problems in this family do on purpose. The values a participant is *meant*
to read stay seed-derived; a receipt asserting the app observed something does
not. The cost is that receipts change across a restart, which is correct: a
receipt is evidence about one run.

`context` carries `observed` (the set of routes the app has served, e.g.
`"GET /api/logs"` — only routes the app really serves are recorded, so an
unknown path cannot grow it), `config` / `configOk` (the config file as it is on
disk right now), and `participantPosts`.

`CONFIG_HINT` is display only: it is the path of the config file *in the
participant's checkout*, which the app itself never sees (it reads the mounted
`/app/config/app.json`). Setting it keeps the board from telling a participant
to open a path that does not exist on their machine.

It carries the `problems/` prefix because a participant runs `make local` from
the **platform** repository, where this catalog is mounted as the `problems/`
submodule. The path a problem author uses inside this repository is the same one
without that prefix.

Two rules hold for every scenario:

- **The answer never leaves the container.** Values a checkpoint compares
  against are derived from `FLAG_SEED` in `secrets.mjs`, so nothing is committed
  and no two deploys share an answer.
- **Ground truth lives outside the submission.** A checkpoint asks the running
  app what is true and compares that; it does not take the participant's word
  for it. `GET /posture` withholds its `readyToken` until every gate is green,
  and each gate receipt until that gate is true, for the same reason.
- **An app that is unwell says so.** An uncaught fault is logged, counted, and
  reported on `/healthz`, which answers `503` while any fault is outstanding.
  Surviving a fault is right for a training container; answering "ok" afterwards
  would be hiding one.

## Running it outside a container

`server.mjs` uses only `node:http` and `node:crypto`, so it runs under Node 22
in the image and under Bun in CI. That is what lets each problem's test suite
drive the real app over real HTTP instead of asserting on its source text:

```bash
# from the root of this catalog repository
CHALLENGE_PORT=18190 VERIFY_PORT=18191 \
  APP_CONFIG=challenges/stackstack-onboarding/local/config/app.json \
  SCENARIO=onboarding FLAG_SEED=demo \
  bun stackstack-base/app/server.mjs
```
