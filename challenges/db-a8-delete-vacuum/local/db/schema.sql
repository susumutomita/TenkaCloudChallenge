-- db-a8-delete-vacuum — seed schema for the "DELETE doesn't shrink disk" drill.
--
-- telemetry.events is the churn target: 400,000 rows split into 300,000 "old"
-- rows (created_at before the retention cutoff, 2023-01-01, meant to be
-- deleted) and 100,000 "recent" rows (created_at on/after the cutoff, meant
-- to survive untouched). A6/A7 used a small bystander row for "did you touch
-- the wrong thing"; here the same role is played by the 100,000 recent rows
-- kept alive right next to the ones being deleted.
--
-- autovacuum is disabled on telemetry.events so dead tuples accumulate
-- deterministically after DELETE and are only reclaimed when the participant
-- runs VACUUM themselves — same rationale as db-a7-mvcc's mvcc.tickets.
--
-- Participant owns telemetry.events (same departure from db-a6-lock that
-- db-a7-mvcc made, for the same reason): VACUUM requires table ownership (or
-- superuser) on PostgreSQL 16, and without ownership participant could never
-- run the VACUUM this drill's whole point depends on. Unlike db-a7-mvcc,
-- INSERT and UPDATE are explicitly revoked from the owner right after granting
-- ownership (confirmed on a live Postgres 16 instance: REVOKE against the
-- table owner is honored, and VACUUM/DELETE both keep working without them) —
-- this drill's checkpoints compare live row COUNTs against fixed seeded
-- values, so closing off INSERT/UPDATE removes an otherwise-open way to pad
-- or backfill those counts instead of doing the real bulk DELETE.
create schema if not exists telemetry;

create table if not exists telemetry.events (
  id         bigserial primary key,
  created_at timestamptz not null,
  kind       text not null
);

alter table telemetry.events set (autovacuum_enabled = false);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'participant') then
    create role participant login;
  end if;
end
$$;

grant usage on schema telemetry to participant;
alter table telemetry.events owner to participant; -- see comment above: VACUUM needs this on PG16
revoke insert, update on telemetry.events from participant; -- DELETE-only surface; see comment above

-- audit.delete_log: an append-only trail of every DELETE statement against
-- telemetry.events, populated ONLY by the statement-level trigger below —
-- never by a participant INSERT (same "no diagnostic self-report" design as
-- db-a6-lock's audit.lock_wait_log and db-a7-mvcc's audit.churn_log).
--
-- This is a STATEMENT-level trigger (`for each statement`, not `for each
-- row`), using a transition table (`referencing old table as deleted_rows`)
-- to read every row a single DELETE actually removed in one pass — cheap even
-- for a 300,000-row DELETE (confirmed on a live Postgres 16 instance: well
-- under a second), versus firing a row-level trigger 300,000 times.
--
-- rows_deleted is what the grader sums to prove a genuinely large DELETE
-- happened — the anti-cheat the whole drill hinges on: without it, a
-- participant could reach "n_dead_tup is small" (dead-tuples-reclaimed's other
-- condition) merely by running VACUUM against an untouched table, since a
-- freshly seeded table already has n_dead_tup = 0. Postgres populates
-- deleted_rows itself from the actual heap tuples removed; no DML privilege
-- lets a participant fabricate an entry (no INSERT grant on audit.delete_log,
-- confirmed: an INSERT attempt fails with a permission error).
create schema if not exists audit;

create table if not exists audit.delete_log (
  log_id          bigserial primary key,
  rows_deleted    bigint not null,
  min_created_at  timestamptz,
  max_created_at  timestamptz,
  backend_pid     integer not null,
  executed_at     timestamptz not null default clock_timestamp()
);

grant usage on schema audit to participant;
grant select on audit.delete_log to participant; -- read-only: see the evidence, cannot edit it

create or replace function audit.log_bulk_delete() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, audit
as $$
declare
  deleted_count bigint;
  earliest      timestamptz;
  latest        timestamptz;
begin
  select count(*), min(created_at), max(created_at)
  into deleted_count, earliest, latest
  from deleted_rows;

  if deleted_count > 0 then
    insert into audit.delete_log (rows_deleted, min_created_at, max_created_at, backend_pid)
    values (deleted_count, earliest, latest, pg_backend_pid());
  end if;

  return null; -- return value is ignored for AFTER triggers
end;
$$;

drop trigger if exists events_bulk_delete_audit on telemetry.events;
create trigger events_bulk_delete_audit
  after delete on telemetry.events
  referencing old table as deleted_rows
  for each statement execute function audit.log_bulk_delete();
