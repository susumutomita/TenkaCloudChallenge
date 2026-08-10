# db-a1-table-primary-key — Table / Row / Primary Key

A self-contained **local-play** Drill for TenkaCloud's Database Track (Phase 1,
Drill A1). It runs entirely in Docker — no AWS account, no cloud resources — and
uses the container `/verify` scoring contract, graded per checkpoint
(`scoring.kind: "multi-verify"`, TenkaCloud#2252).

> Training target. The compose file binds it to `127.0.0.1` only; never expose
> it off loopback.

## Play it

```bash
make local PROBLEM=db-a1-table-primary-key   # from the TenkaCloud repo root
# opens the Participant Portal; log in with any non-empty key
```

- **Challenge surface:** the actual work happens over `psql` in the Portal's
  embedded terminal, not in a browser. <http://127.0.0.1:18400> is a small
  read-only info/status page.
- **Goal:** build `training.members` with `email` as a real `PRIMARY KEY`, load
  the deduplicated data, and confirm Postgres itself rejects a repeat.

If your Portal build has no embedded terminal yet, you can reach the same
database from your own machine's terminal:

```bash
docker compose -f local/docker-compose.yml exec db-a1-table-primary-key \
  psql -U participant -d drill
```

## The story

Your predecessor's member ledger, `training.members_unkeyed`, has the same
person registered two or three times — a re-registration, a test row, a retry
after a timeout. Nothing in the table says that cannot happen.

## The domain

| Table                      | Columns                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `training.members_unkeyed` | `id` (PK, meaningless sequence), `email`, `display_name`, `created_at` — pre-seeded, 11 rows / 7 people    |
| `training.members`         | **you create this** — `email` as PRIMARY KEY, `display_name`                                               |

## Observe the bug, then fix it

```sql
-- 1. The same email shows up more than once, as genuinely separate rows:
select ctid, id, email, display_name from training.members_unkeyed order by email, id;

-- 2. Nothing stops you from adding yet another duplicate:
insert into training.members_unkeyed (email, display_name) values ('aoi@example.com', 'dup-test');
-- INSERT 0 1 — Postgres has no reason to refuse it.

-- 3. Build the table that actually declares a key:
create table training.members (
  email        text primary key,
  display_name text not null
);

-- 4. Load the deduplicated data (first row per email wins):
insert into training.members (email, display_name)
select distinct on (email) email, display_name
from training.members_unkeyed
order by email, id;

-- 5. Try the same duplicate against the KEYED table:
insert into training.members (email, display_name) values ('aoi@example.com', 'dup-test');
-- ERROR: duplicate key value violates unique constraint "members_pkey"
```

Steps 2 and 5 are the same operation against two tables that look almost
identical — the only difference is what each one declares as its primary key.

## How scoring works

The platform holds no answer and never reads the submission text. On each
"submit", the local scoring API forwards `{ checkpointId, submission }` to the
container's loopback `/verify` (`POST http://127.0.0.1:18401/verify`), which
queries **live Postgres state** and returns `{ checkpointId, correct, message }`:

| checkpoint                      | what it actually queries                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `members-table-has-primary-key` | `pg_index` / `pg_attribute`: does `training.members` have a PRIMARY KEY that includes `email`?               |
| `members-rows-loaded`           | row count of `training.members` == distinct email count of `training.members_unkeyed` (7)?                   |
| `duplicate-insert-rejected`     | the grader itself inserts an already-used email into `training.members`, inside a transaction it always rolls back — does Postgres reject it with `23505`? |

You can re-scan as many times as you like; each checkpoint is independent and
worth 30 / 30 / 40 of the 100-point total.

## Delivery model

`metadata.json` declares a container runtime instead of a CloudFormation
template, plus an embedded Portal terminal (`runtime.terminal`) so no host
tooling is required:

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18400" },
  "verifyUrl": "http://127.0.0.1:18401/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "db-a1-table-primary-key" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 100 pts total … ] }
```

```
db-a1-table-primary-key/
├── metadata.json                # runtime (docker/compose) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # one service, loopback-only ports + healthcheck
    ├── Dockerfile                # postgres:16-alpine ("participant" stage) + node
    ├── entrypoint.sh             # boot pg, apply schema, seed once, start app
    ├── app/
    │   ├── server.mjs           # info page (:8080) + /verify (:8081)
    │   ├── pg-client.mjs        # live Postgres adapter the grader drives
    │   └── package.json         # the `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # the 3 checkpoints (pure, dependency-injected)
    │   └── grade.test.mjs       # unit tests with fake clients (bun test, no live DB)
    └── db/
        ├── schema.sql           # training schema, members_unkeyed, participant role
        └── seed.sql             # 7 people, 11 rows (3 deliberate duplicates)
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
