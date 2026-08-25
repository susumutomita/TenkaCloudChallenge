-- db-battle-slow-apparently — seed data for commerce.orders.
--
-- 6,000 rows per "old" month for 2024-01 .. 2024-06 (36,000 rows — the
-- INITIAL incident's purge target), 20,000 rows for the held-back 2024-07
-- partition (used only by the Phase 4 recurrence-prevention replay), plus
-- 3,000 rows already in the open-ended "current" partition. Set-based
-- inserts, well under a couple of seconds.
--
-- Row count for 2024-01..06 is deliberately tuned, not arbitrary: confirmed
-- on this Battle's own Docker stack, audit.deleted_orders_log's per-row
-- BEFORE DELETE trigger (schema.sql) costs roughly 1ms/row of REAL cpu time
-- in THIS container's cpu-limited runtime (local/docker-compose.yml) —
-- 36,000 rows makes an untouched `unsafe_full_delete` run for roughly 30-40
-- real seconds: long enough to show up clearly across many ~1s metrics
-- samples and to safely `pg_cancel_backend()` mid-flight, short enough that
-- a full reference/mutation Docker run stays practical. See the PR
-- description's Validation section for the actual measured run.
--
-- IMPORTANT: this runs BEFORE the BEFORE DELETE trigger matters (this is
-- INSERT, not DELETE) — seeding pays none of audit.deleted_orders_log's
-- per-row tax. Only an actual DELETE against these rows later does.
insert into commerce.orders (created_at, customer_id, total_cents, status)
select
  timestamptz '2024-01-01 00:00:00+00' + (i || ' minutes')::interval,
  1000 + (i % 500),
  500 + (i % 9500),
  (array['placed', 'paid', 'shipped', 'delivered'])[1 + (i % 4)]
from generate_series(1, 6000) as i;

insert into commerce.orders (created_at, customer_id, total_cents, status)
select
  timestamptz '2024-02-01 00:00:00+00' + (i || ' minutes')::interval,
  1000 + (i % 500),
  500 + (i % 9500),
  (array['placed', 'paid', 'shipped', 'delivered'])[1 + (i % 4)]
from generate_series(1, 6000) as i;

insert into commerce.orders (created_at, customer_id, total_cents, status)
select
  timestamptz '2024-03-01 00:00:00+00' + (i || ' minutes')::interval,
  1000 + (i % 500),
  500 + (i % 9500),
  (array['placed', 'paid', 'shipped', 'delivered'])[1 + (i % 4)]
from generate_series(1, 6000) as i;

insert into commerce.orders (created_at, customer_id, total_cents, status)
select
  timestamptz '2024-04-01 00:00:00+00' + (i || ' minutes')::interval,
  1000 + (i % 500),
  500 + (i % 9500),
  (array['placed', 'paid', 'shipped', 'delivered'])[1 + (i % 4)]
from generate_series(1, 6000) as i;

insert into commerce.orders (created_at, customer_id, total_cents, status)
select
  timestamptz '2024-05-01 00:00:00+00' + (i || ' minutes')::interval,
  1000 + (i % 500),
  500 + (i % 9500),
  (array['placed', 'paid', 'shipped', 'delivered'])[1 + (i % 4)]
from generate_series(1, 6000) as i;

insert into commerce.orders (created_at, customer_id, total_cents, status)
select
  timestamptz '2024-06-01 00:00:00+00' + (i || ' minutes')::interval,
  1000 + (i % 500),
  500 + (i % 9500),
  (array['placed', 'paid', 'shipped', 'delivered'])[1 + (i % 4)]
from generate_series(1, 6000) as i;

-- 2024-07: held back from the initial cutoff (2024-07-01) on purpose — see
-- schema.sql's file banner. Used only by the Phase 4 recurrence-prevention
-- replay, once the participant widens the cutoff to 2024-08-01. Sized larger
-- than the others (20,000 rows) is fine — the intended (partition_aware)
-- replay is a catalog-only DETACH/DROP whose cost never depends on row
-- count; only the WRONG (unsafe_full_delete) replay would ever pay for this
-- row count, and that path is exactly the one the recurrence-prevention
-- checkpoint is designed to fail.
insert into commerce.orders (created_at, customer_id, total_cents, status)
select
  timestamptz '2024-07-01 00:00:00+00' + (i || ' minutes')::interval,
  1000 + (i % 500),
  500 + (i % 9500),
  (array['placed', 'paid', 'shipped', 'delivered'])[1 + (i % 4)]
from generate_series(1, 20000) as i;

-- Current / protected data: a handful of rows dated "now" so the API's
-- read queries have something to find from the very first request, before
-- the load generator's own writes accumulate more.
insert into commerce.orders (created_at, customer_id, total_cents, status)
select
  now() - ((3000 - i) || ' seconds')::interval,
  1000 + (i % 500),
  500 + (i % 9500),
  'placed'
from generate_series(1, 3000) as i;

analyze commerce.orders;
