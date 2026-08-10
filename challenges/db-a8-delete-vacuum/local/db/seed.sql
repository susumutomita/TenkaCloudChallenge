-- db-a8-delete-vacuum — seed data for telemetry.events.
--
-- 400,000 rows total, generated set-based (a couple of seconds even on a
-- laptop — same scale as db-a2-index-tradeoff's shop.orders):
--   - 300,000 "old" rows: created_at from 2022-01-01 00:00:00+00, one second
--     apart, ending around 2022-01-04. All strictly BEFORE the retention
--     cutoff ('2023-01-01') this drill asks the participant to enforce.
--   - 100,000 "recent" rows: created_at from 2024-01-01 00:00:00+00, one
--     second apart, ending around 2024-01-02. All strictly AT/AFTER the
--     cutoff — these must survive the DELETE untouched.
--
-- The two ranges are deliberately far apart (2022 vs. 2024) so the cutoff is
-- unambiguous regardless of exactly where within '2023-01-01' a participant's
-- WHERE clause draws the line.
insert into telemetry.events (created_at, kind)
select
  timestamp with time zone '2022-01-01 00:00:00+00' + (i || ' seconds')::interval,
  (array['page_view', 'click', 'api_call', 'error'])[1 + (i % 4)]
from generate_series(1, 300000) as i;

insert into telemetry.events (created_at, kind)
select
  timestamp with time zone '2024-01-01 00:00:00+00' + (i || ' seconds')::interval,
  (array['page_view', 'click', 'api_call', 'error'])[1 + (i % 4)]
from generate_series(1, 100000) as i;

analyze telemetry.events;
