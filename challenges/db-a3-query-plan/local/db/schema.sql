-- db-a3-query-plan — seed schema for the "does the planner always use the index?" drill.
--
-- support.tickets starts with 300,000 rows and an index on `priority` that already
-- exists (this drill is not about creating an index — A2 already covered that). The
-- twist: the bulk load below deliberately runs with NO trailing `ANALYZE` (contrast
-- with db-a2-index-tradeoff/local/db/seed.sql, which ends with one). A freshly
-- created, never-analyzed table still answers every query correctly — the rows are
-- all there — but the planner has no real statistics to reason about *selectivity*
-- with, so it estimates the SAME (wrong) row count for every literal value on this
-- column. The participant runs ANALYZE themselves, which is the actual "first move"
-- of this drill.
--
-- autovacuum_enabled=false keeps that stale state stable for the length of a drill
-- session — otherwise autovacuum could quietly auto-ANALYZE the table in the
-- background and the "before" state the instructions describe would already be gone
-- by the time the participant opens a terminal.

create schema if not exists support;

create table if not exists support.tickets (
  id         bigserial primary key,
  priority   text not null,
  subject    text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_tickets_priority on support.tickets (priority);

-- Non-superuser login the participant plays as. Owns the table so `ANALYZE` (which
-- requires table ownership, or superuser, on Postgres 16) works for them without
-- granting anything broader.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'participant') then
    create role participant login;
  end if;
end
$$;

grant usage on schema support to participant;
alter table support.tickets owner to participant;

-- Runs AFTER the table exists but BEFORE seed.sql inserts any rows, so the
-- "never analyzed" state is guaranteed regardless of statement ordering inside a
-- single psql -f invocation.
alter table support.tickets set (autovacuum_enabled = false);
