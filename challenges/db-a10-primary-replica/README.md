# db-a10-primary-replica — a replica is not a copy, it follows

A self-contained **local-play** Drill for TenkaCloud's Database Track (Phase 1,
Chapter 3, Drill A10). It runs entirely in Docker — no AWS account, no cloud
resources — and uses the container `/verify` scoring contract, graded per
checkpoint (`scoring.kind: "multi-verify"`, TenkaCloud#2252).

Unlike every prior Database Track drill (A1-A8, A12), this one uses **2
containers**: `primary` and `replica`, connected by real PostgreSQL physical
streaming replication.

> Training target. Both services bind to `127.0.0.1` only; never expose them
> off loopback.

## Play it

```bash
make local PROBLEM=db-a10-primary-replica   # from the TenkaCloud repo root
# opens the Participant Portal; log in with any non-empty key
```

- **Challenge surface:** the actual work happens over `psql` in the Portal's
  embedded terminal (which lands you inside the `primary` container), not in
  a browser. <http://127.0.0.1:18480> is a small read-only info/status page.
- **Goal:** confirm the primary/replica topology is genuinely streaming
  (not a one-time copy) by writing to the primary twice, at two separate
  moments, and watching both writes reach the replica.

If your Portal build has no embedded terminal yet, you can reach the same
databases from your own machine's terminal:

```bash
docker compose -f local/docker-compose.yml exec primary \
  psql -U participant -d drill

# the replica is also published directly to the host:
psql -h 127.0.0.1 -p 18482 -U participant -d drill
```

## The story

Every prior drill in this track ran inside one PostgreSQL container. Real
PostgreSQL operations almost always involve replication — for read scaling,
for failover. This drill wires up the minimum real thing: one primary, one
streaming replica, connected by `pg_basebackup` and physical WAL streaming —
**the wiring itself happens automatically at container boot**; the drill is
about confirming what that wiring actually does, not building it.

The core surprise this drill is built to walk through: a single write landing
on the replica does not, by itself, prove much — it could be explained by "a
copy happened to be taken right after that write." A SECOND write, at a
separate later moment, also landing on the replica is what actually
distinguishes a live streaming replica from a one-time snapshot.

## The domain

| Node | Role |
| --- | --- |
| `primary` | Normal read/write PostgreSQL. Owns `app.ledger` (participant-writable), the `replicator` role, and the physical replication slot `db_a10_replica`. Runs the Node info/verify app — this is also the `runtime.terminal` target. |
| `replica` | A hot standby, built by `pg_basebackup -R` against `primary` at boot. Always in recovery mode (`pg_is_in_recovery() = true`) — it rejects regular DML from every role, including superusers. No Node app; reachable from the primary's terminal at the compose service name `replica`, and published directly to the host at `127.0.0.1:18482`. |

`app.ledger` starts empty. Every row in it is one the participant wrote
themselves, tagged `'wave-1'` or `'wave-2'`.

## Confirm streaming, write twice, watch it follow

```sql
-- On the primary (psql -U participant -d drill):
select application_name, state, sync_state from pg_stat_replication;
-- 1 row, state = streaming

insert into app.ledger (note) values ('wave-1'), ('wave-1'), ('wave-1');

-- On the replica (psql -h replica -U participant -d drill):
select pg_is_in_recovery();                                  -- t
select count(*) from app.ledger where note = 'wave-1';        -- 3

-- Back on the primary, a second, later write:
insert into app.ledger (note) values ('wave-2'), ('wave-2'), ('wave-2');

-- On the replica again:
select count(*) from app.ledger where note = 'wave-2';        -- 3, arrived independently

-- On the primary, "caught up" as a number:
select sent_lsn, replay_lsn, pg_wal_lsn_diff(sent_lsn, replay_lsn) as lag_bytes
from pg_stat_replication;                                     -- lag_bytes near 0
```

This exact sequence (2-node, `pg_basebackup -R`, a physical replication slot,
2 waves of writes, LSN diffing) was run against a real, host-installed
PostgreSQL 16 primary + standby pair while authoring this drill — see
"Verification" in the PR this problem shipped in for the actual measured
numbers (LSNs matched, `lag_bytes` was 0 once caught up, both waves arrived on
the replica independently).

## How scoring works

The platform holds no answer and never reads the submission text. On each
"submit", the local scoring API forwards `{ checkpointId, submission }` to the
`primary` container's loopback `/verify` (`POST http://127.0.0.1:18481/verify`),
which queries the CURRENT state of BOTH nodes (`pg_stat_replication` /
`pg_stat_wal_receiver` on primary/replica, and `app.ledger` on both) and
returns `{ checkpointId, correct, message }`:

| checkpoint | what it actually checks |
| --- | --- |
| `streaming-replication-active` | exactly 1 `state = streaming` row in the primary's `pg_stat_replication`, AND the replica reports `pg_is_in_recovery() = true` and `pg_stat_wal_receiver.status = streaming` |
| `writes-follow-to-replica` | the primary has exactly 3 `'wave-1'` and 3 `'wave-2'` rows in `app.ledger`, AND the replica has the SAME counts |
| `replica-caught-up` | `pg_wal_lsn_diff(sent_lsn, replay_lsn)` from the primary's `pg_stat_replication` row is small (≤ 1 MiB — generous for a handful of tiny INSERTs) |

You can re-scan as many times as you like; each checkpoint is independent and
worth 30 / 40 / 30 of the 100-point total.

### Why this drill needs no `audit` schema (unlike A6-A8/A12)

Every prior Database Track drill needed an append-only `audit` schema
(populated only by a trigger, never by participant DML) as an anti-cheat,
because a participant with ordinary read/write access to their own table
could otherwise fabricate the "did the real thing happen" signal. This drill
does not need one: **a PostgreSQL server in recovery mode (a standby) rejects
ALL regular DML from every role, including superusers** — confirmed directly
on a real Postgres 16 instance while authoring this drill (`GRANT` and other
DDL against the standby itself also fail with
`cannot execute ... in a read-only transaction`). There is no privilege on
either node that lets a participant write directly into the replica's
`app.ledger`. A matching row count between primary and replica can therefore
only be explained by genuine WAL replay — the replica's own read-only nature
IS the anti-cheat.

### Why 2 waves, not 1

A single write reaching the replica proves a copy happened at least once — it
cannot rule out "a snapshot taken right after that write happened to include
it." The drill's instructions ask for a SECOND write, at a separate later
moment, specifically so `writes-follow-to-replica` can require both — proving
the replica is *continuously* following changes, not a one-shot copy.

## Delivery model

`metadata.json` declares a container runtime instead of a CloudFormation
template, plus an embedded Portal terminal (`runtime.terminal`) attached to
the `primary` service only (SCHEMA.json's constraint: a terminal can only
attach to the one declared service, and that service must be `target:
participant`):

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18480" },
  "verifyUrl": "http://127.0.0.1:18481/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "primary" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 100 pts total … ] }
```

```
db-a10-primary-replica/
├── metadata.json                # runtime (docker/compose, 2 services) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # primary + replica, loopback-only ports, depends_on: service_healthy
    ├── Dockerfile                # postgres:16-alpine, 2 targets: "participant" (primary, +node) / "replica"
    ├── entrypoint-primary.sh     # boot pg (replication-ready config), apply schema (role+slot), start app
    ├── entrypoint-replica.sh     # wait for primary, pg_basebackup -R, boot as standby
    ├── app/
    │   ├── server.mjs           # info/status page (:8080) + /verify (:8081) — connects to BOTH nodes
    │   ├── pg-client.mjs        # live Postgres adapter (replication rows, recovery state, ledger counts)
    │   └── package.json         # the `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # the 3 checkpoints (pure, dependency-injected)
    │   └── grade.test.mjs       # unit tests with fake clients (bun test, no live DB)
    └── db/
        └── schema.sql           # app.ledger (participant-owned), replicator role, replication slot
```

## Run the grader unit tests

The grader's pass/fail logic is unit-tested with injected fakes — no live
Postgres, no network:

```bash
cd local/grader && bun test
```

## FLAG_SEED

Injected by `make local` for every local-play problem, but unused here: every
checkpoint reads live replication/database state, not a discovered secret.
