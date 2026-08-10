/**
 * pg-client — the live Postgres adapter the grader drives inside the container.
 *
 * Connects as the `postgres` superuser (there is no tenant/authorization
 * boundary in this drill — the whole subject is table/row/primary-key, not
 * access control), and implements the control surface grade.mjs expects.
 *
 * This file is the seam the unit tests replace with a fake; the grader logic
 * itself (grade.mjs) has no Postgres dependency.
 */

/** @param {import('postgres').Sql} sql */
export function createPgGraderClient(sql) {
  return {
    async membersPrimaryKeyColumns() {
      const rows = await sql`
        select a.attname as column_name
        from pg_index i
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
        join pg_class c on c.oid = i.indrelid
        join pg_namespace n on n.oid = c.relnamespace
        where i.indisprimary
          and n.nspname = 'training'
          and c.relname = 'members'
      `;
      return rows.length === 0 ? null : rows.map((r) => r.column_name);
    },

    async membersRowCount() {
      try {
        const rows = await sql`select count(*)::int as n from training.members`;
        return rows[0].n;
      } catch {
        return null; // relation does not exist yet
      }
    },

    async unkeyedDistinctEmailCount() {
      const rows = await sql`
        select count(distinct email)::int as n from training.members_unkeyed
      `;
      return rows[0].n;
    },

    /**
     * Try to insert a second row with an email already present in
     * training.members. Runs inside a transaction that is ALWAYS rolled back —
     * a passing probe (the insert throws) and a failing probe (the insert
     * succeeds) both leave zero trace in the participant's data.
     */
    async attemptDuplicateInsert() {
      let outcome = { rejected: false, reason: "no-rows" };
      try {
        await sql.begin(async (tx) => {
          let existing;
          try {
            existing = await tx`select email from training.members limit 1`;
          } catch {
            throw new RollbackSignal(); // training.members does not exist yet
          }
          if (existing.length === 0) throw new RollbackSignal();
          try {
            await tx`
              insert into training.members (email, display_name)
              values (${existing[0].email}, 'grader-probe')
            `;
            outcome = { rejected: false, reason: "insert-succeeded" };
          } catch (error) {
            outcome = { rejected: error?.code === "23505", sqlState: error?.code };
          }
          throw new RollbackSignal(); // never persist the probe either way
        });
      } catch (error) {
        if (!(error instanceof RollbackSignal)) throw error;
      }
      return outcome;
    },
  };
}

class RollbackSignal extends Error {
  constructor() {
    super("__grader_rollback__");
    this.name = "RollbackSignal";
  }
}
