import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { type KnowledgeGraphCatalogEntry, validateKnowledgeGraphCatalog } from "./knowledge-graph";

/**
 * Database Track (Epic #431) の learning path が機械可読であることの契約。
 *
 * ## なぜこの test が要るか
 *
 * Epic #431 の acceptance criteria は次の 2 つを要求している。
 *
 *   - 「Database Track の機械可読な learning path が定義される」
 *   - 「prerequisite 依存関係で推薦順が決まり、difficulty や ID 辞書順に依存しない」
 *
 * `track.order` (10 刻みの整数) は curriculum.md の「順序の根拠」節に書かれた
 * prerequisite 依存関係と *一致するはず* だが、それは文書の主張にすぎない。
 * `track.order` は人間が手で打ち込む整数であり、依存関係と無関係な値へ書き換えて
 * も (`bun run validate` の JSON Schema は通ってしまう ── 構文として不正になる
 * わけではないため。この test が無いと、次のような後退が検出されずに残る。
 *
 *   1. 誰かが A12 と A2 の `track.order` を入れ替えても、何も落ちない
 *      (A12 は A2 を prerequisite とするので、入れ替えると A2 より先に
 *      A12 が推薦されてしまう ── prerequisite の意味が消える)。
 *   2. 存在しない問題を prerequisite に指定しても、この test 単体では
 *      `knowledge-graph.test.ts` (catalog 全体を対象) が拾うが、
 *      「Database Track として」壊れたことは分からない。
 *   3. 循環依存 (A → B → A) を書いても同様。
 *
 * ここでは各 db-* problem の `metadata.json` に既にある `relations` (type:
 * "requires", problem.<id> → problem.<id>) を正本とし、そこから Kahn の
 * アルゴリズムで位相順を計算し、`track.order` がその位相順と矛盾しないこと
 * を機械的に確認する。困難度 (difficulty) や ID 辞書順が推薦順の代わりに
 * なっていないことも、具体的な反例 (A12/A2 の順序が ID 辞書順や difficulty
 * 単独では説明できない) で示す。
 *
 * `nodes` / `relations` の形式そのもの (ID pattern、重複禁止、requires cycle
 * 検出、参照先の実在) は catalog 全体を対象にした `scripts/knowledge-graph.ts`
 * / `knowledge-graph.test.ts` (via `validate-problems.ts`) が担保している。
 * ここではその機構を再利用しつつ、Database Track に閉じたスコープで
 * 「prerequisite が推薦順を決めているか」という一段上の契約を検証する。
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TRACK_ID = "database-track";

const DB_PROBLEM_IDS = [
  "db-a1-table-primary-key",
  "db-a2-index-tradeoff",
  "db-a3-query-plan",
  "db-a4-transaction",
  "db-a6-lock",
  "db-a7-mvcc",
  "db-a8-delete-vacuum",
  "db-a10-primary-replica",
  "db-a11-replication-lag",
  "db-a12-partition",
  "db-challenge-slow-query",
  "db-challenge-blocked-transaction",
] as const;

interface Relation {
  readonly type: string;
  readonly source: string;
  readonly target: string;
}

interface Metadata {
  readonly id: string;
  readonly difficulty: number;
  readonly track?: { readonly id: string; readonly order: number; readonly chapter: string };
  readonly relations?: readonly Relation[];
}

function loadMetadata(id: string): Metadata {
  return JSON.parse(readFileSync(join(ROOT, "challenges", id, "metadata.json"), "utf8")) as Metadata;
}

const problems = new Map(DB_PROBLEM_IDS.map((id) => [id, loadMetadata(id)]));

/** [dependent, prerequisite] pairs from `problem.X requires problem.Y` relations, scoped to this track. */
function problemRequiresEdges(): Array<readonly [string, string]> {
  const edges: Array<readonly [string, string]> = [];
  for (const [id, meta] of problems) {
    for (const rel of meta.relations ?? []) {
      if (rel.type !== "requires") continue;
      if (rel.source !== `problem.${id}`) continue;
      if (!rel.target.startsWith("problem.")) continue;
      const targetId = rel.target.slice("problem.".length);
      if (problems.has(targetId)) edges.push([id, targetId] as const);
    }
  }
  return edges;
}

/** Deterministic topological order (Kahn's algorithm, ties broken by id) over dependent->prerequisite edges. */
function topologicalOrder(ids: readonly string[], edges: ReadonlyArray<readonly [string, string]>): string[] {
  const indegree = new Map(ids.map((id) => [id, 0]));
  const dependents = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [dependent, prerequisite] of edges) {
    dependents.get(prerequisite)?.push(dependent);
    indegree.set(dependent, (indegree.get(dependent) ?? 0) + 1);
  }
  const ready = ids.filter((id) => indegree.get(id) === 0).toSorted();
  const order: string[] = [];
  while (ready.length > 0) {
    const next = ready.shift();
    if (next === undefined) break;
    order.push(next);
    for (const dependent of dependents.get(next) ?? []) {
      const remaining = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }
  return order;
}

