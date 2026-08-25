# db-challenge-blocked-transaction — A payout write never comes back

A self-contained **local-play** Challenge for TenkaCloud's Database Track
(Phase 1, Chapter 4, Challenge 2). It runs entirely in Docker — no AWS
account, no cloud resources — and uses the container `/verify` scoring
contract, graded per checkpoint (`scoring.kind: "multi-verify"`,
TenkaCloud#2252).

> Training target. The compose file binds it to `127.0.0.1` only; never expose
> it off loopback.

Unlike the drills that precede it in this track (A6, A7, ...), this is a
**Challenge**: the cause is never stated in `instructions`/`description`. The
participant is told an application write is stuck and given the diagnostic
tools A6 (row locks, `pg_stat_activity`, `pg_blocking_pids()`) already taught
them — finding and clearing the actual blocker IS the exercise.

## Play it

```bash
make local PROBLEM=db-challenge-blocked-transaction   # from the TenkaCloud repo root
# opens the Participant Portal; log in with any non-empty key
```

- **Challenge surface:** the actual work happens over `psql` in the Portal's
  embedded terminal, not in a browser. <http://127.0.0.1:18510> is a small
  read-only info/status page.
- **Goal:** get the pending write against account 1 to actually complete.

If your Portal build has no embedded terminal yet, you can reach the same
database from your own machine's terminal:

```bash
docker compose -f local/docker-compose.yml exec db-challenge-blocked-transaction \
  psql -U participant -d drill
```

## The symptom (what the participant is told)

> Ops reports: the withdrawal write against account 1 (griffin holdings) has
> been pending forever and never completes. The app keeps retrying it in the
> background, but nothing ever comes back.

Nothing else. No mention of locks, blocking sessions, or what's wrong.

## The domain

| Table                   | Columns                                                              |
| ------------------------- | ----------------------------------------------------------------------- |
| `app.accounts`          | `id` (PK), `owner_name`, `balance_cents` — 2 rows: account 1 = $1,000.00, account 2 (untouched bystander) = $500.00 |
| `audit.incident_log`    | `log_id`, `event`, `backend_pid`, `logged_at` — append-only, written ONLY by the app itself |

`participant` has **no write grant** on `app.accounts` at all (unlike A6's
`inventory.stock`, where the participant IS the one doing the writing) — the
only two writers in this Challenge are the application's own `app_service`
connections. The only lever `participant` has is `pg_terminate_backend()`
(via `pg_signal_backend` membership).

**A permission gap found by running this on real Postgres 16, not assumed:**
`pg_stat_activity`'s `state` / `wait_event_type` / `wait_event` columns read
back as NULL for every OTHER role's backend unless the querying role is a
superuser or a member of `pg_read_all_stats` — without this grant, the exact
diagnostic query this Challenge's instructions describe (mirroring A6's
technique) would silently return zero rows for `participant`, because
`app_service`'s backends are a different role. `local/db/schema.sql` grants
`pg_read_all_stats` to `participant` for this reason (read-only: it exposes
no write or signal capability by itself).

## Design note

Consistent with this Challenge's own "don't hand over the cause" design (the
symptom above is genuinely all `instructions`/`description` say — see Epic
#431), this README does not restate what's actually causing the incident or
the winning fix — reading this file should not be a shortcut around
diagnosing it yourself. The full breakdown, including why a shallow
"terminate something" guess doesn't pass every checkpoint, ships in this
problem's post-solve `writeup` (`metadata.json`), unlocked once you actually
clear all three checkpoints below.

## How scoring works

The platform holds no answer and never reads the submission text. On each
"submit", the local scoring API forwards `{ checkpointId, submission }` to
the container's loopback `/verify` (`POST http://127.0.0.1:18511/verify`),
which queries the CURRENT state of `app.accounts` and `audit.incident_log`
and returns `{ checkpointId, correct, message }`:

| checkpoint                       | what it actually checks                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `blocking-session-cleared`       | has the SPECIFIC backend pid recorded once, at incident start, actually stopped existing in `pg_stat_activity`? |
| `genuine-wait-then-resolution`   | did the pending write stay genuinely blocked for a meaningful, app-recorded duration before completing (not millisecond-scale noise)? |
| `stuck-write-completed`          | does account 1's balance reflect only the pending write's own debit (not the blocker's)?                  |

You can re-scan as many times as you like; each checkpoint is independent
and worth 30 / 30 / 40 of the 100-point total.

## Delivery model

`metadata.json` declares a container runtime instead of a CloudFormation
template, plus an embedded Portal terminal (`runtime.terminal`) so no host
tooling is required:

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18510" },
  "verifyUrl": "http://127.0.0.1:18511/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "db-challenge-blocked-transaction" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 100 pts total … ] }
```

```
db-challenge-blocked-transaction/
├── metadata.json                # runtime (docker/compose) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # one service, loopback-only ports + healthcheck
    ├── Dockerfile                # postgres:16-alpine ("participant" stage) + node
    ├── entrypoint.sh             # boot pg, apply schema, seed once, start app
    ├── app/
    │   ├── server.mjs           # info/status page (:8080) + /verify (:8081); orchestrates the incident on boot
    │   ├── pg-client.mjs        # live Postgres adapter (balance, blocker liveness, wait duration)
    │   └── package.json         # the `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # the 3 checkpoints (pure, dependency-injected)
    │   └── grade.test.mjs       # unit tests with fake clients, incl. decoy/no-real-contention cases (bun test, no live DB)
    └── db/
        ├── schema.sql           # app.accounts, audit.incident_log, participant/app_service roles, pg_signal_backend + pg_read_all_stats grants
        └── seed.sql             # 2 rows
```

## Run the grader unit tests

The grader's pass/fail logic is unit-tested with injected fakes — no live
Postgres, no network:

```bash
cd local/grader && bun test
```

## FLAG_SEED

Injected by `make local` for every local-play problem, but unused here: every
checkpoint reads live database state, not a discovered secret.
