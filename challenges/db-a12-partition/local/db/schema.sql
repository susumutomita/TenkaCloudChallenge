-- db-a12-partition — seed schema for the "row DELETE vs. partition DETACH/DROP" drill.
--
-- metrics.events is a native RANGE-partitioned table (`partition by range
-- (created_at)`), one partition per month, 2024-01 through 2024-06:
--   metrics.events_y2024m01  -- 20,000 rows. Delete THIS one the ordinary way
--                               (row-level DELETE) — the participant should
--                               feel the cost scale with row count.
--   metrics.events_y2024m02  -- 20,000 rows. Remove THIS one the partition
--                               way (DETACH PARTITION, optionally DROP TABLE
--                               afterward) — a catalog-only operation whose
--                               cost does not depend on row count at all.
--   metrics.events_y2024m03..m06 -- 20,000 rows each, 80,000 total. Bystanders
--                               that must survive untouched, same role the
--                               100,000 "recent" rows play in db-a8-delete-vacuum.
--
-- Deliberately small-scale (120,000 rows total) — this drill is not about raw
-- volume (see db-a8-delete-vacuum for that); it is about which UNIT of work
-- (a row, or a whole partition) a deletion costs, something a modest row
-- count already makes measurable (confirmed on a live Postgres 16 instance:
-- deleting one 20,000-row partition's worth of rows takes low tens of
-- milliseconds, while DETACHing a same-sized partition takes low single-digit
-- milliseconds — see README "Numbers behind the thresholds").
--
-- autovacuum is disabled on every leaf partition (cannot be set on the
-- partitioned parent itself — Postgres rejects storage parameters there) so a
-- row-level DELETE's dead tuples stay observable until the participant
-- chooses to VACUUM, the same rationale db-a7-mvcc and db-a8-delete-vacuum
-- use, though this drill's checkpoints don't require a VACUUM step.
create schema if not exists metrics;

create table if not exists metrics.events (
  id         bigserial,
  created_at timestamptz not null,
  kind       text not null,
  primary key (id, created_at) -- the partition key must be part of any unique/PK index
) partition by range (created_at);

create table if not exists metrics.events_y2024m01
  partition of metrics.events for values from ('2024-01-01') to ('2024-02-01');
create table if not exists metrics.events_y2024m02
  partition of metrics.events for values from ('2024-02-01') to ('2024-03-01');
create table if not exists metrics.events_y2024m03
  partition of metrics.events for values from ('2024-03-01') to ('2024-04-01');
create table if not exists metrics.events_y2024m04
  partition of metrics.events for values from ('2024-04-01') to ('2024-05-01');
create table if not exists metrics.events_y2024m05
  partition of metrics.events for values from ('2024-05-01') to ('2024-06-01');
create table if not exists metrics.events_y2024m06
  partition of metrics.events for values from ('2024-06-01') to ('2024-07-01');

alter table metrics.events_y2024m01 set (autovacuum_enabled = false);
alter table metrics.events_y2024m02 set (autovacuum_enabled = false);
alter table metrics.events_y2024m03 set (autovacuum_enabled = false);
alter table metrics.events_y2024m04 set (autovacuum_enabled = false);
alter table metrics.events_y2024m05 set (autovacuum_enabled = false);
alter table metrics.events_y2024m06 set (autovacuum_enabled = false);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'participant') then
    create role participant login;
  end if;
end
$$;

-- participant owns the partitioned parent AND every leaf partition —
-- DETACH PARTITION needs ALTER on the parent, DROP TABLE needs ownership of
-- the specific leaf, and a plain DELETE needs DML rights on whichever leaf it
-- targets. Only USAGE (never CREATE) is granted on the schema itself: DETACH
-- and DROP need no CREATE privilege, and withholding it closes an otherwise
-- open shortcut — recreating an empty replacement table under the same name
-- and re-ATTACHing it as a partition, faking a real row-level DELETE's end
-- state without ever paying its cost (confirmed on a live Postgres 16
-- instance: CREATE TABLE under this schema fails with a permission error for
-- `participant`).
--
-- INSERT, UPDATE and TRUNCATE are explicitly REVOKE'd from every leaf right
-- after granting ownership (confirmed: REVOKE against a table's own owner is
-- honored, and DELETE / DETACH PARTITION / DROP TABLE all keep working
-- without those three grants). This closes the other obvious shortcuts this
-- drill's checkpoints would otherwise be vulnerable to: INSERT would let a
-- participant pad the bystander months' row counts back up after an
-- accidental change, and TRUNCATE would let a participant empty
-- events_y2024m01 in one catalog-only op — masquerading as "I paid the real
-- per-row DELETE cost" when they didn't.
grant usage on schema metrics to participant;
alter table metrics.events owner to participant;
alter table metrics.events_y2024m01 owner to participant;
alter table metrics.events_y2024m02 owner to participant;
alter table metrics.events_y2024m03 owner to participant;
alter table metrics.events_y2024m04 owner to participant;
alter table metrics.events_y2024m05 owner to participant;
alter table metrics.events_y2024m06 owner to participant;
revoke insert, update, truncate on
  metrics.events, metrics.events_y2024m01, metrics.events_y2024m02, metrics.events_y2024m03,
  metrics.events_y2024m04, metrics.events_y2024m05, metrics.events_y2024m06
  from participant;
