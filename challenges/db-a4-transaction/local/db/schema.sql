-- db-a4-transaction — seed schema for the "bank transfer without a transaction" drill.
--
-- bank.accounts has 3 rows: alice, bob, carol. alice starts with just enough
-- balance for the SMALL transfer this drill requires (1000 cents to bob), but
-- not enough for the LARGER demo transfer (5000 cents) the instructions walk
-- through first on purpose — that demo transfer is designed to fail partway,
-- so the participant can watch what "partway" means without a transaction
-- around it, then watch a transaction + ROLLBACK prevent the same failure
-- from corrupting anything.
--
-- balance_cents >= 0 is a real constraint (an account cannot go negative),
-- not a scripted trap: it is exactly the kind of constraint that turns "debit
-- exceeds what's there" into a genuine SQL ERROR partway through a multi-row
-- update, which is the mechanism this drill needs.

create schema if not exists bank;

create table if not exists bank.accounts (
  id             integer primary key,
  owner          text not null,
  balance_cents  integer not null check (balance_cents >= 0)
);

-- Non-superuser login the participant plays as. Owns the table so the UPDATE /
-- BEGIN / COMMIT / ROLLBACK sequence this drill is about works without
-- granting anything broader (no schema-level CREATE needed — nothing here
-- creates new relations).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'participant') then
    create role participant login;
  end if;
end
$$;

grant usage on schema bank to participant;
alter table bank.accounts owner to participant;
