/**
 * db-a1-table-primary-key — automated grader (the primary evaluation).
 *
 * PURE and dependency-injected: it never opens a socket or a Postgres
 * connection itself. It drives an injected `client` that reads live database
 * state, exactly the way the participant left it:
 *
 *   client.membersPrimaryKeyColumns()  -> string[] | null   (null = table missing, [] = table exists with no PRIMARY KEY at all)
 *   client.membersRowCount()           -> number | null     (null = table missing)
 *   client.unkeyedDistinctEmailCount() -> number
 *   client.attemptDuplicateInsert()    -> { rejected: boolean, sqlState?: string, reason?: string }
 *
 * Each of the 3 checkpoints below resolves to a `{ id, label, passed, detail }`
 * result, one per `scoring.checks[]` entry in metadata.json (same ids). `/verify`
 * grades ONE checkpoint per request (TenkaCloud#2252's checkpointId contract);
 * `evaluateCheckpoint` looks up the matching entry and runs only that one.
 *
 * Why this shape: there is no flag to type and no submission text is ever read.
 * "Correct" is a fact about the live database — a real PRIMARY KEY exists, the
 * deduplicated data is actually loaded, and the engine itself refuses a second
 * insert of an already-used key. Self-report cannot pass any of the three.
 */

export const CHECKS = [
  {
    id: "members-table-has-primary-key",
    label: "training.members に有効な Primary Key がある",
    async run(client) {
      const pk = await client.membersPrimaryKeyColumns();
      const passed = Array.isArray(pk) && pk.includes("email");
      let detail;
      if (pk === null) {
        detail = "training.members がまだ存在しない。CREATE TABLE から始めよう。";
      } else if (pk.length === 0) {
        detail = "training.members は存在するが、PRIMARY KEY がまだ無い。";
      } else if (!passed) {
        detail = `training.members に PRIMARY KEY はあるが email を含んでいない (現在のキー: ${pk.join(", ")})。`;
      } else {
        detail = `training.members の PRIMARY KEY に email が含まれている (${pk.join(", ")})。`;
      }
      return { passed, detail };
    },
  },
  {
    id: "members-rows-loaded",
    label: "重複を除いた会員データが training.members に入っている",
    async run(client) {
      const [rowCount, distinctCount] = await Promise.all([
        client.membersRowCount(),
        client.unkeyedDistinctEmailCount(),
      ]);
      if (rowCount === null) {
        return { passed: false, detail: "training.members がまだ存在しない。" };
      }
      const passed = distinctCount > 0 && rowCount === distinctCount;
      const detail = passed
        ? `training.members に ${rowCount} 件 — training.members_unkeyed の重複無し件数 (${distinctCount}) と一致している。`
        : `training.members は ${rowCount} 件だが、training.members_unkeyed の重複無し件数は ${distinctCount} 件。過不足がある (読み込み漏れ、または重複がそのまま入っている可能性)。`;
      return { passed, detail };
    },
  },
  {
    id: "duplicate-insert-rejected",
    label: "同じ email の二重登録をデータベースが拒否する",
    async run(client) {
      const outcome = await client.attemptDuplicateInsert();
      const passed = outcome.rejected === true;
      let detail;
      if (outcome.reason === "no-rows") {
        detail = "training.members に行が無いので二重登録を試せない。先にデータを入れよう。";
      } else if (passed) {
        detail = `既存の email をもう一度 INSERT すると engine が拒否した (${outcome.sqlState ?? "constraint violation"})。`;
      } else {
        detail = "既存の email をもう一度 INSERT できてしまった — PRIMARY KEY がまだ効いていない。";
      }
      return { passed, detail };
    },
  },
];

const CHECK_IDS = new Set(CHECKS.map((c) => c.id));

export function isKnownCheckpoint(checkpointId) {
  return CHECK_IDS.has(checkpointId);
}

/** Evaluate exactly one checkpoint (the multi-verify /verify contract grades one at a time). */
export async function evaluateCheckpoint(client, checkpointId) {
  const check = CHECKS.find((c) => c.id === checkpointId);
  if (!check) {
    return { correct: false, message: "unknown checkpoint" };
  }
  const { passed, detail } = await check.run(client);
  return { correct: passed, message: detail };
}
