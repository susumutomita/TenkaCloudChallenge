import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

/**
 * `stackstack-route` — 学習ルートが散文と metadata の 2 箇所に分かれて食い違わないための契約
 * (Issue 397、PR #405 が提起したもの)。
 *
 * ## なぜ要るか
 *
 * ルートの順序は 15 個の `metadata.json` に 1 問ずつ分かれて書かれていて、その根拠は
 * `docs/curricula/stackstack-route/curriculum.md` の表にある。**同じ順序が 2 箇所にあって、
 * どちらも人が手で書く**。問題を 1 つ足したときに表だけ直して metadata を忘れても、
 * `bun run validate` は通る — schema としてはどちらも正しいままだからで、壊れるのは
 * 「ポータルが案内する順序」と「なぜその順序なのかを説明した文書」の一致だけになる。
 * これは実行しても気付けない種類の後退なので、ここで固定する。
 *
 * ## curriculum.md が主張していることのうち、ここで機械検証するもの
 *
 * 1. 表に載っている order と章が、各問題の `track` と一致する。
 * 2. ルートに属する問題が他にいない (表に無い問題が黙って track に入っていない)。
 * 3. **ルート上の問題はすべて local play で起動できる。** これが一番効く。curriculum は
 *    `wp2shell-friday-night-patch` を「`local/` を持たないので、導線に入れると解けない問題へ
 *    誘導することになる」という理由で外している (Issue 402)。この判断は文章にしか無く、
 *    後から AWS 専用問題を track へ足しても何も落ちない。落とす。
 * 4. `xss-demo` / `csrf-demo` が `ipa-web-security` に残っている。curriculum の「既知の断絶 1」は
 *    この 2 問をルートへ移さなかったことを明示的な判断として記録している (`track` は 1 問に 1 つ
 *    なので、移すと IPA 対応の体系が消える)。order 50 / 60 が空席なのはその結果で、
 *    埋めるなら断絶の記述も一緒に直る必要がある。
 */

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TRACK_ID = "stackstack-route";
const CURRICULUM = join(ROOT, "docs", "curricula", "stackstack-route", "curriculum.md");

interface Metadata {
  readonly id: string;
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
 * curriculum.md の章立て表から `| order | \`id\` | 難易度 | 章 |` を読む。
 *
 * 文書を正本として読むので、表を直せばこのテストの期待値も一緒に動く。期待値をここへ
 * 転記すると、順序の正本が 3 箇所になって問題が増えるだけになる。
 */
function curriculumRoute(): { id: string; order: number; chapter: string }[] {
  const rows = readFileSync(CURRICULUM, "utf8").matchAll(
    /^\|\s*(\d+)\s*\|\s*`([\w-]+)`\s*\|[^|]*\|\s*([^|]+?)\s*\|\s*$/gm,
  );
  return [...rows].map((row) => ({ order: Number(row[1]), id: row[2], chapter: row[3] }));
}

describe("stackstack-route の学習ルート", () => {
  const route = curriculumRoute();

  it("は curriculum.md の表を空にしない", () => {
    // 表の書式が変わって 0 行になると、以下のテストが全部 vacuously true になる。
    expect(route.length).toBeGreaterThanOrEqual(15);
  });

  it("は表に書いた order と章を各問題の metadata と一致させる", () => {
    const dirById = new Map(allProblemDirs().map((dir) => [metadata(dir).id, dir]));
    const actual = route.map(({ id }) => {
      const dir = dirById.get(id);
      if (dir === undefined) return { id, order: undefined, chapter: undefined };
      const { track } = metadata(dir);
      return { id, order: track?.id === TRACK_ID ? track.order : undefined, chapter: track?.chapter };
    });
    expect(actual).toEqual(route.map(({ id, order, chapter }) => ({ id, order, chapter })));
  });

  it("は表に無い問題を黙って track へ入れない", () => {
    const inTrack = allProblemDirs()
      .filter((dir) => metadata(dir).track?.id === TRACK_ID)
      .map((dir) => metadata(dir).id)
      .toSorted();
    expect(inTrack).toEqual(route.map(({ id }) => id).toSorted());
  });

  it("は order を重複させない", () => {
    const orders = route.map(({ order }) => order);
    expect(orders).toEqual([...new Set(orders)]);
    expect(orders).toEqual(orders.toSorted((a, b) => a - b));
  });

  it("は local play で起動できない問題を導線へ入れない", () => {
    // curriculum が `wp2shell-friday-night-patch` を外した理由 (Issue 402) をそのまま契約にする。
    // AWS 専用問題を後から足すと、8 問を終えた人がカードを開いて行き止まる。
    const dirById = new Map(allProblemDirs().map((dir) => [metadata(dir).id, dir]));
    const notPlayable = route
      .map(({ id }) => id)
      .filter((id) => {
        const dir = dirById.get(id);
        return dir === undefined || !existsSync(join(ROOT, dir, "local"));
      });
    expect(notPlayable).toEqual([]);
  });

  it("は XSS / CSRF を IPA の体系から引き剥がしていない", () => {
    // 「既知の断絶 1」がこの 2 問を移さなかったことを判断として記録している。移すなら
    // curriculum の断絶の記述も一緒に直る必要があるので、片方だけ動くのを止める。
    for (const dir of ["challenges/xss-demo", "challenges/csrf-demo"]) {
      expect(metadata(dir).track?.id).toBe("ipa-web-security");
    }
    expect(route.map(({ order }) => order)).not.toContain(50);
    expect(route.map(({ order }) => order)).not.toContain(60);
  });
});
