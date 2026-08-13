-- db-a3-query-plan — seed data for support.tickets.
--
-- 300,000 rows, generated set-based (a couple of seconds even on a laptop).
-- `priority` is deliberately skewed: 'urgent' is rare (1 row in 6,000 = 50 rows
-- total), 'normal' is everything else (299,950 rows, 99.98%). Both share the SAME
-- index (idx_tickets_priority, created in schema.sql) and the SAME column — the
-- point of this drill is that a correct, existing index does not mean the planner
-- always uses it. Whether it does depends on how selective the predicate actually
-- is, and the planner can only know that from real statistics.
--
-- INTENTIONALLY no `analyze support.tickets;` here (contrast with db-a2's seed.sql,
-- which ends with one). The participant runs it themselves as the drill's first
-- move — see local/db/schema.sql for why the "before" state has to survive until
-- they do.
insert into support.tickets (priority, subject, created_at)
select
  case when i % 6000 = 0 then 'urgent' else 'normal' end,
  'ticket ' || i,
  now() - ((300000 - i) || ' seconds')::interval
from generate_series(1, 300000) as i;
