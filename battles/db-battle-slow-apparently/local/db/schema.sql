-- db-battle-slow-apparently — schema for the "The Database Is Slow, Apparently" GameDay.
--
-- Scenario in one sentence: an order API sits on a primary + streaming-replica
-- Postgres pair; a retention job wakes up and starts deleting old orders the
-- naive way (one giant, uncommitted, row-by-row DELETE) even though the table
-- is already RANGE-partitioned by month — the participant must diagnose that
-- from symptoms alone, contain it without stopping production traffic, finish
-- the purge the cheap way (DETACH/DROP the eligible partitions), and fix the
-- job so the same daily run does not misbehave again.
--
-- Schema layout:
--   commerce.orders          -- RANGE-partitioned by created_at. 6 "old" leaf
--                                partitions (2024-01 .. 2024-06) are eligible
--                                for the FIRST purge; one more (2024-07) is
--                                deliberately held back — untouched until the
--                                participant widens the retention window in
--                                Phase 4 (recurrence prevention replay) —
--                                plus an open-ended "current" partition that
--                                the order API keeps writing into for the
--                                whole run.
--   ops.retention_config     -- the ONE row the retention worker reads before
--                                every run. `participant` may UPDATE it (that
--                                IS "fix the policy") but not INSERT/DELETE.
--   audit.incident_log       -- one row per retention-job RUN ("episode"):
--                                who (backend pid), what strategy, what
--                                cutoff, when it started/ended, how it ended.
--                                Written only by the retention worker itself.
--   audit.metrics_samples    -- a continuous, ~1/second history of API
--                                latency/error rate, replication lag/
--                                connectivity, and postmaster start times —
--                                written only by the primary container's own
--                                background sampler. This is what "sustained
--                                SLO recovery", "replica never disabled" and
--                                "primary never restarted" are graded from;
--                                `participant` can read it but never write it.
--   audit.deleted_orders_log -- populated by a BEFORE DELETE trigger on every
--                                leaf partition. This is what makes a plain
--                                row-by-row DELETE genuinely expensive here —
--                                a realistic stand-in for the "on-delete audit
--                                trail" trigger production schemas often carry
--                                — while DETACH/DROP PARTITION (catalog-only,
--                                fires no per-row trigger) stays cheap. The
--                                cost difference participants FEEL between the
--                                two strategies is real, not simulated.
--   audit.diagnosis_log      -- every /diagnosis submission the primary app
--                                receives from the participant's terminal
--                                (Phase 1). Grading reads the latest one.
--
-- Roles:
--   orders_owner    (NOLOGIN) — owns commerce.* and the leaf partitions.
--   participant     (LOGIN)   — INHERITs orders_owner (can DETACH/DROP/DELETE
--                                leaf partitions, but INSERT/UPDATE/TRUNCATE
--                                are revoked so seeded data can't be padded
--                                or forged back to "looks fine"). Also gets
--                                pg_read_all_stats (see live sessions) and
--                                pg_signal_backend (cancel/terminate a
--                                specific backend — the real Postgres
--                                mechanism for a safe, surgical containment
--                                action) plus read/UPDATE on ops.*.
--   retention_service (LOGIN) — the automated job's identity. INHERITs
--                                orders_owner for its DDL/DML, and is the
--                                only role with INSERT on audit.incident_log.
--   app_service     (LOGIN)   — the order API's identity. INSERT + SELECT on
--                                commerce.orders ONLY (no DELETE/DDL) — the
--                                same least-privilege posture a real app tier
--                                would run under.
create schema if not exists commerce;
create schema if not exists ops;
create schema if not exists audit;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'orders_owner') then
    create role orders_owner nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'participant') then
    create role participant login inherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'retention_service') then
    create role retention_service login inherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_service') then
    create role app_service login;
  end if;
end
$$;

grant orders_owner to participant;
grant orders_owner to retention_service;
grant pg_read_all_stats to participant;
grant pg_signal_backend to participant;

-- ---------------------------------------------------------------------------
-- commerce.orders — the table at the center of the incident.
-- ---------------------------------------------------------------------------
create table if not exists commerce.orders (
  id          bigserial,
  created_at  timestamptz not null,
  customer_id integer not null,
  total_cents integer not null,
  status      text not null default 'placed',
  primary key (id, created_at) -- the partition key must be part of any unique/PK index
) partition by range (created_at);

create table if not exists commerce.orders_2024_01
  partition of commerce.orders for values from ('2024-01-01') to ('2024-02-01');
create table if not exists commerce.orders_2024_02
  partition of commerce.orders for values from ('2024-02-01') to ('2024-03-01');
create table if not exists commerce.orders_2024_03
  partition of commerce.orders for values from ('2024-03-01') to ('2024-04-01');
create table if not exists commerce.orders_2024_04
  partition of commerce.orders for values from ('2024-04-01') to ('2024-05-01');
create table if not exists commerce.orders_2024_05
  partition of commerce.orders for values from ('2024-05-01') to ('2024-06-01');
create table if not exists commerce.orders_2024_06
  partition of commerce.orders for values from ('2024-06-01') to ('2024-07-01');
