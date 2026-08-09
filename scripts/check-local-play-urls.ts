#!/usr/bin/env bun
/**
 * local play の割り当てポートを焼き込んでいないか (Issue 399)。
 *
 * ## 何が起きたか
 *
 * 2026-08-08 の local play で、`stackstack-onboarding` を起動したまま `wix-exposure-audit` を
 * 起動すると、後者は 18080 が埋まっているため 19080 へ**再割り当て**された。ポータルは正しく
 * 19080 を表示していたが、問題文とアプリが 18080 を焼き込んでいたため、指示どおり開くと
 * **別の問題**が出た。`wix-exposure-audit` は robots.txt → sitemap.xml → preview page と辿る
 * 導線そのものが主題なので、これは問題の主経路が壊れることを意味する。
 *
 * 1 問だけ起動している間は表面化しない。「前の問題を開いたまま次を試す」という自然な操作を
 * した瞬間にだけ壊れるので、作者は自分では踏まない。
 *
 * ## 何を焼き込みと呼ぶか
 *
 * ポート番号で決め打ちしない。**その問題の compose が host 側へ publish しているポート**、
 * つまり launcher が奪われたときに付け替える対象だけを見る。`secure-ota-rollback` の 18100 の
 * ように既定と違うポートも、`ports:` から読むので同じ規則で捕まる。
 *
 * 逆に、compose の healthcheck が使う `127.0.0.1:8080` は**コンテナ内部**のポートで、
 * 再割り当ての対象ではない。publish されたポートだけを見る規則はこれを自動的に除外する。
 *
 * ## 見る場所
 *
 *   - metadata.json の参加者向け文面 (instructions / hints / description)
 *   - `local/` 配下のアプリと初期化スクリプト (参加者へ配信される内容を作る側)
 *
 * README は対象外にしてある。あれは問題を選ぶ前に GitHub で読む文書で、起動中の割り当てを
 * 参照しようがない。**代わりに** README では既定ポートを例として書いてよい。
 */

import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const SCANNED_EXTENSIONS = [".mjs", ".js", ".cjs", ".ts", ".py", ".sh", ".php", ".html", ".sql"];

export interface UrlFinding {
  readonly problemId: string;
  readonly file: string;
  readonly line: number;
  readonly port: number;
  readonly excerpt: string;
}

/**
 * 対象外。**「読みにくいから」「直すのが面倒だから」は理由にならない。**
 * 「そのポート番号が採点対象のデータそのもの」という場合だけ。
 */
const ALLOWED: readonly { readonly prefix: string; readonly reason: string }[] = [
  {
    prefix: "challenges/mcp-origin-guardian/local/",
    reason:
      "この問題の採点対象は Origin ヘッダーの値そのもの (どの origin を development origin と" +
      "認めるか)。URL は導線ではなく fixture なので、Host から組み立て直すと問題が成立しない。",
  },
];

/**
 * compose が host 側へ publish しているポート。launcher が付け替える対象。
 *
 * host 側は素の数値のほか `${RLS_APP_PORT:-18080}` の形も取る (`rls-tenant-isolation`)。
 * 既定値を読まないと、その問題だけ検査対象が空になり黙って素通りする。
 */
export function publishedPorts(composeSource: string): number[] {
  const ports = new Set<number>();
  // "127.0.0.1:18080:80" / "18080:80" / "127.0.0.1:${PORT:-18080}:8080/tcp"
  const host = String.raw`(?:\d+|\$\{\w+:-(\d+)\})`;
  const line = new RegExp(
    String.raw`^\s*-\s*["']?(?:(?:\d{1,3}\.){3}\d{1,3}:)?(${host}):\d+(?:\/\w+)?["']?\s*(?:#.*)?$`,
    "gm",
  );
  for (const match of composeSource.matchAll(line)) {
    ports.add(Number(match[2] ?? match[1]));
  }
  return [...ports].sort((a, b) => a - b);
}

