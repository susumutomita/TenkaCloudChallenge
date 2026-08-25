# db-challenge-slow-query — The customer's order history never loads

A self-contained **local-play** Challenge for TenkaCloud's Database Track
(Phase 1, Chapter 4, Challenge 1). It runs entirely in Docker — no AWS
account, no cloud resources — and uses the container `/verify` scoring
contract, graded per checkpoint (`scoring.kind: "multi-verify"`,
TenkaCloud#2252).

> Training target. The compose file binds it to `127.0.0.1` only; never expose
> it off loopback.

Unlike the drills that precede it in this track (A2, A3, ...), this is a
**Challenge**: the cause is never stated in `instructions`/`description`. The
participant gets one slow query and the diagnostic tools A2 (index
read/write trade-off) and A3 (query plans and selectivity) already taught
them — finding the cause IS the exercise.

## Play it

```bash
make local PROBLEM=db-challenge-slow-query   # from the TenkaCloud repo root
# opens the Participant Portal; log in with any non-empty key
```

- **Challenge surface:** the actual work happens over `psql` in the Portal's
  embedded terminal, not in a browser. <http://127.0.0.1:18500> is a small
  read-only info/status page (also shows the live plan and buffer count).
- **Goal:** make the order-history query below stop scanning the whole
  `storefront.orders` table.

If your Portal build has no embedded terminal yet, you can reach the same
database from your own machine's terminal:

```bash
docker compose -f local/docker-compose.yml exec db-challenge-slow-query \
  psql -U participant -d drill
```

## The symptom (what the participant is told)

> Customer support reports: opening a customer's order history in the admin
> screen never finishes loading. The slow part turns out to be this exact
> query:
>
> ```sql
> select id, status, total_cents, created_at
> from storefront.orders
> where customer_id = 2500
> order by created_at desc
> limit 20;
> ```

Nothing else. No mention of indexes, column order, or what's wrong.

## The domain

| Table                    | Columns                                                                       |
| ------------------------- | ------------------------------------------------------------------------------ |
| `storefront.customers`   | `id` (PK), `email`, `full_name`, `created_at` — 5,000 rows                     |
| `storefront.orders`      | `id` (PK), `customer_id` (FK), `status`, `total_cents`, `created_at` — 300,000 rows |

## The red herring

`storefront.orders` is not index-free. From the moment the container boots,
it already has:

```sql
create index idx_orders_status_customer on storefront.orders (status, customer_id);
```

This index is real — it shows up in `pg_indexes`, and a participant who only
checks "does this table have an index?" finds one immediately. But the
target query never filters on `status`; it only filters on `customer_id`.

**A trap found by running this on real Postgres 16, not assumed:** this
Challenge originally planned to grade on "the plan has no `Seq Scan` node."
That assumption turned out to be wrong. Even though `customer_id` is not
`idx_orders_status_customer`'s leading column, the planner still picks it for
the target query — it walks that (narrower) index end-to-end, checking
`customer_id` directly against each index entry (`Index Cond`, not
`Filter`), which is genuinely cheaper than walking the (wider) heap
end-to-end. The result: the plan NEVER shows a `Seq Scan` node for this
query, even in the untouched starting state, before the participant does
anything. So "is Seq Scan gone" cannot be the pass condition — see "How
scoring works" below for what the grader checks instead.

## Design note

Consistent with this Challenge's own "don't hand over the cause" design (the
symptom and the trap above are genuinely all `instructions`/`description`
say — see Epic #431), this README stops short of stating the winning fix or
the exact grading thresholds — reading this file should not be a shortcut
around diagnosing it yourself. The full breakdown, including the measured
numbers behind the thresholds, ships in this problem's post-solve `writeup`
(`metadata.json`), unlocked once you actually clear all three checkpoints
below.

## How scoring works

The platform holds no answer and never reads the submission text. On each
"submit", the local scoring API forwards `{ checkpointId, submission }` to
the container's loopback `/verify` (`POST http://127.0.0.1:18501/verify`),
which runs a REAL `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` against the
fixed target query and returns `{ checkpointId, correct, message }`:

| checkpoint                              | what it actually checks                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `orders-customer-id-leads-an-index`     | does some index on `storefront.orders` have a column list that OPENS with `customer_id`? (Not "contains" — the red herring contains it too, just not first.) |
| `target-query-uses-customer-id-led-index` | does the plan's ACTUAL chosen index (its `Index Name`) belong to the set of indexes led by `customer_id`? (Not "is there no Seq Scan" — see the trap above.) |
| `buffers-dramatically-reduced`          | has the current buffer count dropped sharply below a baseline captured once at container boot (red herring index only, before any fix)? |

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
  "challengeEndpoints": { "Info": "http://127.0.0.1:18500" },
  "verifyUrl": "http://127.0.0.1:18501/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "db-challenge-slow-query" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 100 pts total … ] }
```

```
db-challenge-slow-query/
├── metadata.json                # runtime (docker/compose) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # one service, loopback-only ports + healthcheck
    ├── Dockerfile                # postgres:16-alpine ("participant" stage) + node
    ├── entrypoint.sh             # boot pg, apply schema (incl. red-herring index), seed once, start app
    ├── app/
    │   ├── server.mjs           # info/status page (:8080) + /verify (:8081); captures baseline on boot
    │   ├── pg-client.mjs        # live Postgres adapter (EXPLAIN runner, leading-column check, baseline)
    │   └── package.json         # the `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # the 3 checkpoints (pure, dependency-injected)
    │   └── grade.test.mjs       # unit tests with fake clients, incl. red-herring/shallow-fix cases (bun test, no live DB)
    └── db/
        ├── schema.sql           # storefront.customers/orders, red-herring index, grading.baseline_buffers, participant role
        └── seed.sql             # 5,000 customers + 300,000 orders, generated set-based
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
