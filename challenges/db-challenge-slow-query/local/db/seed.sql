-- db-challenge-slow-query — seed data.
--
-- 5,000 customers, 300,000 orders (60 orders per customer, generated
-- set-based — a couple of seconds even on a laptop, same scale as
-- db-a3-query-plan's 300,000-row seed).
--
-- customer_id cycles 1..5000 with period 5000, so every customer has exactly
-- 60 orders spread evenly across the whole time range — nothing about the
-- target customer (id 2500, picked because it exists and is unremarkable) is
-- special or clustered.
--
-- created_at is deliberately NOT a simple function of insertion order (and
-- therefore not a simple function of the `id` primary key either). It uses
-- `(i * 104729) mod 300000` — 104729 is prime and shares no factor with
-- 300000, so this multiplication is a bijection over 1..300000 that scrambles
-- row i's time rank away from its id. Without this, `id` (monotonically
-- increasing with insertion order) would happen to correlate almost exactly
-- with `created_at`, and the planner could satisfy `order by created_at desc
-- limit 20` by walking the PRIMARY KEY's own index backward and filtering —
-- without ever needing a real index on `customer_id` at all. That would
-- accidentally "solve" this Challenge's target query before the participant
-- does anything, which is exactly the kind of unintentional shortcut this
-- seed has to avoid (verified against a live Postgres 16 instance while
-- authoring this Challenge — see the PR's Verification notes).
insert into storefront.customers (email, full_name)
select
  'customer' || i || '@example.com',
  'Customer ' || i
from generate_series(1, 5000) as i;

insert into storefront.orders (customer_id, status, total_cents, created_at)
select
  ((i - 1) % 5000) + 1,
  (array['pending', 'paid', 'shipped', 'refunded'])[1 + (i % 4)],
  (i % 20000) + 500,
  now() - ((300000 - (((i::bigint * 104729) % 300000) + 1)) || ' seconds')::interval
from generate_series(1, 300000) as i;

analyze storefront.customers;
analyze storefront.orders;
