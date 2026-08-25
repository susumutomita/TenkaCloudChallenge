import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

/**
 * `cs-foundations` (Issue 407) — 学習ルートが散文と metadata の 2 箇所に分かれて食い違わないための契約。
 * `scripts/stackstack-learning-path.test.ts` が `stackstack-route` に対して持つのと同じ契約を、
 * この track にも作る。
 *
 * ## なぜ要るか
 *
 * この track の章立ては `docs/curricula/cs-foundations/curriculum.md` の表と、各問題の
 * `metadata.json` の `track` フィールドの 2 箇所に分かれて書かれていて、どちらも人が手で書く。
 * 実際に、この 2 つはすでに 1 度乖離した。curriculum.md は 2026-08-09 の初回コミットで
 * order 10-50 (第 1 章-第 5 章) の表を書いた後、`#435`-`#438` (第 1 期残り)、`#479` (第 2 期 4 問 +
 * `cs-pagination-drift`)、`#484` (`asm-worst-case-latency`) で order 60-110 の 6 章が catalog へ
 * 追加されたが、この文書は order 50 のまま 3 回のリリースを跨いで更新されなかった。
 * `bun run scripts/validate-problems.ts` は schema としてどちらも正しいので気付けず、
 * ポータルの「講座トラック」画面が案内する章と、なぜその順序かを説明する文書が黙って食い違っていた。
 *
 * ## curriculum.md が主張していることのうち、ここで機械検証するもの
 *
 * 1. 表に載っている order・章・難易度が、各問題の `track` / `difficulty` と一致する。
 * 2. track に属する問題が他にいない (表に無い問題が黙って track へ入っていない)。
 * 3. track 上の問題はすべて local play で起動できる (`local/` を持つ)。
 * 4. order は重複せず、表の掲載順と一致する。
 */

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TRACK_ID = "cs-foundations";
const CURRICULUM = join(ROOT, "docs", "curricula", "cs-foundations", "curriculum.md");

interface Metadata {
  readonly id: string;
  readonly difficulty?: number;
  readonly track?: { readonly id: string; readonly order: number; readonly chapter: string };
}

function metadata(directory: string): Metadata {
  return JSON.parse(readFileSync(join(ROOT, directory, "metadata.json"), "utf8")) as Metadata;
}

/** `battles` と `challenges` にある全問題のディレクトリ。 */
function allProblemDirs(): string[] {
  return ["battles", "challenges"].flatMap((group) =>
    readdirSync(join(ROOT, group))
      .map((name) => `${group}/${name}`)
      .filter((dir) => existsSync(join(ROOT, dir, "metadata.json"))),
  );
}

/**
 * curriculum.md の章立て表から `| order | \`id\` | 難易度 | 章 | (任意の追加列) |` を読む。
 *
 * この track の表は「扱う飛躍」という 5 列目を持つので、`stackstack-learning-path.test.ts` の
 * 正規表現とは違い行末を `$` で固定しない (4 列目の後に何が続いても構わない)。
 * 文書を正本として読むので、表を直せばこのテストの期待値も一緒に動く。期待値をここへ転記すると、
 * 順序の正本が 3 箇所になって問題が増えるだけになる。
 */
function curriculumRoute(): { id: string; order: number; chapter: string; difficulty: number }[] {
  const rows = readFileSync(CURRICULUM, "utf8").matchAll(
    /^\|\s*(\d+)\s*\|\s*`([\w-]+)`\s*\|\s*d(\d+)\s*\|\s*([^|]+?)\s*\|/gm,
  );
  return [...rows].map((row) => ({
    order: Number(row[1]),
    id: row[2],
    difficulty: Number(row[3]),
    chapter: row[4],
  }));
}

describe("cs-foundations の学習ルート", () => {
  const route = curriculumRoute();

  it("は curriculum.md の表を空にしない", () => {
    // 表の書式が変わって 0 行になると、以下のテストが全部 vacuously true になる。
    expect(route.length).toBeGreaterThanOrEqual(11);
  });

  it("は表に書いた order・章・難易度を各問題の metadata と一致させる", () => {
    const dirById = new Map(allProblemDirs().map((dir) => [metadata(dir).id, dir]));
    const actual = route.map(({ id }) => {
      const dir = dirById.get(id);
      if (dir === undefined) {
        return { id, order: undefined, chapter: undefined, difficulty: undefined };
      }
      const meta = metadata(dir);
      const { track } = meta;
      return {
        id,
        order: track?.id === TRACK_ID ? track.order : undefined,
        chapter: track?.chapter,
        difficulty: meta.difficulty,
      };
    });
    expect(actual).toEqual(
      route.map(({ id, order, chapter, difficulty }) => ({ id, order, chapter, difficulty })),
    );
  });

  it("は表に無い問題を黙って track へ入れない", () => {
    const inTrack = allProblemDirs()
      .filter((dir) => metadata(dir).track?.id === TRACK_ID)
      .map((dir) => metadata(dir).id)
      .toSorted();
    expect(inTrack).toEqual(route.map(({ id }) => id).toSorted());
  });

  it("は order を重複させず、表の掲載順に並べる", () => {
    const orders = route.map(({ order }) => order);
    expect(orders).toEqual([...new Set(orders)]);
    expect(orders).toEqual(orders.toSorted((a, b) => a - b));
  });

  it("は local play で起動できない問題を導線へ入れない", () => {
    const dirById = new Map(allProblemDirs().map((dir) => [metadata(dir).id, dir]));
    const notPlayable = route
      .map(({ id }) => id)
      .filter((id) => {
        const dir = dirById.get(id);
        return dir === undefined || !existsSync(join(ROOT, dir, "local"));
      });
    expect(notPlayable).toEqual([]);
  });
});
