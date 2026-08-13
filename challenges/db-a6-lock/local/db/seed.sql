-- db-a6-lock — seed data for inventory.stock.
--
-- widget (id 1) starts at 300 units and is the ONLY row both sessions touch — that
-- shared target is what makes their UPDATEs compete for the same row lock.
-- gadget (id 2) starts at 120 and never participates; it exists purely as a
-- bystander whose qty must stay exactly 120 throughout (same role carol plays in
-- db-a4-transaction's bank.accounts).
insert into inventory.stock (id, sku, qty) values (1, 'widget', 300)
  on conflict (id) do nothing;
insert into inventory.stock (id, sku, qty) values (2, 'gadget', 120)
  on conflict (id) do nothing;
