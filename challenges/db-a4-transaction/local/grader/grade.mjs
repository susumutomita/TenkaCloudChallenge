/**
 * db-a4-transaction — automated grader (the primary evaluation).
 *
 * PURE and dependency-injected: it never opens a socket or runs SQL itself. It
 * drives an injected `client` that reads live database state:
 *
 *   client.totalBalanceCents()    -> number   (sum over EVERY row in bank.accounts)
 *   client.transferBalancesCents() -> { alice: number|null, bob: number|null }
 *   client.transferXmins()        -> { alice: string|null, bob: string|null }
 *
 * Each of the 3 checkpoints below resolves to a `{ id, label, passed, detail }`
 * result, one per `scoring.checks[]` entry in metadata.json (same ids). `/verify`
 * grades ONE checkpoint per request (TenkaCloud#2252's checkpointId contract);
 * `evaluateCheckpoint` looks up the matching entry and runs it.
 *
 * Why this shape: none of the three can be talked into passing by submission text
 * (there is none to read). `total-balance-conserved` catches ANY corruption
 * anywhere in the table, not just a wrong alice/bob pair — including money left
 * behind from an unfinished "no transaction" demo attempt, or an accidental write
 * to carol (the bystander who never takes part in a transfer). `transfer-applied-
 * correctly` requires the EXACT expected end state for the one transfer this drill
 * asks for. `updates-committed-atomically` is the one that cannot be satisfied by
 * "the numbers happen to be right" alone: it reads the `xmin` system column Postgres
 * itself stamps on every row with the id of the transaction that last wrote it, and
 * requires alice's and bob's CURRENT rows to share the same one — proof the final
 * transfer was written as a single atomic unit (one multi-row UPDATE, or several
 * statements inside one BEGIN…COMMIT), not as two independent autocommit
 * statements that merely landed on the right final numbers.
 */

/** Seed total (ORIGINAL_TOTAL_CENTS from pg-client.mjs) must never move — every
 * checkpoint here is graded against a table that always contains exactly these 3
 * rows and no others, so a plain sum is a strong, cheap corruption detector. */
const ORIGINAL_TOTAL_CENTS = 20000;

/** The one transfer this drill asks for: alice (id 1) sends bob (id 2) 1000 cents.
 * alice starts at 3000, bob at 10000 (local/db/seed.sql) — well inside what the
 * balance_cents >= 0 constraint allows, unlike the 5000-cent demo transfer the
 * instructions walk through first specifically because it CANNOT succeed. */
const EXPECTED_TRANSFER_CENTS = 1000;
const EXPECTED_ALICE_BALANCE_CENTS = 3000 - EXPECTED_TRANSFER_CENTS; // 2000
const EXPECTED_BOB_BALANCE_CENTS = 10000 + EXPECTED_TRANSFER_CENTS; // 11000

export const CHECKS = [
  {
    id: "total-balance-conserved",
    label: "口座全体の残高合計が変わっていない (どこにも money が消えたり増えたりしていない)",
    async run(client) {
      const total = await client.totalBalanceCents();
      const passed = total === ORIGINAL_TOTAL_CENTS;
      const detail = passed
        ? `残高合計は ${total} cents で変わっていない。`
        : `残高合計が ${total} cents になっている (本来 ${ORIGINAL_TOTAL_CENTS} cents のはず)。どこかで transaction 無しの途中失敗が residue を残している可能性がある。`;
      return { passed, detail };
    },
  },
  {
    id: "transfer-applied-correctly",
    label: "alice → bob へ 1000 cents の送金が正しく反映されている",
    async run(client) {
      const { alice, bob } = await client.transferBalancesCents();
      const passed = alice === EXPECTED_ALICE_BALANCE_CENTS && bob === EXPECTED_BOB_BALANCE_CENTS;
      const detail = passed
        ? `alice=${alice} cents, bob=${bob} cents — 期待どおり。`
        : `alice=${alice} cents (期待 ${EXPECTED_ALICE_BALANCE_CENTS}), bob=${bob} cents (期待 ${EXPECTED_BOB_BALANCE_CENTS})。まだ送金が完了していない。`;
      return { passed, detail };
    },
  },
  {
    id: "updates-committed-atomically",
    label: "alice と bob の更新が同一トランザクションでコミットされている",
    async run(client) {
      const { alice, bob } = await client.transferXmins();
      const passed = alice !== null && bob !== null && alice === bob;
      const detail = passed
        ? `alice と bob の行の xmin (最終更新トランザクション ID) が一致している (${alice}) — 同じトランザクションでコミットされた。`
        : `alice の xmin=${alice ?? "?"}、bob の xmin=${bob ?? "?"} — 一致していない。2 つの UPDATE が別々の autocommit 文として実行された可能性が高い。BEGIN … COMMIT (または 1 文の UPDATE) で両方をまとめよう。`;
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
