/**
 * Scaffold a new problem so contributors can add one with a single command.
 *
 * Why: previously "add a problem" meant hand-creating a directory, hand-writing a
 * schema-valid metadata.json, and then remembering to run build-index + estimate-cost
 * (CI fails with --check if you forget). This copies a known-good sample as the
 * starting point (so it validates immediately) and regenerates the catalog index, so
 * the only manual work left is editing the two files to describe your problem.
 *
 * ## runtime を先に選ぶ (Issue 388)
 *
 * 入口はもともと `battles|challenges` から始まっていた。これは**競技・採点の形式**であって、
 * Docker / 実クラウド / Simulator という**実行 runtime** とは別の軸である。2 つが 1 つの選択に
 * 潰れていたので、コンテナで足りる問題を作りたい人が CloudFormation の starter から始める、
 * ということが起きていた。
 *
 * いまは runtime と style を独立に受け取る。判断材料は `scripts/problem-runtimes.ts` と
 * `docs/authoring/runtime-and-style.md`。
 *
 * Usage:
 *   bun run new <id> --runtime <runtime> --style <challenge|battle> [--from <sampleId>]
 *   bun run new --runtimes                          # 選べる runtime と使いどころ
 *   bun run new <battles|challenges> <id>           # 旧形式 (移行警告つき)
 *
 * After it runs: edit <category>/<id>/{metadata.json,...}, then
 * `bun run check:problem <id>` and `bun run validate`. The index is regenerated for
 * you (and the pre-commit hook keeps it fresh on every commit).
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Category,
  RUNTIMES,
  RUNTIME_NAMES,
  type RuntimeDeclaration,
  type Style,
  resolveStarter,
} from "./problem-runtimes.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATEGORIES = ["battles", "challenges"] as const;
/** 旧形式で category だけを渡されたときの複製元。runtime は宣言済みのものを引き継ぐ。 */
const LEGACY_SAMPLE: Record<Category, string> = {
  battles: "hello-world-battle",
  challenges: "hello-world",
};
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STYLES: readonly Style[] = ["challenge", "battle"];

export interface Args {
  readonly category: Category;
  readonly id: string;
  readonly from: string;
  /** 選ばれた runtime。旧形式では starter が宣言しているものをそのまま使うので undefined。 */
  readonly runtime?: string;
  readonly declare?: RuntimeDeclaration;
  /** 旧形式で呼ばれたか (呼び出し側が移行警告を出すため)。 */
  readonly legacy: boolean;
}

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

export function parseArgs(argv: readonly string[]): Args | { readonly error: string } {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const from = flag(argv, "from");
  const runtime = flag(argv, "runtime");
  const style = flag(argv, "style");

  // 旧形式: `new <battles|challenges> <id>`。移行期間として受け付ける。
  const legacy = positional[0] === "battles" || positional[0] === "challenges";
  if (legacy) {
    const category = positional[0] as Category;
    const id = positional[1];
    if (runtime || style) {
      return {
        error:
          "--runtime / --style は新形式のものです。`bun run new <id> --runtime <runtime> " +
          "--style <challenge|battle>` の形で、category を位置引数に置かずに呼んでください。",
      };
    }
    if (!id || !ID_RE.test(id)) return { error: `id must be lowercase kebab-case (got ${id ?? "nothing"})` };
    return { category, id, from: from || LEGACY_SAMPLE[category], legacy: true };
  }

  const id = positional[0];
  if (!id || !ID_RE.test(id)) {
    return { error: `id must be lowercase kebab-case (got ${id ?? "nothing"})` };
  }
  if (!runtime) {
    return {
      error:
        "--runtime が必要です。何を学ばせたいかを先に決めてから、それに必要な runtime を" +
        `選んでください。\n  一覧: bun run new --runtimes\n  候補: ${RUNTIME_NAMES.join(", ")}`,
    };
  }
  if (!style || !STYLES.includes(style as Style)) {
    return {
      error:
        `--style は ${STYLES.join(" | ")} のいずれかです (got ${style ?? "nothing"})。\n` +
        "  Challenge = 明確な到達条件があり、flag / multi-verify / probe で完了を判定できる。\n" +
        "  Battle = 時間経過・継続採点・攻撃・防御・他チームとの比較が本質。" +
        "難しい Challenge を Battle と呼ばない。",
    };
  }

  const resolved = resolveStarter(runtime, style as Style);
  if ("error" in resolved) return resolved;
  return {
    category: resolved.category,
    id,
    from: from || resolved.starter,
    runtime,
    declare: resolved.declare,
    legacy: false,
  };
}

/** sample の metadata.json を新 id 向けに書き換える (= 即 validate を通る draft skeleton)。 */
export function rewriteMetadata(raw: string, id: string, declare?: RuntimeDeclaration): string {
  const meta = JSON.parse(raw) as Record<string, unknown>;
  meta.id = id;
  meta.name = `TODO: ${id}`;
  meta.status = "draft"; // 公開前提を外す (= レビューまで catalog に "ready" で出さない)。
  meta.shortDescription = "TODO: one-line description shown in the catalog.";
  // starter が runtime を宣言していない場合だけ書き足す。宣言があるものを上書きすると、
  // その problem 固有の endpoint / verifyUrl / secretEnv を落としてしまう。
  if (declare && meta.runtime === undefined) meta.runtime = declare;
  return `${JSON.stringify(meta, null, 2)}\n`;
}

