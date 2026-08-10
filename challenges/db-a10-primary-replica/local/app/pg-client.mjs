/**
 * pg-client — the live Postgres adapter the grader drives inside the primary
 * container. Unlike every single-node Database Track drill before this one,
 * this file holds TWO connections: one to the primary (loopback, same
 * container) and one to the replica (TCP, over the compose network, via the
 * service name `replica` — see local/entrypoint-primary.sh's
 * REPLICA_DATABASE_URL).
 *
 * Connects as the `postgres` superuser on both sides (no tenant/authorization
 * boundary in this drill — the subject is streaming replication, not access
 * control) and implements the control surface grade.mjs expects.
 *
 * This file is the seam the unit tests replace with fakes; the grader logic
 * itself (grade.mjs) has no Postgres dependency.
 */

/** local/db/schema.sql seeds no rows — every row in app.ledger is one the
 * participant wrote themselves, tagged 'wave-1' or 'wave-2'. */
export const WAVE_1_NOTE = "wave-1";
export const WAVE_2_NOTE = "wave-2";
export const WAVE_1_COUNT = 3;
export const WAVE_2_COUNT = 3;

/**
 * Read pg_stat_replication from the PRIMARY. In this drill's topology there
 * is exactly one possible standby, so at most one row is expected — but we
 * return every row currentReplicationRows sees rather than assuming that, so
 * the grader (not this adapter) is the one place that decides what "exactly
 * one, streaming" means.
 *
 *   state      — 'streaming' once the standby has caught up to a consistent
 *                point and is receiving live WAL, not still catching up from
 *                the base backup.
 *   sentLsn / replayLsn — sentLsn is the last WAL byte position the primary
 *                has sent; replayLsn is the standby's own last-reported
 *                applied position. Their gap (lagBytes) is 0 when the standby
 *                has applied everything sent so far.
 */
async function currentReplicationRows(sql) {
  const rows = await sql`
    select
      application_name,
      state,
      sync_state,
      sent_lsn,
      replay_lsn,
      pg_wal_lsn_diff(sent_lsn, replay_lsn) as lag_bytes
    from pg_stat_replication
  `;
  return rows.map((r) => ({
    applicationName: r.application_name,
    state: r.state,
    syncState: r.sync_state,
    sentLsn: r.sent_lsn,
    replayLsn: r.replay_lsn,
    lagBytes: r.lag_bytes === null ? null : Number(r.lag_bytes),
  }));
}

/**
 * Read recovery/wal-receiver state from the REPLICA itself.
 *   inRecovery — pg_is_in_recovery(): true for as long as this server is a
 *     standby (always, for this drill's replica — it never gets promoted).
 *   walReceiverStatus — pg_stat_wal_receiver.status; 'streaming' once the
 *     replica's walreceiver process is actively receiving WAL (as opposed to
 *     absent — no walreceiver running at all — or 'stopped').
 */
async function currentReplicaRecovery(sql) {
  const [recoveryRows, receiverRows] = await Promise.all([
    sql`select pg_is_in_recovery() as in_recovery`,
    sql`select status, slot_name, sender_host from pg_stat_wal_receiver`,
  ]);
  const receiver = receiverRows[0];
  return {
    inRecovery: recoveryRows[0]?.in_recovery === true,
    walReceiverStatus: receiver?.status ?? null,
    slotName: receiver?.slot_name ?? null,
    senderHost: receiver?.sender_host ?? null,
  };
}

/**
 * Live counts of the two markers this drill asks the participant to write,
 * read from BOTH sides. The replica is read-only to every role including
 * `postgres` (any regular DML — not just for `participant` — is rejected
 * while a server is in recovery), so a count on the replica that matches the
 * primary can only be explained by genuine WAL replay: there is no
 * privilege, on either side, that lets anyone write directly into the
 * replica's app.ledger to fake this without ever discovering a way is
 * enforced.
 */
async function currentLedgerCounts(sqlPrimary, sqlReplica) {
  const countBy = async (sql) => {
    const rows = await sql`
      select
        count(*) filter (where note = ${WAVE_1_NOTE}) as wave1,
        count(*) filter (where note = ${WAVE_2_NOTE}) as wave2
      from app.ledger
    `;
    const row = rows[0];
    return { wave1: Number(row?.wave1 ?? 0), wave2: Number(row?.wave2 ?? 0) };
  };
  const [primary, replica] = await Promise.all([countBy(sqlPrimary), countBy(sqlReplica)]);
  return { primary, replica };
}

/**
 * @param {import('postgres').Sql} sqlPrimary
 * @param {import('postgres').Sql} sqlReplica
 */
export function createPgGraderClient(sqlPrimary, sqlReplica) {
  return {
    async replicationRows() {
      return currentReplicationRows(sqlPrimary);
    },
    async replicaRecovery() {
      return currentReplicaRecovery(sqlReplica);
    },
    async ledgerCounts() {
      return currentLedgerCounts(sqlPrimary, sqlReplica);
    },
  };
}
