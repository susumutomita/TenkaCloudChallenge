-- db-a6-lock — seed schema for the "same-row UPDATE blocks a concurrent UPDATE" drill.
--
-- inventory.stock has 2 rows: widget (id 1), the row BOTH sessions fight over, and
-- gadget (id 2), a bystander that never takes part (same role carol plays in
-- db-a4-transaction's bank.accounts — a stray write to it means something went
-- wrong with the demo, not with the drill).
--
-- Why participant does NOT own inventory.stock (unlike db-a4-transaction's
-- `alter table bank.accounts owner to participant`): a single before/after read of
-- the target row cannot prove a genuine lock WAIT happened, only that some update
-- eventually landed — two independent autocommit UPDATEs with no contention at all
-- reach the exact same final numbers. This drill's grading needs a durable record
-- of HOW LONG each write actually took to execute (see audit.lock_wait_log below),
-- and that record must survive even a participant who later disables triggers on a
-- table they own. So `inventory.stock` stays owned by the bootstrap superuser;
-- participant gets narrow SELECT/UPDATE grants instead of ownership.
create schema if not exists inventory;

create table if not exists inventory.stock (
  id   integer primary key,
  sku  text not null,
  qty  integer not null check (qty >= 0)
);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'participant') then
    create role participant login;
  end if;
end
$$;

grant usage on schema inventory to participant;
grant select, update on inventory.stock to participant;

-- audit.lock_wait_log: an append-only trail of every write to inventory.stock,
-- populated ONLY by the trigger below — never by a participant INSERT (no INSERT
-- grant is given on this table; see local/grader/grade.mjs's file comment for why
-- "participant INSERTs a diagnostic result" was deliberately rejected as a design).
-- Each row records facts Postgres itself computes, none of which an ordinary DML
-- privilege can forge:
--   - backend_pid / txid — which physical connection and transaction wrote this
--   - stmt_started_at    — when THIS UPDATE statement began, i.e. BEFORE it tried
--                          to acquire the row lock
--
-- Deliberately NOT storing a "committed_at" here: an AFTER UPDATE trigger fires
-- when the STATEMENT finishes, not when the surrounding transaction actually
-- COMMITs — and the blocker in this drill keeps its transaction open (running
-- `select pg_sleep(5)`) for a while after its own UPDATE statement returns. A
-- timestamp captured inside the trigger would therefore read as "instant" even
-- though the row lock stays held for several more seconds. The grader instead
-- asks Postgres itself, after the fact, when a given txid's transaction actually
-- committed, via `pg_xact_commit_timestamp(txid)` — which needs
-- `track_commit_timestamp = on` (set in local/entrypoint.sh's postgres startup
-- flags).
create schema if not exists audit;

create table if not exists audit.lock_wait_log (
  log_id          bigserial primary key,
  stock_id        integer not null,
  backend_pid     integer not null,
  txid            xid not null,
  stmt_started_at timestamptz not null
);

grant usage on schema audit to participant;
grant select on audit.lock_wait_log to participant; -- read-only: see the evidence, cannot edit it

create or replace function audit.log_stock_update() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, audit
as $$
begin
  insert into audit.lock_wait_log (stock_id, backend_pid, txid, stmt_started_at)
  values (new.id, pg_backend_pid(), pg_current_xact_id()::xid, statement_timestamp());
  return new;
end;
$$;

drop trigger if exists stock_update_audit on inventory.stock;
create trigger stock_update_audit
  after update on inventory.stock
  for each row execute function audit.log_stock_update();