/** ソース中に現れる `127.0.0.1:<port>` / `localhost:<port>` のうち、publish されたもの。 */
export function findPinnedPorts(
  source: string,
  ports: readonly number[],
): { line: number; port: number; excerpt: string }[] {
  if (ports.length === 0) return [];
  const wanted = new Set(ports);
  const out: { line: number; port: number; excerpt: string }[] = [];
  source.split("\n").forEach((text, index) => {
    for (const match of text.matchAll(/(?:127\.0\.0\.1|localhost):(\d+)/g)) {
      const port = Number(match[1]);
      if (!wanted.has(port)) continue;
      out.push({ line: index + 1, port, excerpt: text.trim().slice(0, 120) });
    }
  });
  return out;
}

/** 参加者が読む文面だけを平坦化する (内部フィールドや runtime 宣言は対象外)。 */
export function participantProse(metadata: unknown): string {
  const meta = metadata as Record<string, unknown>;
  const parts: string[] = [];
  const push = (node: unknown): void => {
    if (typeof node === "string") parts.push(node);
    else if (Array.isArray(node)) node.forEach(push);
    else if (node && typeof node === "object") Object.values(node).forEach(push);
  };
  // runtime.verifyUrl と runtime.challengeEndpoints は**宣言**であり、platform が実際の
  // 割り当てへ書き換える。ここで既定ポートを書くのが正しいので、対象に含めない。
  for (const key of ["instructions", "description", "shortDescription", "scoring", "i18n"]) {
    push(meta[key]);
  }
  return parts.join("\n");
}

function isAllowed(file: string): string | undefined {
  return ALLOWED.find((entry) => file.startsWith(entry.prefix))?.reason;
}

export function scanProblem(dir: string): UrlFinding[] {
  const compose = join(dir, "local", "docker-compose.yml");
  if (!existsSync(compose)) return [];
  const ports = publishedPorts(readFileSync(compose, "utf8"));
  if (ports.length === 0) return [];

  const problemId = dir.split("/")[1] ?? dir;
  const findings: UrlFinding[] = [];

  const metadataPath = join(dir, "metadata.json");
  if (existsSync(metadataPath)) {
    const prose = participantProse(JSON.parse(readFileSync(metadataPath, "utf8")));
    for (const hit of findPinnedPorts(prose, ports)) {
      // 平坦化した文字列の行番号は metadata.json の行番号ではないので出さない。
      findings.push({ problemId, file: metadataPath, line: 0, port: hit.port, excerpt: hit.excerpt });
    }
  }

  for (const match of globSync(join(dir, "local", "**", "*"))) {
    const path = relative(".", match);
    if (!statSync(path).isFile()) continue;
    if (path.endsWith("docker-compose.yml")) continue; // publish 宣言そのもの。
    if (path.includes(".test.") || path.includes("node_modules")) continue;
    if (!SCANNED_EXTENSIONS.some((ext) => path.endsWith(ext))) continue;
    if (isAllowed(path)) continue;
    for (const hit of findPinnedPorts(readFileSync(path, "utf8"), ports)) {
      findings.push({ problemId, file: path, line: hit.line, port: hit.port, excerpt: hit.excerpt });
    }
  }
  return findings;
}

export function scanAll(): UrlFinding[] {
  return globSync("{battles,challenges}/*/local/docker-compose.yml")
    .map((compose) => dirname(dirname(compose)))
    .sort()
    .flatMap(scanProblem);
}

function main(): number {
  const findings = scanAll();
  if (findings.length === 0) {
    console.log("OK: local play の割り当てポートを焼き込んでいる箇所はありません。");
    return 0;
  }
  for (const finding of findings) {
    const where = finding.line > 0 ? `${finding.file}:${finding.line}` : `${finding.file} (参加者向け文面)`;
    console.error(`NG  ${where}  [port ${finding.port}]`);
    console.error(`    ${finding.excerpt}`);
  }
  console.error(
    `\n${findings.length} 件。local play は空いているポートへ再割り当てするので、焼き込んだ` +
      "アドレスは別の問題を指します (Issue 399)。参加者向け文面ではポータルが表示する" +
      "アクセス先 URL を参照させ、アプリが返す絶対 URL は `Host` ヘッダーから組み立ててください。",
  );
  return 1;
}

if (import.meta.main) process.exit(main());
