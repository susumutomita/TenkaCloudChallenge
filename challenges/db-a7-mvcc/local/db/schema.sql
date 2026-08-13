-- db-a7-mvcc — seed schema for the "readers don't block on writers, but a long
-- transaction blocks VACUUM" drill.
--
-- mvcc.tickets is the row-versioning / dead-tuple churn target (5 rows).
-- mvcc.reference is a bystander (1 row) that never takes part — same role
-- gadget plays in db-a6-lock's inventory.stock.
--
-- autovacuum is disabled on mvcc.tickets so dead tuples accumulate
-- deterministically and are only reclaimed when the participant runs VACUUM
-- themselves — the whole point of this drill is to watch that reclaim (or its
-- absence, while a long transaction is open) happen on command, not on whatever
-- schedule autovacuum happens to pick.
--
-- Unlike db-a6-lock, participant DOES own mvcc.tickets — a departure forced by
-- Postgres 16 itself: VACUUM requires table ownership (or superuser); the
-- MAINTAIN privilege that would let a non-owner run it arrived in Postgres 17,
-- one major version after the postgres:16-alpine image this drill (like A1-A6)
-- is built on. Without ownership, participant could never run the VACUUM this
-- drill's whole point depends on. The tradeoff this reopens — an owner can
-- ALTER TABLE ... DISABLE TRIGGER on their own table, silencing
-- audit.churn_log below — is the same one db-a6-lock's schema.sql accepted for
-- a different reason: losing the audit trail only makes the checkpoints that
-- depend on it *harder* to pass, never easier, so it is not a route to a false
-- pass.
create schema if not exists mvcc;

create table if not exists mvcc.tickets (
  id      integer primary key,
  status  text not null,
  version integer not null default 1
);

alter table mvcc.tickets set (autovacuum_enabled = false);

create table if not exists mvcc.reference (
  id   integer primary key,
  note text not null
);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'participant') then
    create role participant login;
  end if;
end
$$;

grant usage on schema mvcc to participant;
alter table mvcc.tickets owner to participant; -- see comment above: VACUUM needs this on PG16
grant select, update on mvcc.reference to participant; -- reference stays superuser-owned (never vacuumed by participant)

-- audit.churn_log: an append-only trail of every write to mvcc.tickets,
-- populated ONLY by the trigger below — never by a participant INSERT (same
-- "no diagnostic self-report" design as db-a6-lock's audit.lock_wait_log).
--
-- concurrent_long_tx_started_at records, at the exact moment of this write,
-- the `xact_start` of an OTHER `participant` backend that is BOTH "idle in
-- transaction" AND has a non-null `pg_stat_activity.backend_xmin`. That second
-- condition is deliberate, not redundant: a plain `begin;` with no query run
-- yet holds no snapshot at all (backend_xmin stays null even while idle in
-- transaction), and a default READ COMMITTED transaction releases its
-- per-statement snapshot the moment each statement finishes — neither pins
-- anything VACUUM needs to respect. Only a transaction that has actually
-- established and is still holding a snapshot (e.g. `repeatable read` after
-- running one query) keeps backend_xmin populated for as long as it stays
-- open — which is exactly the condition that keeps VACUUM from reclaiming
-- rows that transaction might still need to see. Reading backend_xmin here
-- (not just xact_start/state) is what makes this checkpoint about a
-- transaction that could genuinely block cleanup, not merely "some other
-- session happened to be open". Postgres computes both columns itself (via
-- pg_stat_activity, read here as the security-definer owner so the real,
-- unmasked values are visible regardless of who triggered the write); no DML
-- privilege can forge either one.
create schema if not exists audit;

create table if not exists audit.churn_log (
  log_id                        bigserial primary key,
  ticket_id                     integer not null,
  op                            text not null,
  backend_pid                   integer not null,
  logged_at                     timestamptz not null default clock_timestamp(),
  concurrent_long_tx_started_at timestamptz
);

grant usage on schema audit to participant;
grant select on audit.churn_log to participant; -- read-only: see the evidence, cannot edit it

create or replace function audit.log_churn() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, audit
as $$
declare
  oldest_other_start timestamptz;
  affected_id integer;
begin
  affected_id := coalesce(new.id, old.id);

  select min(xact_start) into oldest_other_start
  from pg_stat_activity
  where pid <> pg_backend_pid()
    and usename = 'participant'
    and state = 'idle in transaction'
    and backend_xmin is not null;

  insert into audit.churn_log (ticket_id, op, backend_pid, concurrent_long_tx_started_at)
  values (affected_id, lower(tg_op), pg_backend_pid(), oldest_other_start);

  return coalesce(new, old);
end;
$$;

drop trigger if exists tickets_churn_audit on mvcc.tickets;
create trigger tickets_churn_audit
  after update or delete on mvcc.tickets
  for each row execute function audit.log_churn();
