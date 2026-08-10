# db-a7-mvcc — Row versions and why reads don't block

A self-contained **local-play** Drill for TenkaCloud's Database Track (Phase 1,
Chapter 2, Drill A7). It runs entirely in Docker — no AWS account, no cloud
resources — and uses the container `/verify` scoring contract, graded per
checkpoint (`scoring.kind: "multi-verify"`, TenkaCloud#2252).

> Training target. The compose file binds it to `127.0.0.1` only; never expose
> it off loopback.

## Play it

```bash
make local PROBLEM=db-a7-mvcc   # from the TenkaCloud repo root
# opens the Participant Portal; log in with any non-empty key
```

- **Challenge surface:** the actual work happens over `psql` in the Portal's
  embedded terminal, not in a browser. <http://127.0.0.1:18450> is a small
  read-only info/status page.
- **Goal:** confirm a read is never blocked by an in-progress write, read
  `xmin`/`xmax` directly, then open a long-running `repeatable read`
  transaction, churn `mvcc.tickets` from a second session, watch `VACUUM` fail
  to reclaim the dead tuples it created, close the transaction, and watch a
  second `VACUUM` succeed.

If your Portal build has no embedded terminal yet, you can reach the same
database from your own machine's terminal:

```bash
docker compose -f local/docker-compose.yml exec db-a7-mvcc \
  psql -U participant -d drill
```

## The story

`mvcc.tickets` has 5 rows. `mvcc.reference` has 1 row that never takes part.
A6 showed that two `UPDATE`s against the same row wait on each other's row
lock. This drill is the opposite contrast: a `SELECT` against a row with an
uncommitted write in progress is **never** blocked — it just sees the last
committed version. That's MVCC (Multi-Version Concurrency Control): Postgres
adds new row versions instead of overwriting in place, and readers only ever
see whichever version was already committed when their own snapshot was
taken. But keeping old versions around has a cost — dead tuples — and
`VACUUM`'s ability to reclaim them can be stalled by a transaction that's
been left open too long.

## The domain

| Table | Columns |
| --- | --- |
| `mvcc.tickets` | `id` (PK), `status`, `version` — 5 rows, all `status='open'`, `version=1` |
| `mvcc.reference` | `id` (PK), `note` — 1 row, `note='do-not-touch'` |
| `audit.churn_log` | `log_id`, `ticket_id`, `op`, `backend_pid`, `logged_at`, `concurrent_long_tx_started_at` — append-only, written ONLY by a trigger on `mvcc.tickets` |

`autovacuum_enabled=false` on `mvcc.tickets` — dead tuples only shrink when
you run `VACUUM` yourself, on your own schedule, not whenever autovacuum
happens to wake up.

## Watch it, block it, then unblock it

```sql
-- 1. Update one row, don't commit.
begin;
update mvcc.tickets set status = 'closed' where id = 1;
select xmin, xmax, status from mvcc.tickets where id = 1; -- your own session sees the new value

-- 2. From the SAME terminal, a plain (non-backgrounded) second psql SELECT
--    — never blocked, unlike A6's write-vs-write case:
\! psql -U participant -d drill -c "select id, status from mvcc.tickets where id = 1;"
-- sees the OLD value: reads never wait on an uncommitted write.
commit;

-- 3. Open a long-running transaction that actually pins a snapshot:
begin transaction isolation level repeatable read;
select count(*) from mvcc.tickets; -- this query is what establishes the snapshot

-- 4. From a second session, churn (never blocked — no row lock is held):
\! psql -U participant -d drill -c "do \$\$ begin for i in 1..30 loop update mvcc.tickets set status = 'churn-' || i, version = version + 1 where id = ((i % 5) + 1); end loop; end \$\$;"
select n_live_tup, n_dead_tup from pg_stat_user_tables where schemaname='mvcc' and relname='tickets';
-- n_dead_tup jumped up

-- 5. VACUUM while the long transaction is still open — it can't reclaim:
\! psql -U participant -d drill -c "vacuum (verbose) mvcc.tickets;"
-- "... are dead but not yet removable"
select n_dead_tup from pg_stat_user_tables where relname='tickets'; -- unchanged

-- 6. Close the long transaction, then VACUUM again:
rollback;
\! psql -U participant -d drill -c "vacuum (verbose) mvcc.tickets;"
-- "... removed"
select n_dead_tup from pg_stat_user_tables where relname='tickets'; -- ~0
```

Numbers above are from a real local run while authoring this drill (see
"Numbers behind the thresholds" below) — expect the same shape, not
necessarily the exact same digits, on your machine.

## How scoring works

The platform holds no answer and never reads the submission text. On each
"submit", the local scoring API forwards `{ checkpointId, submission }` to
the container's loopback `/verify` (`POST http://127.0.0.1:18451/verify`),
which queries the CURRENT state of `mvcc.reference`, `pg_stat_user_tables`,
and `audit.churn_log`, and returns `{ checkpointId, correct, message }`:

| checkpoint | what it actually checks |
| --- | --- |
| `reference-untouched` | is `mvcc.reference`'s content, which never takes part in this drill, unchanged? |
| `long-transaction-blocked-cleanup-observed` | in `audit.churn_log`, did enough writes land while another session genuinely held a snapshot-pinning transaction open (`pg_stat_activity.backend_xmin` non-null, not just `begin;` with no query)? |
| `dead-tuples-reclaimed` | after enough churn happened (cumulative `n_tup_upd`/`n_tup_del`), is the current `n_dead_tup` small? |

You can re-scan as many times as you like; each checkpoint is independent and
worth 30 / 40 / 30 of the 100-point total.

### Why participant owns `mvcc.tickets` (unlike A6's `inventory.stock`)

`VACUUM` requires table ownership (or superuser) on PostgreSQL 16 — the
`MAINTAIN` privilege that would let a non-owner run it without ownership only
arrived in PostgreSQL 17, one major version after the `postgres:16-alpine`
image this drill (like A1-A6) is built on. Without ownership, `participant`
could never run the `VACUUM` this drill's whole point depends on. That
reopens the same tradeoff A6's `inventory.stock` design closed off — an owner
can `ALTER TABLE ... DISABLE TRIGGER` on their own table, silencing
`audit.churn_log` — but for the same reason A6 accepted a related tradeoff:
losing the audit trail only makes the checkpoints that depend on it *harder*
to pass, never easier, so it's not a route to a false pass (confirmed
directly: with the trigger disabled, `INSERT`ing a fabricated row into
`audit.churn_log` still fails with a permission error — that table stays
superuser-owned regardless of who owns `mvcc.tickets`).

