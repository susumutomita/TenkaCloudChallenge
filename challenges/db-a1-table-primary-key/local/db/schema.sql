-- db-a1-table-primary-key — seed schema for the "member ledger" drill.
--
-- The predecessor's table is already here: `training.members_unkeyed`. It has an
-- `id` PRIMARY KEY, but that key is on the synthetic row number, not on anything
-- that identifies a *member*. Nothing stops the same person from being inserted
-- twice under the same email. That is the bug the drill makes observable.
--
-- The participant builds `training.members` themselves — a table where `email`
-- really is the primary key — so there is deliberately no DDL for it here.

create schema if not exists training;

create table if not exists training.members_unkeyed (
  id           serial primary key,
  email        text not null,
  display_name text not null,
  created_at   timestamptz not null default now()
);

-- Non-superuser login the participant plays as. Whatever table they CREATE they
-- own outright (full DDL/DML on it), matching how a real application role works.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'participant') then
    create role participant login;
  end if;
end
$$;

grant usage, create on schema training to participant;
-- Read/append rights on the predecessor's table so the participant can both
-- observe it and reproduce "insert one more duplicate" for themselves.
grant select, insert on training.members_unkeyed to participant;
grant usage, select on all sequences in schema training to participant;
