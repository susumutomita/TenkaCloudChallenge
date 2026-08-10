-- db-a12-partition — seed data for metrics.events.
--
-- 120,000 rows total, 20,000 per month (2024-01 through 2024-06), generated
-- set-based (well under a second — smaller than db-a2-index-tradeoff's
-- 400,000-row seed on purpose; this drill is not about raw volume).
-- Postgres routes each INSERT to the correct partition automatically based on
-- created_at, since metrics.events is RANGE-partitioned on that column.
insert into metrics.events (created_at, kind)
select
  timestamp with time zone '2024-01-01 00:00:00+00' + (i || ' minutes')::interval,
  (array['page_view', 'click', 'api_call', 'error'])[1 + (i % 4)]
from generate_series(1, 20000) as i;

insert into metrics.events (created_at, kind)
select
  timestamp with time zone '2024-02-01 00:00:00+00' + (i || ' minutes')::interval,
  (array['page_view', 'click', 'api_call', 'error'])[1 + (i % 4)]
from generate_series(1, 20000) as i;

insert into metrics.events (created_at, kind)
select
  timestamp with time zone '2024-03-01 00:00:00+00' + (i || ' minutes')::interval,
  (array['page_view', 'click', 'api_call', 'error'])[1 + (i % 4)]
from generate_series(1, 20000) as i;

insert into metrics.events (created_at, kind)
select
  timestamp with time zone '2024-04-01 00:00:00+00' + (i || ' minutes')::interval,
  (array['page_view', 'click', 'api_call', 'error'])[1 + (i % 4)]
from generate_series(1, 20000) as i;

insert into metrics.events (created_at, kind)
select
  timestamp with time zone '2024-05-01 00:00:00+00' + (i || ' minutes')::interval,
  (array['page_view', 'click', 'api_call', 'error'])[1 + (i % 4)]
from generate_series(1, 20000) as i;

insert into metrics.events (created_at, kind)
select
  timestamp with time zone '2024-06-01 00:00:00+00' + (i || ' minutes')::interval,
  (array['page_view', 'click', 'api_call', 'error'])[1 + (i % 4)]
from generate_series(1, 20000) as i;

analyze metrics.events;