/**
 * Copy a starter problem into a fresh `<category>/<id>` and rewrite its
 * metadata into a draft skeleton. Pure filesystem step (no reindex, no
 * process.exit) so it is unit-testable: pass `destRoot` to scaffold into a
 * scratch dir and assert the copied artifacts (e.g. both READMEs — #135) land.
 * Throws on a pre-existing destination or a missing starter; `main` turns those
 * into the CLI's error+exit. Returns the created problem directory.
 */
export function scaffoldProblem(
  args: Args,
  { srcRoot = REPO_ROOT, destRoot = REPO_ROOT }: { srcRoot?: string; destRoot?: string } = {},
): string {
  const dest = join(destRoot, args.category, args.id);
  const src = join(srcRoot, args.category, args.from);
  if (existsSync(dest)) {
    throw new Error(`${args.category}/${args.id} already exists.`);
  }
  if (!existsSync(src)) {
    const available = readdirSync(join(srcRoot, args.category)).join(", ");
    throw new Error(`sample ${args.category}/${args.from} not found. Available: ${available}`);
  }
  mkdirSync(dirname(dest), { recursive: true }); // no-op under REPO_ROOT; needed for scratch destRoots.
  cpSync(src, dest, { recursive: true });
  const metaPath = join(dest, "metadata.json");
  writeFileSync(metaPath, rewriteMetadata(readFileSync(metaPath, "utf8"), args.id, args.declare));
  return dest;
}

function reindex(io: { log: (m: string) => void }): void {
  for (const [script, args] of [
    ["scripts/build-index.ts", []],
    ["scripts/estimate-cost.ts", ["--write"]],
  ] as const) {
    const r = spawnSync("bun", ["run", script, ...args], { cwd: REPO_ROOT, stdio: "inherit" });
    if (r.status !== 0) io.log(`[new-problem] WARN ${script} exited ${r.status}; run it manually.`);
  }
}

/** `--runtimes`: 選ぶ前に読むもの。answers ではなく、問題空間を狭めるための材料。 */
export function runtimeCatalogText(): string {
  const lines: string[] = [
    "runtime は「何を学ばせるか」を決めた後に選びます。順序は 学習目標 → runtime → 採点形式。",
    "",
  ];
  for (const [name, spec] of Object.entries(RUNTIMES)) {
    const styles = Object.keys(spec.starters);
    lines.push(`${name}${spec.executable ? "" : "  (まだ実行できません)"}`);
    lines.push(`  ${spec.whenToUse}`);
    if (spec.executable) lines.push(`  作れる形: ${styles.join(" / ")}`);
    else if (spec.status) lines.push(`  現況: ${spec.status}`);
    lines.push("  題材を絞る問い:");
    for (const question of spec.narrowing) lines.push(`    - ${question}`);
    lines.push("  この runtime を選ぶと追加で成立条件になるもの:");
    for (const condition of spec.extraConditions) lines.push(`    - ${condition}`);
    lines.push("");
  }
  lines.push("詳しい判断フロー: docs/authoring/runtime-and-style.md");
  return lines.join("\n");
}

function nextSteps(args: Args): string {
  const spec = args.runtime ? RUNTIMES[args.runtime] : undefined;
  const dir = `${args.category}/${args.id}`;
  const lines = [
    "",
    "Next:",
    `  1. Edit ${dir}/metadata.json (name, description, scoring, endpoints).`,
    `  2. Edit the runtime artifacts under ${dir}/.`,
    `  3. bun run check:problem ${args.id}   # the shipping gate for your problem alone`,
    "  4. bun run validate                   # the whole catalog contract",
    '  5. Set status to "ready" when done, then open a PR.',
  ];
  if (spec) {
    lines.push("", `${args.runtime} を選んだので、追加で成立条件になるもの:`);
    for (const condition of spec.extraConditions) lines.push(`  - ${condition}`);
    lines.push("", "題材がまだ絞れていないなら:");
    for (const question of spec.narrowing) lines.push(`  - ${question}`);
    lines.push(
      "",
      "なぜこの runtime なのかを metadata.json の description か docs/design/ に 1 行残して" +
        "ください。後から読む人が、その判断をやり直さずに済みます。",
    );
  }
  lines.push(
    "",
    "What the gate proves and does not prove: docs/authoring/shipping-gate.md",
    "Runtime と style の選び方: docs/authoring/runtime-and-style.md",
    "The catalog index.json / cost-report.json were regenerated for you.",
  );
  return lines.join("\n");
}

export function main(argv: readonly string[], io = console): number {
  if (argv.includes("--runtimes")) {
    io.log(runtimeCatalogText());
    return 0;
  }
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    io.error(`[new-problem] ${parsed.error}`);
    io.error(
      "Usage: bun run new <id> --runtime <runtime> --style <challenge|battle> [--from <sampleId>]",
    );
    io.error("       bun run new --runtimes        # 選べる runtime と使いどころ");
    return 1;
  }
  if (parsed.legacy) {
    io.error(
      `[new-problem] WARNING: \`bun run new ${parsed.category} ${parsed.id}\` は旧形式です。\n` +
        "  runtime (Docker / 実クラウド / Simulator) と、Challenge / Battle は別の軸です。\n" +
        `  新形式: bun run new ${parsed.id} --runtime <runtime> --style ` +
        `${parsed.category === "battles" ? "battle" : "challenge"}\n` +
        "  一覧: bun run new --runtimes",
    );
  }
  try {
    scaffoldProblem(parsed);
  } catch (error) {
    io.error(`[new-problem] ${(error as Error).message}`);
    return 1;
  }
  io.log(`[new-problem] created ${parsed.category}/${parsed.id} (copied from ${parsed.from}).`);
  reindex({ log: io.log });
  io.log(nextSteps(parsed));
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));

export { CATEGORIES };
