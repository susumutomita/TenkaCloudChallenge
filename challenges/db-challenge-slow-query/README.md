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
| `buffers-dramatically-reduced`          | has the current buffer count dropped to `<= max(100, baseline * 0.3)`, where `baseline` was captured once at container boot (red herring index only, before any fix)? |

You can re-scan as many times as you like; each checkpoint is independent
and worth 30 / 30 / 40 of the 100-point total.

### Why "just add any index" — or "make the Seq Scan go away" — does not pass

The three checkpoints above are deliberately layered so that no single
shallow action passes all of them:

- Leaving the red herring alone, or adding an index on an unrelated column
  (say `total_cents` alone) — fails `orders-customer-id-leads-an-index` (its
  column list doesn't open with `customer_id`) AND fails
  `target-query-uses-customer-id-led-index` (the plan is still using the red
  herring, whose `Index Name` is not in the customer_id-led set).
- Reaching for a DIFFERENT index that still doesn't lead with `customer_id`
  (e.g. `(created_at desc, customer_id)`, a plausible-looking attempt that
  matches the `ORDER BY`) — the planner may even pick this one over the red
  herring, but it measures WORSE (see below), and its `Index Name` still
  isn't in the customer_id-led set, so checkpoint 2 fails regardless of
  buffers.
- Adding a correctly-ordered index but forgetting to `ANALYZE` — can pass
  checkpoint 1 (the index exists and leads with `customer_id`) but fails
  checkpoint 2 if stale statistics leave the planner still choosing the red
  herring (the same lesson as A3).
- Only a real fix — an index that leads with `customer_id`, actually chosen
  by the planner, with a measured buffer drop — passes all three.

### Numbers behind the thresholds

Measured against a real Postgres 16 instance while authoring this Challenge
(not against the shipped Docker image itself — see "Verification" in the PR
this problem shipped in for why). The red herring's partial, accidental
benefit (explained above) is why the baseline here is much lower than
db-a2-index-tradeoff's true "no index at all" baseline:

| state                                                        | plan (Index Name)                    | buffers (shared hit + read) |
| ---------------------------------------------------------------- | ------------------------------------------- | ------------------------------ |
| red herring index only (baseline)                                | `idx_orders_status_customer` (wrong leading column, still no Seq Scan) | 386                             |
| a DIFFERENT wrong-leading-column index (`(created_at desc, customer_id)`) | `idx_orders_created_customer` (also wrong)  | 396 — measured WORSE, not better |
| plain single-column `customer_id` index + `ANALYZE`               | `idx_orders_customer_id` (Bitmap Heap/Index Scan) | 65                              |
| composite `(customer_id, created_at desc)` index + `ANALYZE`      | `idx_orders_customer_created` (Index Scan, no separate Sort) | 26                              |

`buffers-dramatically-reduced`'s threshold (`max(100, baseline * 0.3)` ≈ 116
for this baseline) sits comfortably above both real fixes (65, 26) and
comfortably below both non-fixes (386, 396).

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
