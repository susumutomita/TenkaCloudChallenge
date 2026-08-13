-- db-a4-transaction — seed data for bank.accounts.
--
-- 3 rows, fixed on purpose (this drill is about a single, exact transfer, not
-- a bulk workload like A2/A3): alice=3000, bob=10000, carol=7000, total=20000.
--
-- carol never participates in any transfer in this drill. She exists purely
-- as a bystander whose balance must stay exactly 7000 throughout — if a
-- participant's trial and error (e.g. re-running a demo update against the
-- wrong id) ever touches her, the total-balance-conserved checkpoint catches
-- it even though it would not show up in a check that only looked at alice
-- and bob.
--
-- Deliberately 3 SEPARATE INSERT statements, not one multi-row INSERT: each
-- bare statement here is its own implicit transaction, so alice's and bob's
-- freshly seeded rows start out with DIFFERENT `xmin` values (verified
-- against a live Postgres 16 instance while authoring this drill). That
-- matters for the updates-committed-atomically checkpoint (local/grader/
-- grade.mjs) — it must not be possible to pass that checkpoint for free, by
-- coincidence, before the participant has done anything at all.
insert into bank.accounts (id, owner, balance_cents) values (1, 'alice', 3000)
  on conflict (id) do nothing;
insert into bank.accounts (id, owner, balance_cents) values (2, 'bob', 10000)
  on conflict (id) do nothing;
insert into bank.accounts (id, owner, balance_cents) values (3, 'carol', 7000)
  on conflict (id) do nothing;