-- Held back on purpose: NOT eligible under the initial retention cutoff
-- (2024-07-01). Two jobs are testable against the same fixture set:
--   1. the incident purge (cutoff 2024-07-01, touches only _01.._06)
--   2. the Phase 4 recurrence-prevention replay (cutoff widened to
--      2024-08-01, so THIS partition becomes eligible and is the only
--      thing the replay is allowed to touch)
create table if not exists commerce.orders_2024_07
  partition of commerce.orders for values from ('2024-07-01') to ('2024-08-01');
-- Open-ended "now" partition. The order API inserts into this one for the
-- whole run (real wall-clock `now()` easily lands past 2024-08-01).
create table if not exists commerce.orders_current
  partition of commerce.orders for values from ('2024-08-01') to (maxvalue);

-- Index on the partition key itself, so `order by created_at desc limit 20`
-- (the api's recent-orders read) gets a cheap backward index scan on
-- whichever leaf partition holds recent rows, on BOTH primary and replica —
-- without this, that query pays a full per-partition seq scan + sort even at
-- baseline, which would swamp the incident's own effect on read latency.
-- Creating it on the partitioned PARENT auto-creates a matching index on
-- every current AND future leaf partition (PostgreSQL 11+).
create index if not exists idx_orders_created_at on commerce.orders (created_at);

alter table commerce.orders_2024_01 set (autovacuum_enabled = false);
alter table commerce.orders_2024_02 set (autovacuum_enabled = false);
alter table commerce.orders_2024_03 set (autovacuum_enabled = false);
alter table commerce.orders_2024_04 set (autovacuum_enabled = false);
alter table commerce.orders_2024_05 set (autovacuum_enabled = false);
alter table commerce.orders_2024_06 set (autovacuum_enabled = false);
alter table commerce.orders_2024_07 set (autovacuum_enabled = false);

alter table commerce.orders owner to orders_owner;
alter table commerce.orders_2024_01 owner to orders_owner;
alter table commerce.orders_2024_02 owner to orders_owner;
alter table commerce.orders_2024_03 owner to orders_owner;
alter table commerce.orders_2024_04 owner to orders_owner;
alter table commerce.orders_2024_05 owner to orders_owner;
alter table commerce.orders_2024_06 owner to orders_owner;
alter table commerce.orders_2024_07 owner to orders_owner;
alter table commerce.orders_current owner to orders_owner;

-- `participant` (via orders_owner) can DETACH/DROP/DELETE, but never
-- INSERT/UPDATE/TRUNCATE — closing the "pad the row count back up" and
-- "wipe a partition instantly then recreate it empty" shortcuts, same
-- rationale as db-a12-partition's identical revoke.
revoke insert, update, truncate on
  commerce.orders, commerce.orders_2024_01, commerce.orders_2024_02, commerce.orders_2024_03,
  commerce.orders_2024_04, commerce.orders_2024_05, commerce.orders_2024_06, commerce.orders_2024_07,
  commerce.orders_current
  from orders_owner;

grant usage on schema commerce to app_service, orders_owner, retention_service;
-- app_service (the order API) may only INSERT + SELECT — no DELETE, no DDL.
-- Granting INSERT on the partitioned PARENT is enough for tuple routing
-- (confirmed on a live Postgres 16 instance), but SELECT is checked against
-- whichever leaf partition the planner actually scans — granting SELECT on
-- the parent alone is NOT enough once a query is planned as a per-leaf scan
-- (as happens for the plain `select ... from commerce.orders` the api and
-- the replica both run), so SELECT needs an explicit grant on every leaf too.
grant select, insert on commerce.orders to app_service;
grant select on
  commerce.orders_2024_01, commerce.orders_2024_02, commerce.orders_2024_03, commerce.orders_2024_04,
  commerce.orders_2024_05, commerce.orders_2024_06, commerce.orders_2024_07, commerce.orders_current
  to app_service;
-- The `id bigserial` default calls nextval() under the hood; INSERT alone
-- does not imply sequence USAGE.
grant usage on sequence commerce.orders_id_seq to app_service;

-- ---------------------------------------------------------------------------
-- audit.deleted_orders_log + the BEFORE DELETE trigger that fires on it.
--
-- This is deliberately NOT free: every row deleted from any leaf partition
-- pays a small, real per-row cost here (an INSERT into this table). This is
-- what turns "DELETE 120,000 rows in one transaction" from "near-instant on
-- modern hardware" into "genuinely slow, genuinely WAL-heavy, genuinely worth
-- diagnosing" — a realistic stand-in for the on-delete audit trail trigger
-- production order tables commonly carry. DETACH PARTITION / DROP TABLE never
-- fire a per-row trigger at all, which is exactly the cost asymmetry Phase 3
-- is measuring.
-- ---------------------------------------------------------------------------
create table if not exists audit.deleted_orders_log (
  log_id     bigserial primary key,
  order_id   bigint not null,
  deleted_at timestamptz not null default clock_timestamp()
);
alter table audit.deleted_orders_log owner to postgres;

create or replace function audit.log_deleted_order() returns trigger
language plpgsql security definer as $$
declare
  i int;
  x numeric := 0;
begin
  -- The deliberate per-row tax (see file banner) — real CPU work (not
  -- pg_sleep). Confirmed on this Battle's own Docker stack: pg_sleep blocks
  -- without consuming CPU, so it stretches wall-clock time but never
  -- actually competes with the concurrent order API for this container's
  -- cpu-limited share (local/docker-compose.yml). A real, if pointless,
  -- computation does — the same "noisy neighbor" contention a genuinely
  -- expensive production audit-trail trigger creates. Kept as a single named
  -- iteration count so it is easy to find and re-tune.
  for i in 1..1500 loop
    x := x + sqrt(i::numeric + 1);
  end loop;
  insert into audit.deleted_orders_log (order_id) values (old.id);
  return old;
end;
$$;
alter function audit.log_deleted_order() owner to postgres;

do $$
declare
  leaf text;
begin
  foreach leaf in array array[
    'orders_2024_01', 'orders_2024_02', 'orders_2024_03',
    'orders_2024_04', 'orders_2024_05', 'orders_2024_06', 'orders_2024_07'
  ]
  loop
    execute format(
      'drop trigger if exists log_deleted_order on commerce.%I', leaf
    );
    execute format(
      'create trigger log_deleted_order before delete on commerce.%I
         for each row execute function audit.log_deleted_order()',
      leaf
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- ops.retention_config — the one row the retention worker reads before every
-- run. Fixing the policy IS updating this row.
-- ---------------------------------------------------------------------------
create table if not exists ops.retention_config (
  id            integer primary key default 1,
  strategy      text not null default 'unsafe_full_delete'
                  check (strategy in ('unsafe_full_delete', 'partition_aware')),
  cutoff_date   date not null default '2024-07-01',
  updated_at    timestamptz not null default now(),
  constraint single_row check (id = 1)
);
insert into ops.retention_config (id, strategy, cutoff_date)
  values (1, 'unsafe_full_delete', '2024-07-01')
  on conflict (id) do nothing;
alter table ops.retention_config owner to postgres;

grant usage on schema ops to participant;
grant select, update (strategy, cutoff_date) on ops.retention_config to participant;
grant usage on schema ops to retention_service;
grant select on ops.retention_config to retention_service;

-- ---------------------------------------------------------------------------
-- audit.incident_log — one row per retention-job run ("episode").
-- ---------------------------------------------------------------------------
create table if not exists audit.incident_log (
  episode_id   bigserial primary key,
  backend_pid  integer not null,
  strategy     text not null,
  cutoff_date  date not null,
  partitions   text[] not null,
  started_at   timestamptz not null default clock_timestamp(),
  ended_at     timestamptz,
  outcome      text check (outcome in ('committed', 'cancelled', 'error'))
);
alter table audit.incident_log owner to postgres;

grant usage on schema audit to retention_service;
grant insert, update on audit.incident_log to retention_service;
grant select on audit.incident_log to retention_service;
grant usage on sequence audit.incident_log_episode_id_seq to retention_service;

grant usage on schema audit to participant;
grant select on audit.incident_log to participant;
grant select on audit.deleted_orders_log to participant;

-- ---------------------------------------------------------------------------
-- audit.metrics_samples — the continuous ~1/second history the primary
-- container's own Node app writes. `participant` can read it (that IS the
-- observability surface) but never write it.
-- ---------------------------------------------------------------------------
create table if not exists audit.metrics_samples (
  sample_id                    bigserial primary key,
  sampled_at                   timestamptz not null default clock_timestamp(),
  api_p99_ms                   numeric,
  api_error_rate               numeric,
  replication_connected        boolean not null,
  replay_lag_seconds           numeric,
  primary_start_time           timestamptz,
  replica_start_time           timestamptz,
  long_txn_seconds             numeric,
  retention_worker_state       text,
  -- Continuous invariant: orders_current is live/protected data (app_service
  -- only ever INSERTs into it). This column must never decrease across the
  -- WHOLE history — a single dip anywhere is proof something deleted
  -- protected rows, even if the final count later looks fine again.
  current_partition_row_count  integer not null
);
alter table audit.metrics_samples owner to postgres;
grant select on audit.metrics_samples to participant;

-- ---------------------------------------------------------------------------
-- audit.diagnosis_log — every Phase 1 /diagnosis submission.
-- ---------------------------------------------------------------------------
create table if not exists audit.diagnosis_log (
  submission_id  bigserial primary key,
  submitted_at   timestamptz not null default clock_timestamp(),
  offending_pid  integer,
  mechanism      text,
  trigger_source text,
  first_action   text,
  correct        boolean not null
);
alter table audit.diagnosis_log owner to postgres;
grant select on audit.diagnosis_log to participant;

-- ---------------------------------------------------------------------------
-- Replication role (same shape as db-a10/a11's primary entrypoint).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'replicator') then
    create role replicator replication login;
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_replication_slots where slot_name = 'db_battle_slow_apparently_replica') then
    perform pg_create_physical_replication_slot('db_battle_slow_apparently_replica');
  end if;
end
$$;
