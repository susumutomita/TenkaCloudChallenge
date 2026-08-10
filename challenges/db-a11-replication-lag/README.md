# db-a11-replication-lag — induce it, observe it, resolve it

A self-contained **local-play** Drill for TenkaCloud's Database Track (Phase 1,
Chapter 3, Drill A11). It runs entirely in Docker — no AWS account, no cloud
resources — and uses the container `/verify` scoring contract, graded per
checkpoint (`scoring.kind: "multi-verify"`, TenkaCloud#2252).

Same 2-node topology as its prerequisite, db-a10-primary-replica (`primary` +
`replica`, real physical streaming replication), deployed independently — this
problem does not share containers with A10.

> Training target. Both services bind to `127.0.0.1` only; never expose them
> off loopback.

## Play it

```bash
make local PROBLEM=db-a11-replication-lag   # from the TenkaCloud repo root
# opens the Participant Portal; log in with any non-empty key
```

- **Challenge surface:** the actual work happens over `psql` in the Portal's
  embedded terminal (which lands you inside the `primary` container), not in
  a browser. <http://127.0.0.1:18490> is a small read-only info/status page.
- **Goal:** deliberately throttle the replica's apply via
  `recovery_min_apply_delay`, write to the primary, and watch
  `pg_stat_replication.replay_lag` actually grow — then restore the delay,
  write again, and watch it actually shrink back down.

If your Portal build has no embedded terminal yet, you can reach the same
databases from your own machine's terminal:

```bash
docker compose -f local/docker-compose.yml exec primary \
  psql -U participant -d drill

# the replica is also published directly to the host:
psql -h 127.0.0.1 -p 18492 -U participant -d drill
```

## The story

`recovery_min_apply_delay` is a real PostgreSQL setting: it tells a standby to
deliberately wait N seconds after RECEIVING a WAL record before actually
APPLYING it. WAL still streams over immediately as usual (`sent_lsn` /
`flush_lsn` on the primary advance without delay) — only the apply step is
held back. This is genuinely useful in production (a deliberately delayed
replica is a recovery buffer against operator mistakes: pause recovery before
a bad `DROP TABLE`'s WAL gets applied, and the pre-mistake state is still
there). Here, it is the knob the participant uses to make lag happen on
purpose, safely, in a sandbox with nothing at stake.

The surprising part measured while authoring this drill: `replay_lag` is not
a continuously ticking counter. It is only recomputed the instant the primary
receives feedback from the standby about a fresh apply. Between applies, it
holds whatever value it last computed — which is exactly why resetting the
delay alone does not immediately show a low `replay_lag`; a further write is
needed to produce a fresh, low sample.

## The domain

Same 2-node shape as A10 (see that drill's README for the primary/replica
role table), plus this drill's own additions:

| Object | Purpose |
| --- | --- |
| `app.events` (primary, participant-owned) | Freely INSERT-able — used to generate write load while apply is throttled. |
| `GRANT ALTER SYSTEM ON PARAMETER recovery_min_apply_delay TO participant` | The ONE GUC `participant` may change (PostgreSQL 15+'s fine-grained privilege) — granted on the primary (a standby rejects all regular DML/DDL, including GRANT), and replicates automatically since roles/parameter ACLs are shared, cluster-wide catalogs. |
| `GRANT EXECUTE ON FUNCTION pg_reload_conf() TO participant` | Lets `participant` make an `ALTER SYSTEM SET` take effect without a restart. |
| `audit.lag_samples` | A continuous history of `pg_stat_replication.replay_lag`, sampled roughly once a second by the primary's Node app for the whole container lifetime — never by participant DML. This is what makes a transient spike (and its later resolution) visible to the grader even though neither is happening at the exact instant `/verify` gets called. |

## Throttle it, watch lag grow, restore it, watch lag shrink

```sql
-- On the replica (psql -h replica -U participant -d drill):
alter system set recovery_min_apply_delay = '8s';
select pg_reload_conf();

-- Back on the primary:
insert into app.events (payload) select 'load-' || g from generate_series(1, 20) g;

-- A few seconds later, on the primary:
select replay_lag from pg_stat_replication;    -- ~8s

-- On the replica again:
alter system set recovery_min_apply_delay = '0';
select pg_reload_conf();

-- On the primary — a FURTHER write is required to refresh the stale replay_lag:
insert into app.events (payload) values ('recovered');

-- A few seconds later:
select replay_lag from pg_stat_replication;    -- back near 0
```

This exact sequence (grant, throttle, spike, restore, resolve) was run against
a real, host-installed PostgreSQL 16 primary + standby pair while authoring
this drill — see "Verification" in the PR this problem shipped in for the
actual measured numbers (the induced delay showed up almost exactly as
configured, and lag settled back to sub-millisecond values after the reset +
further write).

## How scoring works

The platform holds no answer and never reads the submission text. On each
"submit", the local scoring API forwards `{ checkpointId, submission }` to the
`primary` container's loopback `/verify` (`POST http://127.0.0.1:18491/verify`),
which queries live replication state plus the FULL `audit.lag_samples` history
and returns `{ checkpointId, correct, message }`:

| checkpoint | what it actually checks |
| --- | --- |
| `streaming-replication-topology-active` | same structural baseline as A10 — is streaming actually connected |
| `lag-induced` | does `audit.lag_samples` contain a sample with `replay_lag_seconds` ≥ 3? |
| `lag-resolved` | are the most recent 5 samples ALL < 1 second, AND does an EARLIER sample (before that recent window) show a ≥ 3 second spike? |

You can re-scan as many times as you like; each checkpoint is independent and
worth 20 / 40 / 40 of the 100-point total.

### Why `lag-resolved` also re-checks for an earlier spike

A replica that was NEVER throttled also has near-zero lag the entire time —
that alone must not pass `lag-resolved` (it never demonstrated fixing
anything). Requiring an earlier sample to have crossed the induce threshold,
before the recent low window, is what actually encodes "you produced lag, and
THEN resolved it" rather than "it happened to always be fine".

### Why this drill needs a continuous sample history, not a live query

`pg_stat_replication.replay_lag` is stale between applies (see "The story"
above) — confirmed directly on a real Postgres 16 instance. A single query at
the exact moment `/verify` is called could land in a stale gap and see
neither the induced spike nor the later recovery. `audit.lag_samples`, sampled
by the primary's Node app roughly once a second for the whole container
lifetime, is what lets grading see both moments even when neither is
happening right now — the same role every prior Database Track drill's
trigger-populated `audit` schema plays for a different kind of transient fact.

## Delivery model

`metadata.json` declares a container runtime instead of a CloudFormation
template, plus an embedded Portal terminal (`runtime.terminal`) attached to
the `primary` service only — same shape as A10:

```jsonc
"runtime": {
  "provider": "docker",
  "engine": "compose",
  "entry": "local/docker-compose.yml",
  "challengeEndpoints": { "Info": "http://127.0.0.1:18490" },
  "verifyUrl": "http://127.0.0.1:18491/verify",
  "secretEnv": ["FLAG_SEED"],
  "terminal": { "service": "primary" }
},
"scoring": { "kind": "multi-verify", "checks": [ … 3 checkpoints, 100 pts total … ] }
```

```
db-a11-replication-lag/
├── metadata.json                # runtime (docker/compose, 2 services) + scoring (multi-verify) + hints
└── local/
    ├── docker-compose.yml       # primary + replica, loopback-only ports, depends_on: service_healthy
    ├── Dockerfile                # postgres:16-alpine, 2 targets: "participant" (primary, +node) / "replica"
    ├── entrypoint-primary.sh     # boot pg (replication-ready config), apply schema (role+slot+GUC grants), start app
    ├── entrypoint-replica.sh     # wait for primary, pg_basebackup -R, boot as standby
    ├── app/
    │   ├── server.mjs           # info/status page (:8080) + /verify (:8081) — starts the background lag sampler
    │   ├── pg-client.mjs        # live Postgres adapter + startLagSampler (writes audit.lag_samples on a timer)
    │   └── package.json         # the `postgres` JS driver
    ├── grader/
    │   ├── grade.mjs            # the 3 checkpoints (pure, dependency-injected)
    │   └── grade.test.mjs       # unit tests with fake clients (bun test, no live DB)
    └── db/
        └── schema.sql           # app.events (participant-owned), replicator role, replication slot, GUC grants, audit.lag_samples
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
