# db-a6-lock — Row locks and being made to wait

A self-contained **local-play** Drill for TenkaCloud's Database Track (Phase 1,
Chapter 2, Drill A6). It runs entirely in Docker — no AWS account, no cloud
resources — and uses the container `/verify` scoring contract, graded per
checkpoint (`scoring.kind: "multi-verify"`, TenkaCloud#2252).

> Training target. The compose file binds it to `127.0.0.1` only; never expose
> it off loopback.

## Play it

```bash
make local PROBLEM=db-a6-lock   # from the TenkaCloud repo root
# opens the Participant Portal; log in with any non-empty key
```

- **Challenge surface:** the actual work happens over `psql` in the Portal's
  embedded terminal, not in a browser. <http://127.0.0.1:18440> is a small
  read-only info/status page.
- **Goal:** open a transaction that updates `widget`, leave it uncommitted,
  watch a second session block trying to update the same row, identify the
  blocker via `pg_locks`/`pg_stat_activity`, then commit so the second update
  can complete.

If your Portal build has no embedded terminal yet, you can reach the same
database from your own machine's terminal:

```bash
docker compose -f local/docker-compose.yml exec db-a6-lock \
  psql -U participant -d drill
```

## The story

`inventory.stock` has 2 rows: `widget` and `gadget`. `widget` is the one row
both sessions try to touch. Postgres locks at the row level: once a
transaction `UPDATE`s a row, no other transaction can complete an `UPDATE`
against that same row until the first one commits or rolls back — even though
a plain `SELECT` from a third session would never have been blocked (that was
A4's third move; this drill is the write-vs-write contrast).

## The domain

| Table | Columns |
| --- | --- |
| `inventory.stock` | `id` (PK), `sku`, `qty` (`check (qty >= 0)`) — 2 rows: widget=300, gadget=120 |
| `audit.lock_wait_log` | `log_id`, `stock_id`, `backend_pid`, `txid`, `stmt_started_at` — append-only, written ONLY by a trigger on `inventory.stock` |

`participant` does **not** own `inventory.stock` (unlike A4's
`bank.accounts`) — see "Why participant doesn't own the table" below.

## Block it, identify it, release it

```sql
-- 1. Session "blocker": start debiting widget, do not commit.
begin;
update inventory.stock set qty = qty - 100 where id = 1;

-- 2. From the SAME terminal, launch a second psql IN THE BACKGROUND (the &
--    matters — without it this line never returns, because the update it
--    runs is about to block on the row lock the blocker above is holding):
\! psql -U participant -d drill -c "update inventory.stock set qty = qty - 50 where id = 1;" > /tmp/a6-waiter.log 2>&1 &

-- 3. Back in the blocker session, confirm someone is genuinely stuck waiting:
select pid, wait_event_type, wait_event, state from pg_stat_activity where wait_event_type = 'Lock';
-- one row, state='active', wait_event_type='Lock' — that's the waiter.

-- 4. Identify the blocker's pid from the waiter's perspective:
select pid, pg_blocking_pids(pid) as blocked_by from pg_stat_activity where wait_event_type = 'Lock';
select pg_backend_pid(); -- confirm it matches YOUR OWN session (the blocker)

-- 5. Wait deliberately, then release the lock:
select pg_sleep(5);
commit;

-- 6. Check the background job finished cleanly, and the final numbers:
\! cat /tmp/a6-waiter.log
select * from inventory.stock order by id;
-- widget=150 (300-100-50), gadget=120 (untouched)
```

Numbers above are from a real local run while authoring this drill (see
"Numbers behind the thresholds" below) — expect the same shape, not
necessarily the exact same digits, on your machine.

## How scoring works

The platform holds no answer and never reads the submission text. On each
"submit", the local scoring API forwards `{ checkpointId, submission }` to
the container's loopback `/verify` (`POST http://127.0.0.1:18441/verify`),
which queries the CURRENT state of `inventory.stock` and `audit.lock_wait_log`
and returns `{ checkpointId, correct, message }`:

| checkpoint | what it actually checks |
| --- | --- |
| `gadget-untouched` | is gadget's quantity, which never takes part in this drill, unchanged at 120? |
| `widget-qty-correct` | is widget's quantity exactly 150 — reflecting BOTH the blocker's (-100) and the waiter's (-50) debits? |
| `row-lock-wait-observed` | in `audit.lock_wait_log`, did one backend's transaction genuinely COMMIT while a DIFFERENT backend's UPDATE on widget was still in flight? |

You can re-scan as many times as you like; each checkpoint is independent and
worth 30 / 30 / 40 of the 100-point total.

### Why participant doesn't own the table

A4's `bank.accounts` is owned by `participant` — fine there, because A4's
grading reads only the final row state (balances, `xmin`), and ownership
doesn't let you forge either of those. This drill is different: a single
before/after read of `widget.qty` cannot tell "two sessions genuinely
contended for the same row" apart from "two ordinary autocommit UPDATEs ran
back-to-back with no contention at all" — both reach the exact same number.
Grading needs a durable trail of what actually happened, which
`audit.lock_wait_log` provides (written only by a trigger — see
`local/db/schema.sql`). If `participant` owned `inventory.stock`, they could
`ALTER TABLE ... DISABLE TRIGGER` and silently defeat that trail — not a way
to pass without doing the work (a missing entry only makes the checkpoint
*harder* to pass, never easier), but still worth closing off. So
`inventory.stock` stays owned by the bootstrap superuser; `participant` gets
narrow `SELECT`/`UPDATE` grants instead.

### Why an overlap check, not a duration threshold

"This write took a long time" is not, by itself, proof of a lock wait — a
participant could make their OWN write look slow by embedding `pg_sleep()`
inside it, with no second session and no real contention at all. What
genuinely cannot be faked is the *relationship* between two different
sessions' write windows on the same row: if session B's transaction truly
committed **while** session A's UPDATE statement on that exact row was still
in flight, A was necessarily blocked on B's row lock — Postgres's own MVCC
concurrency control guarantees this for any two UPDATEs on the same row, and
there is no way to reach that timing relationship without the wait actually
happening. `local/grader/grade.mjs`'s `findGenuineLockWait()` looks for
exactly that overlap, using `pg_xact_commit_timestamp()` (Postgres's own
record of a transaction's TRUE commit instant — not a timestamp captured
mid-transaction by the audit trigger, which would be misleadingly early for a
blocker that deliberately keeps its transaction open after its own UPDATE
returns).

### Numbers behind the thresholds

Measured against a real Postgres 16 instance while authoring this drill (not
against the shipped Docker image itself — see "Verification" in the PR this
problem shipped in for why):

| state | widget | gadget | genuine lock wait found? |
| --- | --- | --- | --- |
| untouched (seed) | 300 | 120 | no (no writes at all) |
| only the blocker ran, waiter never launched | 200 | 120 | no |
| both ran, same psql session, no BEGIN at all | 150 | 120 | **no** (one backend_pid — never a second session) |
| both ran, different sessions, but sequentially (no overlap) | 150 | 120 | **no** (no temporal overlap) |
| both ran, right numbers, second session faked `pg_sleep()` alone | 150 | 120 | **no** (no genuine contention) |
| the real blocker/waiter flow above | 150 | 120 | **yes** |

The last two rows are why `row-lock-wait-observed` exists: the second-to-last
reaches the exact same final numbers as the real solution but is caught,
because a self-inflicted delay with no second party genuinely holding the row
cannot produce the commit-inside-statement-window overlap the real thing
does.

## Delivery model

`metadata.json` declares a container runtime instead of a CloudFormation
template, plus an embedded Portal terminal (`runtime.terminal`) so no host
tooling is required:

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18440" },
  "verifyUrl": "http://127.0.0.1:18441/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "db-a6-lock" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 100 pts total … ] }
```

```
db-a6-lock/
├── metadata.json                # runtime (docker/compose) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # one service, loopback-only ports + healthcheck
    ├── Dockerfile                # postgres:16-alpine ("participant" stage) + node
    ├── entrypoint.sh             # boot pg (track_commit_timestamp=on), apply schema, seed once, start app
    ├── app/
    │   ├── server.mjs           # info/status page (:8080) + /verify (:8081)
    │   ├── pg-client.mjs        # live Postgres adapter (quantities, lock_wait_log)
    │   └── package.json         # the `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # the 3 checkpoints + findGenuineLockWait (pure, dependency-injected)
    │   └── grade.test.mjs       # unit tests with fake clients (bun test, no live DB)
    └── db/
        ├── schema.sql           # inventory.stock, audit.lock_wait_log + trigger, participant role
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
