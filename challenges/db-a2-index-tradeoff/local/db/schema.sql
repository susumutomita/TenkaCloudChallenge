-- db-a2-index-tradeoff — seed schema for the "order lookup" drill.
--
-- shop.orders starts with ~400,000 rows and no index beyond the primary key on
-- the synthetic `id`. Looking a single order up by `order_number` (a realistic
-- "customer support pastes this number" query) has nothing to use but a full
-- table scan. The participant builds the missing index themselves.

create schema if not exists shop;

create table if not exists shop.orders (
  id             bigserial primary key,
  order_number   text not null,
  customer_email text not null,
  amount_cents   integer not null,
  status         text not null,
  created_at     timestamptz not null default now()
);

-- Author-only bookkeeping: the "before any index" cost of the target lookup,
-- captured once by the app on first boot (see server.mjs). Lives in its own
-- schema, never granted to `participant`, so it cannot be read or tampered
-- with from the drill side — it is the grader's own ground truth, not part of
-- the participant surface.
create schema if not exists grading;

create table if not exists grading.baseline_buffers (
  query_id    text primary key,
  buffers     bigint not null,
  captured_at timestamptz not null default now()
);

-- Non-superuser login the participant plays as.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'participant') then
    create role participant login;
  end if;
end
$$;

-- CREATE INDEX creates a new relation IN the schema, so it needs schema-level
-- CREATE in addition to table ownership (ownership alone is not enough —
-- verified against a live Postgres 16 instance while authoring this drill).
-- ANALYZE only needs table ownership.
grant usage, create on schema shop to participant;
alter table shop.orders owner to participant;
