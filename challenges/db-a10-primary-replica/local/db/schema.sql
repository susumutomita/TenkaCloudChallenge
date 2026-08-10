-- db-a10-primary-replica — primary-side schema.
--
-- app.ledger is the table the participant writes marker rows into, to watch
-- them show up on the separately booted replica. Two disjoint markers
-- ('wave-1', 'wave-2') written at two separate moments are the whole point:
-- one write reflected on the replica could be "a copy happened to include
-- it"; a SECOND, later write also showing up is what actually distinguishes
-- "streaming replication" from "a one-time snapshot" (see local/README.md /
-- metadata.json instructions).
--
-- This file also owns the replication *role* and *slot* — bootstrap
-- infrastructure a participant never touches directly, but which must exist
-- before local/entrypoint-replica.sh's pg_basebackup can succeed. It is
-- applied by local/entrypoint-primary.sh before the Node app (and therefore
-- this service's healthcheck) comes up, and compose's
-- `depends_on: condition: service_healthy` on the `replica` service (see
-- local/docker-compose.yml) is what guarantees this file has already run by
-- the time `replica` even starts.
create schema if not exists app;

create table if not exists app.ledger (
  id          bigserial primary key,
  note        text not null,
  recorded_at timestamptz not null default clock_timestamp()
);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'participant') then
    create role participant login;
  end if;
end
$$;

grant usage on schema app to participant;
alter table app.ledger owner to participant;

-- Dedicated replication role. `replication` is the one PostgreSQL attribute
-- that lets a role open a physical-replication-protocol connection
-- (pg_basebackup / START_REPLICATION) — it grants nothing else, and this role
-- is never given any schema/table privilege, so even an ordinary SQL login as
-- `replicator` (nothing stops one — trust auth is cluster-wide, same as every
-- prior Database Track drill) could not read or write app.ledger.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'replicator') then
    create role replicator with replication login;
  end if;
end
$$;

-- A physical replication slot, created once and named deterministically so
-- entrypoint-replica.sh's `pg_basebackup -S db_a10_replica` always finds it.
-- The slot is what keeps the primary from recycling WAL the replica has not
-- consumed yet — without it, a replica that fell behind (imagine a container
-- restart) could be asked to stream from a WAL segment the primary already
-- deleted, and would fail to catch back up.
do $$
begin
  if not exists (select 1 from pg_replication_slots where slot_name = 'db_a10_replica') then
    perform pg_create_physical_replication_slot('db_a10_replica');
  end if;
end
$$;
