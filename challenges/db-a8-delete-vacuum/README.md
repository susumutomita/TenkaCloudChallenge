# db-a8-delete-vacuum — DELETE happened, disk didn't shrink

A self-contained **local-play** Drill for TenkaCloud's Database Track (Phase 1,
Chapter 2, Drill A8). It runs entirely in Docker — no AWS account, no cloud
resources — and uses the container `/verify` scoring contract, graded per
checkpoint (`scoring.kind: "multi-verify"`, TenkaCloud#2252).

> Training target. The compose file binds it to `127.0.0.1` only; never expose
> it off loopback.

## Play it

```bash
make local PROBLEM=db-a8-delete-vacuum   # from the TenkaCloud repo root
# opens the Participant Portal; log in with any non-empty key
```

- **Challenge surface:** the actual work happens over `psql` in the Portal's
  embedded terminal, not in a browser. <http://127.0.0.1:18460> is a small
  read-only info/status page.
- **Goal:** bulk-`DELETE` 300,000 rows older than a retention cutoff out of a
  400,000-row table, watch disk usage refuse to shrink and `n_dead_tup` spike,
  then run `VACUUM` yourself (autovacuum is off) and watch the dead tuples get
  reclaimed — while the file size *still* doesn't move.

If your Portal build has no embedded terminal yet, you can reach the same
database from your own machine's terminal:

```bash
docker compose -f local/docker-compose.yml exec db-a8-delete-vacuum \
  psql -U participant -d drill
```

## The story

`telemetry.events` has 400,000 rows: 300,000 "old" events (created before the
retention cutoff, `2023-01-01`) and 100,000 "recent" events (on/after it, and
never meant to be touched). Deleting the old 300,000 rows is the obvious first
move — and the surprise is that `pg_total_relation_size` barely moves
afterward. A `DELETE`d row becomes a *dead tuple*, not a hole punched in the
file; `n_dead_tup` jumps instead. `VACUUM` (which nothing runs automatically
here — autovacuum is off) reclaims those dead tuples for reuse... but the file
itself still doesn't shrink. Only `VACUUM FULL`, which rewrites the whole
table, actually returns space to the OS — at the cost of an
`ACCESS EXCLUSIVE` lock.

## The domain

| Table | Columns |
| --- | --- |
| `telemetry.events` | `id` (PK), `created_at`, `kind` — 400,000 rows: 300,000 with `created_at` in `2022`, 100,000 with `created_at` in `2024` |
| `audit.delete_log` | `log_id`, `rows_deleted`, `min_created_at`, `max_created_at`, `backend_pid`, `executed_at` — append-only, written ONLY by a statement-level trigger on `telemetry.events` |

`autovacuum_enabled=false` on `telemetry.events` — dead tuples only shrink
when you run `VACUUM` yourself, on your own schedule, not whenever autovacuum
happens to wake up.

## DELETE it, watch it not shrink, VACUUM it, watch it (still) not shrink

```sql
-- 0. Baseline.
select count(*) from telemetry.events;                                  -- 400000
select pg_size_pretty(pg_total_relation_size('telemetry.events'));      -- ~30 MB

-- 1. Bulk-delete everything older than the retention cutoff.
delete from telemetry.events where created_at < '2023-01-01';           -- DELETE 300000

-- 2. Right after DELETE — size hasn't moved, dead tuples spiked:
select pg_size_pretty(pg_total_relation_size('telemetry.events'));      -- still ~30 MB
select n_live_tup, n_dead_tup from pg_stat_user_tables
  where schemaname='telemetry' and relname='events';                   -- n_dead_tup ≈ 300000

-- 3. VACUUM (autovacuum is off — nothing else will do this):
vacuum (verbose) telemetry.events;
select n_dead_tup from pg_stat_user_tables where relname='events';      -- ~0, reclaimed
select pg_size_pretty(pg_total_relation_size('telemetry.events'));      -- STILL ~30 MB

-- 4. Optional, ungraded: VACUUM FULL actually shrinks the file.
vacuum full telemetry.events;
select pg_size_pretty(pg_total_relation_size('telemetry.events'));      -- drops to ~8 MB
```

Numbers above are from a real local run while authoring this drill (see
"Numbers behind the thresholds" below) — expect the same shape, not
necessarily the exact same digits, on your machine.

## How scoring works

The platform holds no answer and never reads the submission text. On each
"submit", the local scoring API forwards `{ checkpointId, submission }` to
the container's loopback `/verify` (`POST http://127.0.0.1:18461/verify`),
which queries the CURRENT state of `telemetry.events`, `pg_stat_user_tables`,
and `audit.delete_log`, and returns `{ checkpointId, correct, message }`:

| checkpoint | what it actually checks |
| --- | --- |
| `old-rows-deleted-recent-intact` | are there 0 rows left older than the cutoff, and exactly 100,000 left on/after it? |
| `bulk-delete-observed` | does `audit.delete_log`'s cumulative `rows_deleted` show a genuinely large (≥250,000) DELETE happened? |
| `dead-tuples-reclaimed` | is `pg_stat_user_tables.n_tup_del` likewise large (≥250,000) AND is the current `n_dead_tup` small? |

You can re-scan as many times as you like; each checkpoint is independent and
worth 30 / 30 / 40 of the 100-point total.

### Why `bulk-delete-observed` exists at all

A freshly seeded `telemetry.events` that nobody has touched already has
`n_dead_tup = 0` — dead tuples only exist once something has actually deleted
rows. That means "is `n_dead_tup` small?" alone cannot tell apart "300,000
rows were really deleted and VACUUM reclaimed them" from "nothing happened,
and the participant just ran `VACUUM;` against an untouched table" — the exact
shortcut this drill's design brief calls out by name. `audit.delete_log` (a
statement-level trigger using Postgres's own `referencing old table` DELETE
transition table — confirmed cheap even for a 300,000-row DELETE, well under a
second on a real Postgres 16 instance) is the durable, unforgeable record that
closes that gap: no `INSERT` grant exists on it, so a participant cannot
fabricate an entry, only a real `DELETE` populates it.

