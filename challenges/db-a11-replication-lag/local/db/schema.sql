-- db-a11-replication-lag — primary-side schema.
--
-- Builds on the exact same replication bootstrap as db-a10-primary-replica's
-- schema.sql (a `replicator` role + a physical replication slot) and adds
-- what THIS drill needs on top of it:
--
--   app.events           — a table `participant` can freely INSERT into, to
--                           generate write load on the primary while the
--                           replica's apply is deliberately throttled.
--   audit.lag_samples    — a continuous history of observed replication lag,
--                           written by the primary's Node app on a timer (see
--                           local/app/pg-client.mjs's startLagSampler), never
--                           by participant DML. The lag spike this drill is
--                           about is transient — it only shows up in
--                           pg_stat_replication.replay_lag at the moment a
--                           delayed WAL record finally gets applied (measured
--                           on a real Postgres 16 instance while authoring
--                           this drill: the value is STALE, not continuously
--                           updated, between applies) — so a durable sampled
--                           history, not a single live query at /verify time,
--                           is what lets the grader see both "it spiked" and
--                           "it later came back down", the same way A6/A7/A8's
--                           trigger-populated `audit` tables capture a
--                           transient fact a live-only query would miss.
--   GRANT ... ON PARAMETER — the exact, minimal privilege that lets
--                           `participant` throttle and restore the replica's
--                           apply rate themselves via `recovery_min_apply_delay`
--                           (PostgreSQL 15+'s fine-grained GUC privilege,
--                           `GRANT ... ON PARAMETER`, confirmed against a real
--                           Postgres 16 instance while authoring this drill —
--                           see local/entrypoint-primary.sh's comment on why
--                           this MUST be granted here, on the primary, and not
--                           on the read-only standby).
create schema if not exists app;

create table if not exists app.events (
  id         bigserial primary key,
  payload    text not null default 'load',
  created_at timestamptz not null default clock_timestamp()
);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'participant') then
    create role participant login;
  end if;
end
$$;

grant usage on schema app to participant;
alter table app.events owner to participant;

-- Dedicated replication role — see db-a10-primary-replica/local/db/schema.sql
-- for the full rationale (unchanged here).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'replicator') then
    create role replicator with replication login;
  end if;
end
$$;

-- A physical replication slot, named for THIS drill (distinct from A10's
-- db_a10_replica — the two problems are deployed independently and never
-- share a cluster).
do $$
begin
  if not exists (select 1 from pg_replication_slots where slot_name = 'db_a11_replica') then
    perform pg_create_physical_replication_slot('db_a11_replica');
  end if;
end
$$;

-- The one GUC `participant` may change, and the one function they may call to
-- make that change take effect. Nothing else about ALTER SYSTEM or config
-- reload is granted — `GRANT ... ON PARAMETER` (PostgreSQL 15+) scopes ALTER
-- SYSTEM SET/RESET down to exactly this parameter, confirmed on a real
-- Postgres 16 instance: a role granted only `recovery_min_apply_delay` still
-- gets "permission denied to set parameter" for any other GUC.
grant alter system on parameter recovery_min_apply_delay to participant;
grant execute on function pg_reload_conf() to participant;

-- audit.lag_samples: populated ONLY by the primary Node app's background
-- sampler (local/app/pg-client.mjs), never by participant DML — no INSERT
-- grant exists on it for `participant`, only SELECT, the same "no diagnostic
-- self-report" shape every prior Database Track drill's audit schema uses.
create schema if not exists audit;

create table if not exists audit.lag_samples (
  sample_id           bigserial primary key,
  sampled_at          timestamptz not null default clock_timestamp(),
  replay_lag_seconds  double precision
);

grant usage on schema audit to participant;
grant select on audit.lag_samples to participant; -- read-only: see the evidence, cannot edit it
