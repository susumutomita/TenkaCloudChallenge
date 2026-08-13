# db-a2-index-tradeoff — Index read/write trade-off

A self-contained **local-play** Drill for TenkaCloud's Database Track (Phase 1,
Drill A2). It runs entirely in Docker — no AWS account, no cloud resources — and
uses the container `/verify` scoring contract, graded per checkpoint
(`scoring.kind: "multi-verify"`, TenkaCloud#2252).

> Training target. The compose file binds it to `127.0.0.1` only; never expose
> it off loopback.

## Play it

```bash
make local PROBLEM=db-a2-index-tradeoff   # from the TenkaCloud repo root
# opens the Participant Portal; log in with any non-empty key
```

- **Challenge surface:** the actual work happens over `psql` in the Portal's
  embedded terminal, not in a browser. <http://127.0.0.1:18410> is a small
  read-only info/status page (also shows the live plan and buffer count).
- **Goal:** make `select * from shop.orders where order_number = 'ORD-00256789';`
  stop doing a full table scan.

If your Portal build has no embedded terminal yet, you can reach the same
database from your own machine's terminal:

```bash
docker compose -f local/docker-compose.yml exec db-a2-index-tradeoff \
  psql -U participant -d drill
```

## The story

`shop.orders` has 400,000 rows and no index beyond the primary key on the
synthetic `id`. Customer support looks orders up by `order_number` all day —
and every one of those lookups reads the whole table.

## The domain

| Table         | Columns                                                                          |
| -------------- | ----------------------------------------------------------------------------------- |
| `shop.orders` | `id` (PK), `order_number`, `customer_email`, `amount_cents`, `status`, `created_at` — 400,000 rows |

## Observe the cost, then change it

```sql
-- 1. No index on order_number: the planner has nothing but a full scan.
explain (analyze, buffers)
select * from shop.orders where order_number = 'ORD-00256789';
-- Seq Scan on orders ... Buffers: shared hit=4651

-- 2. Add the index and refresh the planner's statistics:
create index idx_orders_order_number on shop.orders (order_number);
analyze shop.orders;

-- 3. Run the SAME query again:
explain (analyze, buffers)
select * from shop.orders where order_number = 'ORD-00256789';
-- Index Scan using idx_orders_order_number ... Buffers: shared hit=1 read=3

-- 4. (Not graded, but part of the intended experience) feel the write-side cost:
\timing on
insert into shop.orders (order_number, customer_email, amount_cents, status)
select 'ORD-EXTRA' || i, 'x@example.com', 100, 'paid' from generate_series(1, 10000) i;
-- compare this timing against the same insert run BEFORE the index existed
```

Numbers above are from a real local run while authoring this drill (see
"Numbers behind the thresholds" below) — expect the same shape, not
necessarily the exact same digits, on your machine.

## How scoring works

The platform holds no answer and never reads the submission text. On each
"submit", the local scoring API forwards `{ checkpointId, submission }` to the
container's loopback `/verify` (`POST http://127.0.0.1:18411/verify`), which
runs a REAL `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` against the fixed target
query and returns `{ checkpointId, correct, message }`:

| checkpoint                     | what it actually checks                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `order-number-index-exists`    | `pg_indexes` shows an index whose definition mentions `order_number`                                                        |
| `query-plan-avoids-seq-scan`   | the plan tree for the target query has **no** `Seq Scan` node and **has** an index-based node (`Index Scan` / `Index Only Scan` / `Bitmap Index Scan`) — the planner has to actually choose the index, not just have one available |
| `buffers-dramatically-reduced` | current buffers (Shared Hit + Shared Read, summed over the whole plan tree) `<= max(50, baseline * 0.1)`, where `baseline` was captured once, automatically, the first time the container ever booted (before any index could exist) |

You can re-scan as many times as you like; each checkpoint is independent and
worth 30 / 30 / 40 of the 100-point total.

### Numbers behind the thresholds

Measured against a real Postgres 16 instance while authoring this drill (not
against the shipped Docker image itself — see "Verification" in the PR this
problem shipped in for why):

| state                    | plan       | buffers (shared hit + read) |
| -------------------------- | ---------- | ---------------------------- |
| before any index (baseline) | `Seq Scan` | 4651                          |
| after `CREATE INDEX` + `ANALYZE` | `Index Scan` | 4                             |

`buffers-dramatically-reduced`'s threshold (`max(50, baseline * 0.1)` = 465
here) leaves well over an order of magnitude of margin above the measured
"solved" value, so it is not sensitive to small machine-to-machine variance.

## Delivery model

`metadata.json` declares a container runtime instead of a CloudFormation
template, plus an embedded Portal terminal (`runtime.terminal`) so no host
tooling is required:

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18410" },
  "verifyUrl": "http://127.0.0.1:18411/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "db-a2-index-tradeoff" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 100 pts total … ] }
```

```
db-a2-index-tradeoff/
├── metadata.json                # runtime (docker/compose) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # one service, loopback-only ports + healthcheck
    ├── Dockerfile                # postgres:16-alpine ("participant" stage) + node
    ├── entrypoint.sh             # boot pg, apply schema, seed once (400k rows), start app
    ├── app/
    │   ├── server.mjs           # info/status page (:8080) + /verify (:8081); captures baseline on boot
    │   ├── pg-client.mjs        # live Postgres adapter (EXPLAIN runner, index check, baseline)
    │   └── package.json         # the `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # the 3 checkpoints (pure, dependency-injected)
    │   └── grade.test.mjs       # unit tests with fake clients (bun test, no live DB)
    └── db/
        ├── schema.sql           # shop.orders, grading.baseline_buffers (author-only), participant role
        └── seed.sql             # 400,000 rows, generated set-based
```

## Why the baseline lives in the database, not a file

The "before any index" buffer count has to be captured exactly once, the
first time the container is ever built and booted — a later restart, with the
participant's index already in place, must not recompute a now-meaningless
number. `grading.baseline_buffers` is a table in its own schema that
`participant` has no privilege on, so it survives container restarts (same
Postgres data volume) and cannot be read or tampered with from the drill side.

## Run the grader unit tests

The grader's pass/fail logic is unit-tested with injected fakes — no live
Postgres, no network:

```bash
cd local/grader && bun test
```

## FLAG_SEED

Injected by `make local` for every local-play problem, but unused here: every
checkpoint reads live database state, not a discovered secret.