### Why `backend_xmin`, not just "some other session is open"

A checkpoint that only asked "was another session idle-in-transaction while
the churn happened" would be too weak: a plain `begin;` with no query run
inside it holds no snapshot at all, and a default READ COMMITTED transaction
releases its per-statement snapshot the instant each statement finishes —
neither one blocks VACUUM even slightly (confirmed empirically while
authoring this drill: a bare `begin;` held open during 30 churn writes did
not stop the very next VACUUM from reclaiming all 30). Only a transaction
that has actually established and is still holding a snapshot — e.g.
`repeatable read` after running one query — keeps
`pg_stat_activity.backend_xmin` populated for as long as it stays open, which
is exactly the condition that keeps VACUUM from reclaiming rows that
transaction might still need to see. `local/db/schema.sql`'s trigger reads
`backend_xmin` (visible to it as the security-definer owner, unmasked
regardless of who's asking) specifically so `long-transaction-blocked-cleanup-observed`
tests for a transaction that could genuinely have blocked cleanup, not merely
one that happened to be open.

### Numbers behind the thresholds

Measured against a real Postgres 16 instance while authoring this drill (not
against the shipped Docker image itself — see "Verification" in the PR this
problem shipped in for why):

| state | `n_dead_tup` after churn | VACUUM while long tx open | VACUUM after closing it |
| --- | --- | --- | --- |
| 30-row churn, long tx = plain `begin;` (no query) | 30 | reclaims all 30 anyway | n/a |
| 30-row churn, long tx = `repeatable read` + 1 query | 30 | 0 removed, 30 "not yet removable" | 30 removed, 0 remain |
| 30-row churn, no long tx open at all | 30 | (immediate VACUUM) 30 removed | n/a |

The first row is why `backend_xmin` matters, not just "some session is open":
a transaction that never established a snapshot cannot block VACUUM no matter
how long it sits there.

## Delivery model

`metadata.json` declares a container runtime instead of a CloudFormation
template, plus an embedded Portal terminal (`runtime.terminal`) so no host
tooling is required:

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18450" },
  "verifyUrl": "http://127.0.0.1:18451/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "db-a7-mvcc" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 100 pts total … ] }
```

```
db-a7-mvcc/
├── metadata.json                # runtime (docker/compose) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # one service, loopback-only ports + healthcheck
    ├── Dockerfile                # postgres:16-alpine ("participant" stage) + node
    ├── entrypoint.sh             # boot pg, apply schema, seed once, start app
    ├── app/
    │   ├── server.mjs           # info/status page (:8080) + /verify (:8081)
    │   ├── pg-client.mjs        # live Postgres adapter (reference, ticket stats, churn_log)
    │   └── package.json         # the `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # the 3 checkpoints (pure, dependency-injected)
    │   └── grade.test.mjs       # unit tests with fake clients (bun test, no live DB)
    └── db/
        ├── schema.sql           # mvcc.tickets (owned by participant), mvcc.reference, audit.churn_log + trigger
        └── seed.sql             # 5 + 1 rows
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
