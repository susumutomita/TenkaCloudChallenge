-- db-challenge-blocked-transaction — seed schema for the "a payout write is
-- stuck" Challenge.
--
-- app.accounts is a tiny accounts-payable table (1 row that matters). The
-- symptom the participant is handed is entirely behavioural: a background
-- write the application keeps retrying just never completes. Nothing in
-- instructions/description says "a session is blocking it" — the participant
-- has to notice that themselves with the exact tools A6 (Lock) taught:
-- pg_stat_activity / pg_locks / pg_blocking_pids().
--
-- The actual incident is orchestrated entirely by the Node app (server.mjs),
-- not by the participant's own psql session, and not by a trigger:
--   - a LEAKED connection (role app_service) opens a transaction, updates
--     the one account row, and never commits — the classic "a deploy left a
--     connection open mid-transaction" incident.
--   - a HARMLESS decoy connection (also app_service) just sits idle, holding
--     no transaction and no lock — a distractor so "kill the other
--     app_service connection" is not automatically the right move; the
--     participant has to use pg_blocking_pids() to find the ACTUAL blocker.
--   - a genuine WAITER write (also app_service) is retried by the app in a
--     loop and blocks on the leaked transaction's row lock until it is
--     resolved.
--
-- `participant` deliberately gets NO write grant on app.accounts — the only
-- lever available to fix this is identifying and terminating the real
-- blocking backend (pg_terminate_backend, via pg_signal_backend membership),
-- exactly like a real incident response with a read replica / reporting role
-- that has no direct write access to production data.

create schema if not exists app;

create table if not exists app.accounts (
  id           integer primary key,
  owner_name   text not null,
  balance_cents integer not null check (balance_cents >= 0)
);

-- Author-only, append-only evidence trail — written ONLY by the trusted Node
-- app (server.mjs), never by participant SQL and never by a trigger (the
-- writes here come from the app's own retry loop, not from DML on
-- app.accounts, so a trigger has nothing to hook). Lets the grader tell a
-- GENUINE block-then-resolve apart from "there was never really a problem"
-- (see local/grader/grade.mjs).
create schema if not exists audit;

create table if not exists audit.incident_log (
  log_id      bigserial primary key,
  event       text not null,
  backend_pid integer,
  logged_at   timestamptz not null default now()
);

-- Non-superuser login the participant plays as.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'participant') then
    create role participant login;
  end if;
end
$$;

-- Non-superuser login the "application" plays as. Every connection involved
-- in the incident itself (the leaked blocker, the harmless decoy, the
-- retrying waiter) connects as this role — never as participant, never as
-- the postgres superuser the grader uses. This is what makes granting
-- pg_signal_backend to participant meaningful: it lets them terminate THIS
-- role's backends and nothing more sensitive.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_service') then
    create role app_service login;
  end if;
end
$$;

grant usage on schema app to participant, app_service;
grant select on app.accounts to participant;          -- read-only: cannot patch the balance directly
grant select, update on app.accounts to app_service;   -- the "application" role performs the real writes

grant usage on schema audit to participant;
grant select on audit.incident_log to participant;      -- read-only evidence trail

-- Lets `participant` terminate NON-superuser backends (i.e. app_service's
-- leaked/blocking connection) without granting full superuser.
-- pg_signal_backend is built in since PostgreSQL 14; verified against a live
-- Postgres 16 instance while authoring this problem that a pg_signal_backend
-- member cannot terminate a superuser's backend (so it cannot be used to
-- kill the grader's own connection, which connects as postgres).
grant pg_signal_backend to participant;

-- Required for the diagnostic technique itself to work at all. Verified
-- against a live Postgres 16 instance while authoring this problem:
-- pg_stat_activity's `state`, `wait_event_type`, and `wait_event` columns
-- read as NULL for every OTHER role's backend unless the querying role is a
-- superuser or a member of pg_signal_backend's sibling role
-- pg_read_all_stats — without this grant, `participant` cannot see WHICH
-- app_service backend (if any) is genuinely waiting on a lock at all, and
-- the exact instructions this Challenge gives (mirroring A6's technique)
-- would silently return zero rows. Built in since PostgreSQL 10; grants only
-- read access to statistics views, no write/signal capability.
grant pg_read_all_stats to participant;
