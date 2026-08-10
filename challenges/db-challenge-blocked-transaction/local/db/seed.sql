-- db-challenge-blocked-transaction — seed data for app.accounts.
--
-- account 1 ("griffin holdings") is the only row the incident ever touches —
-- $1,000.00 (100000 cents) to start. account 2 ("harbor light co-op") is an
-- unrelated bystander the incident never comes near, seeded purely so the
-- table looks like a real small ledger rather than a single magic row.
insert into app.accounts (id, owner_name, balance_cents) values
  (1, 'griffin holdings', 100000),
  (2, 'harbor light co-op', 50000)
on conflict (id) do nothing;
