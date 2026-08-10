-- db-a2-index-tradeoff — seed data for shop.orders.
--
-- 400,000 rows, generated set-based (a couple of seconds even on a laptop).
-- order_number is deliberately NOT unique-constrained or indexed beyond the
-- heap itself, even though every value here happens to be distinct — that is
-- exactly the situation this drill is about: a column real queries filter on,
-- with no index to help them.
insert into shop.orders (order_number, customer_email, amount_cents, status, created_at)
select
  'ORD-' || lpad(i::text, 8, '0'),
  'user' || (i % 50000) || '@example.com',
  (i % 100000) + 100,
  (array['paid', 'pending', 'refunded', 'shipped'])[1 + (i % 4)],
  now() - ((400000 - i) || ' seconds')::interval
from generate_series(1, 400000) as i;

analyze shop.orders;
