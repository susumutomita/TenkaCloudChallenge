# db-a4-transaction — Transactions and atomicity

A self-contained **local-play** Drill for TenkaCloud's Database Track (Phase 1,
Chapter 2, Drill A4). It runs entirely in Docker — no AWS account, no cloud
resources — and uses the container `/verify` scoring contract, graded per
checkpoint (`scoring.kind: "multi-verify"`, TenkaCloud#2252).

> Training target. The compose file binds it to `127.0.0.1` only; never expose
> it off loopback.

## Play it

```bash
make local PROBLEM=db-a4-transaction   # from the TenkaCloud repo root
# opens the Participant Portal; log in with any non-empty key
```

- **Challenge surface:** the actual work happens over `psql` in the Portal's
  embedded terminal, not in a browser. <http://127.0.0.1:18430> is a small
  read-only info/status page (also shows the live balances and `xmin`).
- **Goal:** transfer 1000 cents from alice (id 1) to bob (id 2) as a single
  atomic unit.

If your Portal build has no embedded terminal yet, you can reach the same
database from your own machine's terminal:

```bash
docker compose -f local/docker-compose.yml exec db-a4-transaction \
  psql -U participant -d drill
```

## The story

`bank.accounts` has 3 rows: alice, bob, carol. A transfer from alice to bob
can only be expressed as two independent `UPDATE` statements. Run them with
no transaction around them, and a failure partway through leaves a state
where only one of them took effect — money that got created (or destroyed)
out of nowhere.

## The domain

| Table | Columns |
| --- | --- |
| `bank.accounts` | `id` (PK), `owner`, `balance_cents` (`check (balance_cents >= 0)`) — 3 rows: alice=3000, bob=10000, carol=7000 |

## Break it, protect it, then do it correctly

```sql
-- 1. No transaction: try to transfer more than alice has (5000 cents).
update bank.accounts set balance_cents = balance_cents + 5000 where id = 2; -- credits bob, succeeds
update bank.accounts set balance_cents = balance_cents - 5000 where id = 1; -- debits alice, ERROR (check violation)
select sum(balance_cents) from bank.accounts;
-- 25000, not 20000 — bob got paid, alice was never actually charged.

-- 2. Clean it up by hand (nothing undoes this automatically without a transaction):
update bank.accounts set balance_cents = balance_cents - 5000 where id = 2;

-- 3. Same doomed transfer, this time inside a transaction:
begin;
update bank.accounts set balance_cents = balance_cents + 5000 where id = 2;
update bank.accounts set balance_cents = balance_cents - 5000 where id = 1; -- same ERROR
-- any further command here says "current transaction is aborted" until you ROLLBACK
rollback;
select sum(balance_cents) from bank.accounts;
-- already 20000, no manual cleanup needed this time — bob's credit was never committed.

-- 4. See uncommitted invisibility with your own eyes, from ONE terminal:
begin;
update bank.accounts set balance_cents = balance_cents - 1000 where id = 1;
select balance_cents from bank.accounts where id = 1;               -- 2000 (your own writes are visible to you)
\! psql -U participant -d drill -c "select balance_cents from bank.accounts where id = 1;"
-- 3000 from the second, independent psql process (\! spawns it while your
-- transaction stays open, suspended, in the background) — an uncommitted
-- write is invisible to every other session.
rollback;

-- 5. The actual goal — commit it correctly:
begin;
update bank.accounts set balance_cents = balance_cents - 1000 where id = 1;
update bank.accounts set balance_cents = balance_cents + 1000 where id = 2;
commit;
```

Numbers above are from a real local run while authoring this drill (see
"Numbers behind the thresholds" below) — expect the same shape, not
necessarily the exact same digits, on your machine.

## How scoring works

The platform holds no answer and never reads the submission text. On each
"submit", the local scoring API forwards `{ checkpointId, submission }` to
the container's loopback `/verify` (`POST http://127.0.0.1:18431/verify`),
which queries the CURRENT state of `bank.accounts` (balances and the `xmin`
system column) and returns `{ checkpointId, correct, message }`:

| checkpoint | what it actually checks |
| --- | --- |
| `total-balance-conserved` | does `sum(balance_cents)` over the WHOLE table still equal the seeded total (20000)? Catches any leftover corruption anywhere, including a stray effect on carol (who never takes part in a transfer) |
| `transfer-applied-correctly` | is alice's balance exactly 2000 and bob's exactly 11000 — the specific expected end state of the one transfer this drill asks for? |
| `updates-committed-atomically` | do alice's and bob's CURRENT rows share the same `xmin` (the id of the transaction that last wrote each of them)? Reaching the right numbers via two separate autocommit statements fails this even though the other two checkpoints would pass |

You can re-scan as many times as you like; each checkpoint is independent and
worth 30 / 30 / 40 of the 100-point total.

### Numbers behind the thresholds

Measured against a real Postgres 16 instance while authoring this drill (not
against the shipped Docker image itself — see "Verification" in the PR this
problem shipped in for why):

| state | total | alice | bob | alice.xmin == bob.xmin |
| --- | --- | --- | --- | --- |
| untouched (seed) | 20000 | 3000 | 10000 | **no** (seeded via 2 separate INSERTs, on purpose) |
| after the no-tx demo, before cleanup | 25000 | 3000 | 15000 | no |
| after cleanup / after tx+ROLLBACK | 20000 | 3000 | 10000 | no |
| correct transfer via `begin`...`commit` | 20000 | 2000 | 11000 | **yes** |
| correct NUMBERS via 2 separate autocommit statements | 20000 | 2000 | 11000 | no |

The last row is the one `updates-committed-atomically` exists to catch: the
same final balances as the correct solution, reached without ever wrapping
the two writes in a transaction.

## Why `xmin` and not a "grading" baseline table

Unlike db-a2-index-tradeoff (whose scoring baseline depends on a runtime
`EXPLAIN` cost that cannot be known ahead of time), the target balances here
are fixed and known from `local/db/seed.sql` — 3000 / 10000 / 7000 — so they
are hard-coded in `local/grader/grade.mjs`, the same way db-a2's
`TARGET_ORDER_NUMBER` and db-a3's `RARE_VALUE`/`COMMON_VALUE` are: this is
exactly what the instructions tell the participant, not a hidden answer. No
extra `grading` schema is needed for this drill.

`xmin` is a system column Postgres stamps on every row with the id of the
transaction that most recently wrote it. Comparing alice's and bob's current
`xmin` values is a live, unfakeable fact about whether their current values
were written together, as one transaction — it cannot be satisfied by
guessing the right numbers alone.

## Delivery model

`metadata.json` declares a container runtime instead of a CloudFormation
template, plus an embedded Portal terminal (`runtime.terminal`) so no host
tooling is required:

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18430" },
  "verifyUrl": "http://127.0.0.1:18431/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "db-a4-transaction" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 100 pts total … ] }
```

```
db-a4-transaction/
├── metadata.json                # runtime (docker/compose) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # one service, loopback-only ports + healthcheck
    ├── Dockerfile                # postgres:16-alpine ("participant" stage) + node
    ├── entrypoint.sh             # boot pg, apply schema, seed once (3 rows), start app
    ├── app/
    │   ├── server.mjs           # info/status page (:8080) + /verify (:8081)
    │   ├── pg-client.mjs        # live Postgres adapter (balances, xmin)
    │   └── package.json         # the `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # the 3 checkpoints (pure, dependency-injected)
    │   └── grade.test.mjs       # unit tests with fake clients (bun test, no live DB)
    └── db/
        ├── schema.sql           # bank.accounts, participant role
        └── seed.sql             # 3 rows, via 3 SEPARATE INSERTs (see grade.test.mjs comment)
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
