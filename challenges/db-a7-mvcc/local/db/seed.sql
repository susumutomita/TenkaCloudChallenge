-- db-a7-mvcc — seed data.
--
-- mvcc.tickets: 5 rows, all status='open', version=1 — the churn target both
-- the read-visibility demo and the dead-tuple/VACUUM demo update.
-- mvcc.reference: 1 row that never participates, a bystander whose note must
-- stay exactly 'do-not-touch' throughout (same role gadget plays in
-- db-a6-lock's inventory.stock).
insert into mvcc.tickets (id, status, version) values
  (1, 'open', 1), (2, 'open', 1), (3, 'open', 1), (4, 'open', 1), (5, 'open', 1)
  on conflict (id) do nothing;

insert into mvcc.reference (id, note) values (1, 'do-not-touch')
  on conflict (id) do nothing;