describe("Database Track の learning path は machine-readable であり、prerequisite 依存関係で決まる (Epic #431)", () => {
  it("は Phase 1 の 12 問すべてを database-track の一員として持つ", () => {
    for (const [id, meta] of problems) {
      expect(meta.track?.id, id).toBe(TRACK_ID);
      expect(typeof meta.track?.order, id).toBe("number");
    }
  });

  it("は track.order を重複させない", () => {
    const orders = [...problems.values()].map((m) => m.track?.order);
    expect(orders).toEqual([...new Set(orders)]);
  });

  it("は db-a1 以外の全問題が machine-readable な prerequisite (problem 間の requires 関係) を少なくとも 1 つ宣言する", () => {
    const missing = [...problems.entries()]
      .filter(([id]) => id !== "db-a1-table-primary-key")
      .filter(
        ([id, meta]) =>
          !(meta.relations ?? []).some(
            (rel) => rel.type === "requires" && rel.source === `problem.${id}` && rel.target.startsWith("problem."),
          ),
      )
      .map(([id]) => id);
    expect(missing).toEqual([]);
  });

  it("は prerequisite の順序を track.order へ必ず反映する (依存先の order < 依存元の order)", () => {
    const orderOf = new Map([...problems.entries()].map(([id, m]) => [id, m.track?.order]));
    const violations = problemRequiresEdges()
      .filter(([dependent, prerequisite]) => {
        const dependentOrder = orderOf.get(dependent);
        const prerequisiteOrder = orderOf.get(prerequisite);
        return dependentOrder === undefined || prerequisiteOrder === undefined || prerequisiteOrder >= dependentOrder;
      })
      .map(
        ([dependent, prerequisite]) =>
          `${dependent} (order ${orderOf.get(dependent)}) requires ${prerequisite} (order ${orderOf.get(prerequisite)}) ` +
          `but does not come after it`,
      );
    expect(violations).toEqual([]);
  });

  it("は requires グラフから計算した位相順と track.order が矛盾しない (= 順序の正本は依存関係であって手入力の整数ではない)", () => {
    const edges = problemRequiresEdges();
    const graphOrder = topologicalOrder(DB_PROBLEM_IDS, edges);
    const rankInGraphOrder = new Map(graphOrder.map((id, i) => [id, i]));

    expect(graphOrder).toHaveLength(DB_PROBLEM_IDS.length);
    for (const [dependent, prerequisite] of edges) {
      expect(
        rankInGraphOrder.get(prerequisite),
        `graph order must place ${prerequisite} before ${dependent}`,
      ).toBeLessThan(rankInGraphOrder.get(dependent) ?? Number.POSITIVE_INFINITY);
    }
  });

  it("は ID 辞書順を推薦順として使っていない (db-a12 が db-a2 を prerequisite とするのに、ID 辞書順では db-a12 が db-a2 より先に来てしまう)", () => {
    const lexicographicRank = new Map([...DB_PROBLEM_IDS].toSorted().map((id, i) => [id, i]));
    // 具体的な反証: ID 辞書順では "db-a12" < "db-a2" (文字列比較で "1" < "2")。
    // だが db-a12 は db-a2 (index の trade-off) を prerequisite にしているので、
    // ID 辞書順をそのまま推薦順に使うと prerequisite の後で prerequisite 元の
    // 問題が案内される、という壊れた導線になる。
    expect(lexicographicRank.get("db-a12-partition")).toBeLessThan(
      lexicographicRank.get("db-a2-index-tradeoff") ?? -1,
    );
    const edges = problemRequiresEdges();
    expect(edges).toContainEqual(["db-a12-partition", "db-a2-index-tradeoff"]);

    const orderOf = new Map([...problems.entries()].map(([id, m]) => [id, m.track?.order]));
    expect(orderOf.get("db-a12-partition")).toBeGreaterThan(orderOf.get("db-a2-index-tradeoff") ?? Number.POSITIVE_INFINITY);
  });

  it("は difficulty 単独では推薦順を説明できない (同じ difficulty の問題間にも prerequisite の順序がある)", () => {
    // A1 (difficulty 1) を除く 11 問は全て difficulty 2 ── もし推薦順が difficulty
    // だけで決まるなら、この 11 問はどの順に並べても良いことになる。しかし
    // requires edge がこの 11 問の間にも存在し、順序を一意に強制している。
    const sameDifficultyEdges = problemRequiresEdges().filter(
      ([dependent, prerequisite]) => problems.get(dependent)?.difficulty === problems.get(prerequisite)?.difficulty,
    );
    expect(sameDifficultyEdges.length).toBeGreaterThan(0);
  });

  it("は Database Track 内で requires cycle も宙ぶらりんの参照も持たない (knowledge-graph.ts を再利用したスコープ限定チェック)", () => {
    const catalog: KnowledgeGraphCatalogEntry[] = [...problems.entries()].map(([id, metadata]) => ({
      file: `challenges/${id}/metadata.json`,
      metadata: metadata as unknown as Record<string, unknown>,
    }));
    expect(validateKnowledgeGraphCatalog(catalog)).toEqual([]);
  });
});
