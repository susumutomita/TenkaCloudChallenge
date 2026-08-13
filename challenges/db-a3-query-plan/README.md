# db-a3-query-plan — Query plans and selectivity

A self-contained **local-play** Drill for TenkaCloud's Database Track (Phase 1,
Drill A3). It runs entirely in Docker — no AWS account, no cloud resources — and
uses the container `/verify` scoring contract, graded per checkpoint
(`scoring.kind: "multi-verify"`, TenkaCloud#2252).

> Training target. The compose file binds it to `127.0.0.1` only; never expose
> it off loopback.

## Play it

```bash
make local PROBLEM=db-a3-query-plan   # from the TenkaCloud repo root
# opens the Participant Portal; log in with any non-empty key
```

- **Challenge surface:** the actual work happens over `psql` in the Portal's
  embedded terminal, not in a browser. <http://127.0.0.1:18420> is a small
  read-only info/status page (also shows the live plans, estimated row counts, and
  actual row counts).
- **Goal:** run `analyze support.tickets;` so that `priority = 'urgent'` (rare) and
  `priority = 'normal'` (common) get plans that actually differ by selectivity.

If your Portal build has no embedded terminal yet, you can reach the same
database from your own machine's terminal:

```bash
docker compose -f local/docker-compose.yml exec db-a3-query-plan \
  psql -U participant -d drill
```

## The story

`support.tickets` (300,000 rows) already has an index on `priority`. But "an index
exists" and "the planner actually uses it" are two different questions — and right
now the table has never been `ANALYZE`d, so the planner's own row estimates start
out broken.

## The domain

| Table | Columns |
| --- | --- |
| `support.tickets` | `id` (PK), `priority` (indexed; `urgent` is ~50 of 300,000 rows = 0.02%, `normal` is the remaining 99.98%), `subject`, `created_at` |

## Observe the cost, then change it

```sql
-- 1. Before ANALYZE: both values get the same (wrong) estimated row count.
explain (analyze, buffers)
select * from support.tickets where priority = 'urgent';
-- shows rows=938, but actually returns 50 rows (Bitmap Heap Scan)

explain (analyze, buffers)
select * from support.tickets where priority = 'normal';
-- shows rows=938, but actually returns 299,950 rows (still picks a Bitmap Heap Scan)

-- 2. Refresh the statistics:
analyze support.tickets;

-- 3. Run the SAME two queries again:
explain (analyze, buffers)
select * from support.tickets where priority = 'urgent';
-- Index Scan using idx_tickets_priority ... rows=60 (actual: 50)

explain (analyze, buffers)
select * from support.tickets where priority = 'normal';
-- Seq Scan on tickets ... rows=299940 (actual: 299,950) — reading the whole table
-- straight through really is cheaper than detouring through the index one row at a time
```

Numbers above are from a real local run while authoring this drill (see
"Numbers behind the thresholds" below) — expect the same shape, not
necessarily the exact same digits, on your machine.

## How scoring works

The platform holds no answer and never reads the submission text. On each
"submit", the local scoring API forwards `{ checkpointId, submission }` to the
container's loopback `/verify` (`POST http://127.0.0.1:18421/verify`), which
runs a REAL `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` against the two fixed
target queries and returns `{ checkpointId, correct, message }`:

| checkpoint | what it actually checks |
| --- | --- |
| `table-statistics-collected` | does `pg_stat_user_tables.last_analyze` show a value (= has `ANALYZE` actually run)? |
| `row-estimates-match-reality` | for BOTH queries, is EXPLAIN's estimated row count (`Plan Rows`) within 5x of the actual row count (`Actual Rows`)? |
| `scan-strategy-matches-selectivity` | does `urgent`'s plan use an index and contain no Seq Scan, AND does `normal`'s plan use ONLY a Seq Scan with no index-based node? (both have to hold together) |

You can re-scan as many times as you like; each checkpoint is independent and
worth 30 / 30 / 40 of the 100-point total.

### Numbers behind the thresholds

Measured against a real Postgres 16 instance while authoring this drill (not
against the shipped Docker image itself — see "Verification" in the PR this
problem shipped in for why):

| state | urgent (rare) | normal (common) |
| --- | --- | --- |
| before ANALYZE | estimate 938 / actual 50, Bitmap Heap Scan | estimate 938 / actual 299,950, Bitmap Heap Scan (wrongly uses the index) |
| after `ANALYZE` | estimate 60 / actual 50, Index Scan | estimate 299,940 / actual 299,950, Seq Scan |

`row-estimates-match-reality`'s tolerance (within 5x) is far tighter than the
pre-ANALYZE measured drift (~19x for urgent, ~320x for normal) and far looser than
the post-ANALYZE measured ratio (1.0x-1.2x) — it is not sensitive to small
machine-to-machine sampling variance.

## Delivery model

`metadata.json` declares a container runtime instead of a CloudFormation
template, plus an embedded Portal terminal (`runtime.terminal`) so no host
tooling is required:

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18420" },
  "verifyUrl": "http://127.0.0.1:18421/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "db-a3-query-plan" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 100 pts total … ] }
```

```
db-a3-query-plan/
├── metadata.json                # runtime (docker/compose) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # one service, loopback-only ports + healthcheck
    ├── Dockerfile                # postgres:16-alpine ("participant" stage) + node
    ├── entrypoint.sh             # boot pg, apply schema, seed once (300k rows, no ANALYZE), start app
    ├── app/
    │   ├── server.mjs           # info/status page (:8080) + /verify (:8081)
    │   ├── pg-client.mjs        # live Postgres adapter (EXPLAIN runner, statistics check)
    │   └── package.json         # the `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # the 3 checkpoints (pure, dependency-injected)
    │   └── grade.test.mjs       # unit tests with fake clients (bun test, no live DB)
    └── db/
        ├── schema.sql           # support.tickets, index, participant role
        └── seed.sql             # 300,000 rows, generated set-based. ANALYZE intentionally skipped
```

## Why ANALYZE is intentionally skipped at seed time

db-a2-index-tradeoff's seed.sql ends with `analyze shop.orders;`, but
db-a3-query-plan's does not. This is the drill's central mechanism — a table
whose statistics are stale (or entirely absent) right after a bulk load is an
extremely common real-world state. `local/db/schema.sql` also sets
`autovacuum_enabled = false` on `support.tickets`, so autovacuum cannot quietly
refresh the statistics on its own and erase the "never analyzed" starting state
before the participant even opens a terminal.

## Run the grader unit tests

The grader's pass/fail logic is unit-tested with injected fakes — no live
Postgres, no network:

```bash
cd local/grader && bun test
```

## FLAG_SEED

Injected by `make local` for every local-play problem, but unused here: every
checkpoint reads live database state, not a discovered secret.
