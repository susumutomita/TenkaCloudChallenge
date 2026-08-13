# db-a12-partition — the unit of a bulk delete: row, or partition?

A self-contained **local-play** Drill for TenkaCloud's Database Track (Phase 1,
Chapter 3, Drill A12). It runs entirely in Docker — no AWS account, no cloud
resources — and uses the container `/verify` scoring contract, graded per
checkpoint (`scoring.kind: "multi-verify"`, TenkaCloud#2252).

> Training target. The compose file binds it to `127.0.0.1` only; never expose
> it off loopback.

## Play it

```bash
make local PROBLEM=db-a12-partition   # from the TenkaCloud repo root
# opens the Participant Portal; log in with any non-empty key
```

- **Challenge surface:** the actual work happens over `psql` in the Portal's
  embedded terminal, not in a browser. <http://127.0.0.1:18470> is a small
  read-only info/status page.
- **Goal:** remove one old month's data from a natively partitioned,
  120,000-row time-series table with an ordinary `DELETE`, remove another old
  month with `DETACH PARTITION` (+ `DROP TABLE`), and measure with `\timing`
  how differently the same-sized job costs depending on the method.

If your Portal build has no embedded terminal yet, you can reach the same
database from your own machine's terminal:

```bash
docker compose -f local/docker-compose.yml exec db-a12-partition \
  psql -U participant -d drill
```

## The story

`metrics.events` is `partition by range (created_at)`, one partition per
month, 2024-01 through 2024-06 — 20,000 rows each, 120,000 total. Two months
are "old data nobody needs anymore": 2024-01 (remove it the ordinary way,
`DELETE ... WHERE`) and 2024-02 (remove it the partition way,
`ALTER TABLE ... DETACH PARTITION`, optionally followed by `DROP TABLE`). Both
jobs cover roughly the same number of rows. The `DELETE` costs Postgres one
per-row tuple invalidation for each of the 20,000 rows; `DETACH PARTITION`
never reads a single data row — it rewrites one record in the system catalog.
The difference in wall-clock time is the whole point of this drill, and the
drill never states it up front — you measure it yourself.

## The domain

| Table | Rows | Role |
| --- | --- | --- |
| `metrics.events_y2024m01` | 20,000 | Remove via ordinary `DELETE` |
| `metrics.events_y2024m02` | 20,000 | Remove via `DETACH PARTITION` (+ optional `DROP TABLE`) |
| `metrics.events_y2024m03` .. `m06` | 20,000 each (80,000 total) | Bystanders — must survive untouched |

`metrics.events` (the partitioned parent) has no rows of its own; every row
lives in exactly one of its 6 leaf partitions. `autovacuum_enabled = false` on
every leaf.

## DELETE it, DETACH it, compare

```sql
-- 0. See the current partition layout.
select inhrelid::regclass as partition
from pg_inherits
where inhparent = 'metrics.events'::regclass
order by 1;                                                     -- 6 monthly partitions

\timing on

-- 1. Method A: an ordinary DELETE against 2024-01 (~20,000 rows).
delete from metrics.events where created_at >= '2024-01-01' and created_at < '2024-02-01';
-- DELETE 20000
-- Time: ~19 ms

-- 2. Method B: DETACH PARTITION against 2024-02 (same ~20,000 rows).
alter table metrics.events detach partition metrics.events_y2024m02;
-- ALTER TABLE
-- Time: ~1.3 ms  (an order of magnitude faster — see "Numbers" below)

-- 3. The detached table still holds its data; DROP it to reclaim the space.
drop table metrics.events_y2024m02;
-- DROP TABLE
-- Time: ~2.4 ms

-- 4. Confirm the untouched months are fine.
select count(*) from metrics.events;                             -- 80000
```

Numbers above are from a real local run while authoring this drill (see
"Numbers behind the thresholds" below) — expect the same shape, not
necessarily the exact same digits, on your machine.

## How scoring works

The platform holds no answer and never reads the submission text. On each
"submit", the local scoring API forwards `{ checkpointId, submission }` to
the container's loopback `/verify` (`POST http://127.0.0.1:18471/verify`),
which queries the CURRENT state of `pg_class.relispartition`, `pg_inherits`,
and each leaf partition's live row count, and returns
`{ checkpointId, correct, message }`:

| checkpoint | what it actually checks |
| --- | --- |
| `old-partition-detached-or-dropped` | has `events_y2024m02` stopped being a partition of `metrics.events` (DETACH alone, or DETACH then DROP — both count)? |
| `old-month-deleted-via-delete` | is `events_y2024m01` STILL attached, AND does it now have 0 rows? |
| `bystander-partitions-intact` | are `events_y2024m03`..`m06` all still attached, each with exactly 20,000 rows? |

You can re-scan as many times as you like; each checkpoint is independent and
worth 35 / 35 / 30 of the 100-point total.

### Why `old-month-deleted-via-delete` requires the partition to STILL be attached

"`events_y2024m01` has 0 rows" alone can't tell apart a real row-level
`DELETE` from the participant DETACHing it instead (the wrong tool for this
target, applied out of confusion or convenience) — both leave
`metrics.events` reporting the same row count for that month. `DETACH
PARTITION` always flips `pg_class.relispartition` to `false` the instant it
completes (confirmed on a live Postgres 16 instance), so requiring "still
attached AND 0 rows" closes that gap: that combination is only reachable by
running a genuine `DELETE`. No participant DML grant can forge
`relispartition` — it isn't a table anyone can write to, it's a fact
Postgres's own catalog maintains.

### Why `participant` has USAGE but not CREATE on the `metrics` schema, and no INSERT/UPDATE/TRUNCATE

`participant` owns the partitioned parent and every leaf partition (needed:
`DETACH PARTITION` requires `ALTER` on the parent, `DROP TABLE` requires
ownership of the leaf, and `DELETE` needs DML rights on whichever leaf it
targets). Two grants were deliberately withheld:

- **No `CREATE` on `metrics`** — closes a shortcut where a participant
  recreates an empty replacement table under the same name and re-`ATTACH`es
  it as a partition, faking a real `DELETE`'s end state without ever paying
  its cost. Confirmed on a live Postgres 16 instance: `CREATE TABLE` under
  this schema fails with a permission error for `participant`.
- **No `INSERT`/`UPDATE`/`TRUNCATE`** — `INSERT` would let a participant pad
  a bystander month's row count back up after an accidental change;
  `TRUNCATE` would let a participant empty `events_y2024m01` in one
  catalog-only operation, masquerading as "I paid the real per-row `DELETE`
  cost" when they didn't. Confirmed on a live Postgres 16 instance: `REVOKE`
  against a table's own owner is honored (a `TRUNCATE` attempt afterward
  fails with a permission error), and `DELETE` / `DETACH PARTITION` /
  `DROP TABLE` all keep working without those three grants.