`dead-tuples-reclaimed` cross-checks the same fact through a second,
independent channel — `pg_stat_user_tables.n_tup_del`, a cumulative counter
Postgres itself maintains and `VACUUM` never resets. Confirmed directly on a
live Postgres 16 instance: a non-superuser table owner gets
`permission denied` from both `pg_stat_reset()` and
`pg_stat_reset_single_table_counters()`, so this counter cannot be forged or
zeroed by `participant` either. Defeating the anti-cheat would require
defeating both channels — the trigger-populated audit table and the
engine-maintained statistic — at once.

### Why participant owns `telemetry.events` but not INSERT/UPDATE on it

`VACUUM` requires table ownership (or superuser) on PostgreSQL 16 — the
`MAINTAIN` privilege that would let a non-owner run it without ownership only
arrived in PostgreSQL 17, one major version after the `postgres:16-alpine`
image this drill (like A1-A7) is built on. Without ownership, `participant`
could never run the `VACUUM` this drill's whole point depends on. Unlike
db-a7-mvcc (which left ownership's implicit DML grants alone because it needs
`UPDATE`), this drill's checkpoints compare live row *counts* against fixed
seeded values (0 old rows, exactly 100,000 recent rows) — so `INSERT`/`UPDATE`
are explicitly `REVOKE`d from the owner right after granting ownership,
closing off an otherwise-open way to pad or backfill those counts instead of
doing the real bulk `DELETE`. Confirmed directly on a live Postgres 16
instance: `REVOKE` against a table's own owner is honored (an `INSERT` attempt
afterward fails with a permission error), and `VACUUM`/`DELETE` both keep
working without those grants.

### Numbers behind the thresholds

Measured against a real Postgres 16 instance while authoring this drill (not
against the shipped Docker image itself — see "Verification" in the PR this
problem shipped in for why):

| step | `pg_total_relation_size` | `n_dead_tup` |
| --- | --- | --- |
| before DELETE (400,000 rows) | 30 MB | 0 |
| right after `DELETE` 300,000 rows | 30 MB (unchanged) | 300,000 |
| after plain `VACUUM` | 30 MB (**still** unchanged) | 0 (reclaimed) |
| after `VACUUM FULL` (optional) | ~7.6 MB | 0 |

The middle two rows are the whole point: `DELETE` alone never shrinks the
file, and neither does a *plain* `VACUUM` — it only marks the space reusable
inside the same table. Only `VACUUM FULL`, which rewrites the table into a new
file, actually returns space to the OS.

## Delivery model

`metadata.json` declares a container runtime instead of a CloudFormation
template, plus an embedded Portal terminal (`runtime.terminal`) so no host
tooling is required:

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18460" },
  "verifyUrl": "http://127.0.0.1:18461/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "db-a8-delete-vacuum" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 100 pts total … ] }
```

```
db-a8-delete-vacuum/
├── metadata.json                # runtime (docker/compose) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # one service, loopback-only ports + healthcheck
    ├── Dockerfile                # postgres:16-alpine ("participant" stage) + node
    ├── entrypoint.sh             # boot pg, apply schema, seed once, start app
    ├── app/
    │   ├── server.mjs           # info/status page (:8080) + /verify (:8081)
    │   ├── pg-client.mjs        # live Postgres adapter (row counts, stats, delete_log)
    │   └── package.json         # the `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # the 3 checkpoints (pure, dependency-injected)
    │   └── grade.test.mjs       # unit tests with fake clients (bun test, no live DB)
    └── db/
        ├── schema.sql           # telemetry.events (owned by participant, DELETE-only), audit.delete_log + trigger
        └── seed.sql             # 300,000 + 100,000 rows
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
