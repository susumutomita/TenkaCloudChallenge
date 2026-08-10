/**
 * pg-client — the live Postgres adapter the grader drives inside the container.
 *
 * Connects as the `postgres` superuser (no tenant/authorization boundary in this
 * drill — the subject is transaction behaviour, not access control) and implements
 * the control surface grade.mjs expects.
 *
 * This file is the seam the unit tests replace with a fake; the grader logic itself
 * (grade.mjs) has no Postgres dependency.
 */

/** The fixed accounts every check reads — same ids the participant transfers
 * between themselves. alice is the source, bob is the destination, carol never
 * takes part in any transfer (a bystander whose balance must stay untouched). */
export const ALICE_ID = 1;
export const BOB_ID = 2;
export const CAROL_ID = 3;

/** Seed values from local/db/seed.sql (3000 + 10000 + 7000). Fixed and known ahead
 * of time — like db-a2-index-tradeoff's TARGET_ORDER_NUMBER or db-a3-query-plan's
 * RARE_VALUE/COMMON_VALUE, this is public: it is exactly what the instructions tell
 * the participant to work with, not a hidden answer. */
export const ORIGINAL_TOTAL_CENTS = 20000;

/**
 * Read the CURRENT total balance across every row in bank.accounts (not just alice
 * and bob) — deliberately table-wide so a stray side effect on carol from an
 * unfinished demo attempt still shows up here, even in a scenario where alice's and
 * bob's own balances happen to look individually correct.
 */
async function currentTotalBalanceCents(sql) {
  const rows = await sql`select coalesce(sum(balance_cents), 0)::bigint as total from bank.accounts`;
  return Number(rows[0].total);
}

/** Read alice's and bob's CURRENT balances (the two accounts a correct transfer touches). */
async function currentTransferBalancesCents(sql) {
  const rows = await sql`
    select id, balance_cents
    from bank.accounts
    where id in (${ALICE_ID}, ${BOB_ID})
  `;
  const byId = new Map(rows.map((r) => [r.id, Number(r.balance_cents)]));
  return { alice: byId.get(ALICE_ID) ?? null, bob: byId.get(BOB_ID) ?? null };
}

/**
 * Read the `xmin` system column for alice's and bob's rows — the id of the
 * transaction that most recently wrote each row. Every row a single transaction
 * writes (whether via one multi-row UPDATE or several statements inside the same
 * BEGIN…COMMIT) carries the SAME xmin. Two separate autocommit statements each get
 * their own transaction id and therefore different xmin values — this is what makes
 * "were these two rows' current values written atomically, together" a live,
 * unfakeable fact about the database rather than something inferred from the
 * account numbers alone. Cast to text: xid is a 32-bit type the JS driver need not
 * interpret numerically, only compare for equality.
 */
async function currentTransferXmins(sql) {
  const rows = await sql`
    select id, xmin::text as xmin
    from bank.accounts
    where id in (${ALICE_ID}, ${BOB_ID})
  `;
  const byId = new Map(rows.map((r) => [r.id, r.xmin]));
  return { alice: byId.get(ALICE_ID) ?? null, bob: byId.get(BOB_ID) ?? null };
}

/** @param {import('postgres').Sql} sql */
export function createPgGraderClient(sql) {
  return {
    async totalBalanceCents() {
      return currentTotalBalanceCents(sql);
    },
    async transferBalancesCents() {
      return currentTransferBalancesCents(sql);
    },
    async transferXmins() {
      return currentTransferXmins(sql);
    },
  };
}
