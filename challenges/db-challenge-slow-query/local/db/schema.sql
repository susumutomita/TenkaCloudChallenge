-- db-challenge-slow-query — seed schema for the "order history is slow" Challenge.
--
-- storefront.customers / storefront.orders is a small orders/customers-style
-- app. `storefront.orders` starts with ~300,000 rows and NO index that
-- actually helps the one query this Challenge is about (a per-customer order
-- history lookup) — but it is NOT bare, either: a previous engineer already
-- added an index to this table (see idx_orders_status_customer below). That
-- index is real, present from boot, and does show up in `pg_indexes` — it
-- just does not help the query the participant is handed. Unlike
-- db-a2-index-tradeoff (Drill: told directly "there is no index, add one"),
-- this Challenge never says that in instructions/description — the
-- participant discovers it themselves with EXPLAIN, exactly like a real
-- on-call investigation.

create schema if not exists storefront;

create table if not exists storefront.customers (
  id         bigserial primary key,
  email      text not null unique,
  full_name  text not null,
  created_at timestamptz not null default now()
);

create table if not exists storefront.orders (
  id           bigserial primary key,
  customer_id  bigint not null references storefront.customers (id),
  status       text not null,
  total_cents  integer not null,
  created_at   timestamptz not null default now()
);

-- The red herring. This index is real and genuinely present in pg_indexes —
-- a participant who only checks "is there an index on this table?" sees one
-- and may conclude the table is already covered. It leads with `status`
-- (only 4 distinct values across 300,000 rows), so for a query that filters
-- on `customer_id` alone, the planner cannot use this index as anything
-- better than a near-full scan — it will not choose it, and correctly so.
-- The column ORDER of a composite index, not merely its existence, is what
-- this Challenge is about (see README's "How scoring works").
create index if not exists idx_orders_status_customer
  on storefront.orders (status, customer_id);

-- Author-only bookkeeping: the "before any fix" cost of the target lookup,
-- captured once by the app on first boot (see server.mjs) — same pattern as
-- db-a2-index-tradeoff's grading.baseline_buffers. Lives in its own schema,
-- never granted to `participant`, so it cannot be read or tampered with from
-- the Challenge side.
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
-- verified against a live Postgres 16 instance while authoring
-- db-a2-index-tradeoff, and reconfirmed here). ANALYZE only needs table
-- ownership. `customers` stays read-only for participant — this Challenge's
-- fix lives entirely on `orders`.
grant usage, create on schema storefront to participant;
grant select on storefront.customers to participant;
alter table storefront.orders owner to participant;