### Numbers behind the thresholds

Measured against a real Postgres 16 instance while authoring this drill (not
against the shipped Docker image itself — see "Verification" in the PR this
problem shipped in for why), all within a single `psql` session so client
connection overhead doesn't skew the comparison:

| operation | rows involved | time |
| --- | --- | --- |
| `DELETE` (2024-01) | 20,000 | ~19.0 ms |
| `DETACH PARTITION` (2024-02) | 20,000 (none actually read) | ~1.3 ms |
| `DROP TABLE` (the now-detached 2024-02) | 20,000 (removed as a file, not row by row) | ~2.4 ms |

`DETACH` + `DROP` combined (~3.7 ms) still finished in under a fifth of the
time the plain row `DELETE` took (~19.0 ms) — for the same row count. The gap
only widens as row count grows: `DELETE`'s cost is proportional to rows
removed, `DETACH PARTITION`'s cost is not.

## Delivery model

`metadata.json` declares a container runtime instead of a CloudFormation
template, plus an embedded Portal terminal (`runtime.terminal`) so no host
tooling is required:

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18470" },
  "verifyUrl": "http://127.0.0.1:18471/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "db-a12-partition" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 100 pts total … ] }
```

```
db-a12-partition/
├── metadata.json                # runtime (docker/compose) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # one service, loopback-only ports + healthcheck
    ├── Dockerfile                # postgres:16-alpine ("participant" stage) + node
    ├── entrypoint.sh             # boot pg, apply schema, seed once, start app
    ├── app/
    │   ├── server.mjs           # info/status page (:8080) + /verify (:8081)
    │   ├── pg-client.mjs        # live Postgres adapter (partition catalog, row counts)
    │   └── package.json         # the `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # the 3 checkpoints (pure, dependency-injected)
    │   └── grade.test.mjs       # unit tests with fake clients (bun test, no live DB)
    └── db/
        ├── schema.sql           # metrics.events (partitioned, participant-owned, DELETE-only) + 6 monthly leaves
        └── seed.sql             # 6 × 20,000 rows
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
