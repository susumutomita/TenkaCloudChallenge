# The Database Is Slow, Apparently (`db-battle-slow-apparently`)

**Battle · difficulty 4 · 45-75 min · runs entirely in Docker · USD 0**

Since around 03:00, the order API's p99 latency has been over SLO. Some users report
that changes they just made are not showing up yet. Production traffic cannot be
stopped. The screen shows an operator note: "DB CPU looks high, consider scaling up" --
that is not the answer, just the premature diagnosis a real on-call engineer sees all
the time.

Nothing in the player-facing text says what is actually wrong. Finding that out **is**
the exercise.

## The story (do not read this section before playing -- it is the internal design note)

A retention worker deletes old orders once a day. The `commerce.orders` table is already
RANGE-partitioned by month, but the retention worker predates that migration and never
got updated: it still runs `DELETE FROM commerce.orders WHERE created_at < cutoff` as one
giant, uncommitted transaction, ignoring the partitions entirely. Each deleted row passes
through a BEFORE DELETE trigger that logs it (a realistic, if expensive, audit-trail
trigger) -- real CPU work, not a fake delay, so it genuinely competes with the order API
for the primary's cpu-limited share and measurably degrades p99. While that long
transaction runs, the primary's own background sampler dials up the replica's real
`recovery_min_apply_delay` in proportion to the transaction's actual duration, producing
completely real, if scenario-triggered, replication lag.

The correct response: diagnose the real mechanism from evidence, safely cancel the
offending transaction without stopping production writes, finish the cleanup the cheap
way (`DETACH PARTITION` + `DROP TABLE`, not row-by-row `DELETE`), and fix the retention
worker's own strategy so the same job does not misbehave again tomorrow.

## The 4 phases

1. **Diagnose** -- submit a structured diagnosis (`bin/diagnose.mjs`): the real backend
   pid, the real mechanism, the real trigger, and the one safe first action. No free text.
2. **Contain** -- `pg_cancel_backend()` the offending session without stopping writes,
   restarting anything, or disabling the replica.
3. **Clean up correctly** -- check whether the target table is actually partitioned
   before choosing how to remove the old data. The wrong-but-working method (row-level
   `DELETE`) still completes, but never earns full marks.
4. **Prevent recurrence** -- flip `ops.retention_config` to the safe strategy and let the
   job's own periodic re-check finish the held-back partition without breaching SLO.

## Scoring (multi-verify, 7 checkpoints, 1000 pts)

Every checkpoint reads only Postgres's own catalog and `audit.*` tables the participant
cannot write to (`incident_log`, `metrics_samples`, `diagnosis_log`,
`deleted_orders_log`). Nothing passes on self-report or a fixed-string match. See
`metadata.json`'s `description` field for the full breakdown.

One rule is worth calling out because it looks like it could be read off
`ops.retention_config` and must not be: the held-back 2024-07 partition's "still
intact" requirement is released by a recorded `audit.incident_log` episode (a
`partition_aware` run that actually committed against it), never by the configured
cutoff date. The cutoff is the one row the participant is handed `UPDATE` on, so gating
on it would let "destroy the held-back data first, then widen your own cutoff" pass
unpunished.

## Runtime boundary (what the participant's container holds)

The Portal terminal attaches to the `workstation` service, built from the Dockerfile's
`participant` stage. That image holds `psql`, `node`, and `bin/diagnose.mjs` -- and
deliberately not `grader/` (which contains the Phase 1 answer key, the purge-target
partition list and the widened cutoff) or `db/schema.sql` (whose banner narrates the
whole scenario). Those are copied only into the `primary` image, which runs Postgres and
the grader and which nobody gets a shell on.

The database enforces the same split at the connection layer: `local/entrypoint-primary.sh`
writes `pg_hba.conf` wholesale so that only `participant`, `app_service` and
`retention_service` may run SQL across the compose network, and the `postgres` superuser
needs either the primary container's own local socket or a password derived from the
per-run `FLAG_SEED` (which the workstation never receives). The lab stays fully playable
from the workstation: `participant` keeps `pg_read_all_stats`, `pg_signal_backend`,
`SELECT`/`UPDATE` on `ops.retention_config`, and `DETACH`/`DROP`/`DELETE` on the commerce
leaf partitions through `orders_owner` -- but `SELECT` only on `audit.*`.

## Local play

```bash
cd local
docker compose -p db-battle-slow-apparently up -d
# Info:   http://127.0.0.1:18580
# Verify: POST http://127.0.0.1:18581/verify {"checkpointId": "..."}
# Play:   docker compose -p db-battle-slow-apparently exec workstation sh
docker compose -p db-battle-slow-apparently down --volumes --remove-orphans
```

The grader's unit tests need neither Docker nor Postgres:

```bash
bun test battles/db-battle-slow-apparently/local/grader/grade.test.mjs
```

Always pass `-p db-battle-slow-apparently` explicitly (TenkaCloudChallenge#521): every
local-play problem's compose file lives at a path ending in `.../local/`, so the default
project-name-from-directory-name makes every problem's project "local", and a bare
`docker compose down` can sweep up unrelated problems' containers on a shared host. This
problem's own `local/docker-compose.yml` also pins `name:` explicitly for the same reason.

## Scope note

Issue #430 asks for two seed variants (Variant A: partitioned; Variant B: unpartitioned +
keyset + adaptive throttle) plus seed-varied boundaries/pids to resist hardcoding. This
PR ships **Variant A only** as a complete, working increment. Variant B and seed variance
are tracked as follow-up work -- see the PR description's "Known incomplete work".
