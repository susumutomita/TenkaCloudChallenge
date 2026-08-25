#!/usr/bin/env bun
/**
 * Draft・RED-only・未検証な Challenge が自動マージされるのを止める required check (Issue #463)。
 *
 * ## 前提: これは #465 の焼き直しであり、#476 の失敗を踏まえた再設計である
 *
 * #465 がこのゲートを一度導入し、`main` へ merge された。しかしそのゲートは
 * **PR が Draft のあいだも評価のたびに fail を返した**。新問題を長期 Draft PR として
 * 育てる (= まだ human evidence が無くて当然の期間) だけで CI が常時赤になり、
 * repository owner は #476 で「このゲート自体が不要」と判断してワークフロー・
 * checker・テスト・ポリシー文書をまるごと削除した。
 *
 * 直後に #472 (`ac26-w3-ntt-roots`, status: draft) と #475
 * (`stackstack-first-request`, status: ready) が、どちらも human evidence 未検証のまま
 * 通常の CI 経路だけでマージされた (#463 コメント参照)。つまりゲートを消したことで、
 * 防ぎたかった事故がそのまま再発した。
 *
 * このファイルは同じ判定基準を維持しつつ、**#476 が名指しした具体的な摩擦だけ**を
 * 修正する。
 *
 *   - Draft である間はこのゲートを fail にしない (GitHub 自体が Draft の merge を拒む
 *     ので、ここで fail にする必要がない)。evidence と `playtest-verified` label は
 *     「ready for review に変わった時点」から要求する。
 *   - #463 コメント (2026-08-13, PR #473) が指摘した抜け穴も塞ぐ: 新問題や
 *     `status: ready` への昇格だけでなく、**既に `status: ready` な既存問題**の
 *     participant-facing な面 (README / hint / starter / workbench / portal) を
 *     書き換える PR も対象にする。PR #473 はこの種の変更で 6 問の hint / starter を
 *     書き換えたが、当時の検出器は「新規問題でも ready 昇格でもない」として素通りした。
 *
 * ## このゲートが決定論的である理由
 *
 * 判定はすべて次のいずれかから決まる。「LLM が読んで判断する」要素は無い。
 *
 *   - git diff の name-status (どのファイルが追加・変更されたか)
 *   - base/head 各コミットの metadata.json の内容 (`status` フィールド)
 *   - PR の draft フラグ、label 一覧、本文中の 1 個の machine-readable block
 *
 * 「本物の人間が実際に遊んだか」自体は CI から証明できない (Issue #463 の non-goal:
 * 「人間 playtest を source/CI だけで完了扱いにしない」)。このゲートが強制するのは
 * 「その主張を機械可読な形で誰が書いたかが記録に残ること」であり、`tester` /
 * `evidenceUrl` にドキュメントのサンプル値やプレースホルダをそのまま貼ると
 * 明示的に fail する (#463 コメント: PR #472 は evidence block が未記入テンプレートの
 * まま merge された)。
 *
 * ## これでもなお塞げない経路 (repository owner の作業が必要)
 *
 * #463 のコメントが繰り返し指摘している通り、次は repository の設定であり
 * ソースコードからは強制できない。
 *
 *   - この check を `main` の required status check にすること
 *   - bot / GitHub App / administrator による required check bypass を禁止すること
 *   - `playtest-verified` label の付与権限を人間に限定すること
 *   - このファイル・ワークフロー・`docs/PLAYABILITY_GOVERNANCE.md` 自体の変更に
 *     独立した人間レビューを要求すること (このリポジトリの CODEOWNERS は
 *     `* @susumutomita` で全ファイルを対象にしている — branch protection 側で
 *     "Require review from Code Owners" が有効かどうかは、この checker からは
 *     確認できない)
 *
 * 詳細と運用手順は `docs/PLAYABILITY_GOVERNANCE.md`。
 */

interface PlayabilityEvidenceProblem {
  readonly id: string;
  readonly tester: string;
  readonly completedAt: string;
  readonly blind: boolean;
  readonly starterFailed: boolean;
  readonly solutionPassed: boolean;
  readonly negativeCasesPassed: boolean;
  readonly cleanupPassed: boolean;
  readonly evidenceUrl: string;
}

interface PlayabilityEvidence {
  readonly schemaVersion: 1;
  readonly problems: readonly PlayabilityEvidenceProblem[];
}

export interface PlayabilityGateInput {
  readonly draft: boolean;
  readonly body: string;
  readonly labels: readonly string[];
  readonly addedProblemIds: readonly string[];
  readonly promotedReadyProblemIds: readonly string[];
  readonly participantFacingReadyProblemIds?: readonly string[];
  readonly contractOnlyProblemIds?: readonly string[];
}

export interface ProblemChanges {
  readonly addedProblemIds: readonly string[];
  readonly promotedReadyProblemIds: readonly string[];
  readonly participantFacingReadyProblemIds: readonly string[];
  readonly contractOnlyProblemIds: readonly string[];
}

const EVIDENCE_BLOCK = /<!--\s*tenkacloud-playability-v1\s*\n([\s\S]*?)\n\s*-->/gu;
const PROBLEM_PATH = /^(battles|challenges)\/([^/]+)\/(.+)$/u;
const GITHUB_EVIDENCE_URL =
  /^https:\/\/github\.com\/susumutomita\/TenkaCloudChallenge\/(?:issues|pull)\/\d+(?:#issuecomment-\d+)?$/u;

// PR #473 の実例 (README.md / README.ja.md / local/starter/*.py の書き換えだけで
// ヒント文言が答えを漏らした) を機械的に検出できる粒度。参加者が実際に読む・触る
// ファイルだけを対象にし、`local/verifier` や `local/reference` のような裏側の
// 採点コードは対象にしない (そちらは mutation test / solvability audit という
// 既存の決定論的ゲートが担当しており、二重に人間 evidence を要求すると新規の
// 誤検知源になる)。
const PARTICIPANT_FACING_SUBPATHS: readonly RegExp[] = [
  /^README\.md$/u,
  /^README\.ja\.md$/u,
  /^local\/starter\//u,
  /^local\/workbench\//u,
  /^local\/portal\//u,
];

function isParticipantFacingSubPath(subPath: string): boolean {
  return PARTICIPANT_FACING_SUBPATHS.some((pattern) => pattern.test(subPath));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePlayabilityEvidence(body: string): PlayabilityEvidence {
  const matches = [...body.matchAll(EVIDENCE_BLOCK)];
  if (matches.length === 0) {
    throw new Error("playability evidence block is missing");
  }
  if (matches.length !== 1) {
    throw new Error("expected exactly one playability evidence block");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(matches[0][1]);
  } catch {
    throw new Error("playability evidence must be valid JSON");
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.problems)) {
    throw new Error("playability evidence must use schemaVersion 1 with a problems array");
  }
  return parsed as unknown as PlayabilityEvidence;
}

function parseMetadata(
  serialized: string | undefined,
  ref: "base" | "head",
  path: string,
): Record<string, unknown> | undefined {
  if (serialized === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed)) throw new Error("metadata root is not an object");
    return parsed;
  } catch {
    throw new Error(`cannot parse ${ref} metadata for ${path}`);
  }
}

export function classifyProblemChanges(
  nameStatus: string,
  readAtRef: (ref: "base" | "head", path: string) => string | undefined,
  pullRequestTitle = "",
): ProblemChanges {
  const added = new Set<string>();
  const promoted = new Set<string>();
  const participantFacing = new Set<string>();
  const contractOnly = new Set<string>();
  const titleScope = /^(?:feat|test)\(([a-z0-9][a-z0-9-]+)\):/u.exec(pullRequestTitle)?.[1];

  for (const line of nameStatus.split("\n")) {
    if (line.trim().length === 0) continue;
    const [status, path] = line.split("\t");
    if (status === "A" && titleScope && path === `scripts/${titleScope}.test.ts`) {
      contractOnly.add(titleScope);
    }

    const match = path?.match(PROBLEM_PATH);
    if (!match) continue;
    const [, category, problemId, subPath] = match;

    if (subPath === "metadata.json") {
      if (status === "A") {
        added.add(problemId);
        continue;
      }
      if (status !== "M") continue;

      const base = parseMetadata(readAtRef("base", path), "base", path);
      const head = parseMetadata(readAtRef("head", path), "head", path);
      if (base?.status !== "ready" && head?.status === "ready") {
        promoted.add(problemId);
      }
      continue;
    }

    if (isParticipantFacingSubPath(subPath)) {
      const metadataPath = `${category}/${problemId}/metadata.json`;
      const head = parseMetadata(readAtRef("head", metadataPath), "head", metadataPath);
      if (head?.status === "ready") {
        participantFacing.add(problemId);
      }
    }
  }

  // すでに「新規追加」として拾われた問題は、同じ PR 内の README / starter 追加を
  // 二重に報告しない。新規問題は addedProblemIds 側の evidence 要求ですでに全部
  // カバーされている。
  for (const id of added) participantFacing.delete(id);

  return {
    addedProblemIds: [...added].sort(),
    promotedReadyProblemIds: [...promoted].sort(),
    participantFacingReadyProblemIds: [...participantFacing].sort(),
    contractOnlyProblemIds: [...contractOnly].sort(),
  };
}

const PLACEHOLDER_TOKENS = new Set([
  "",
  "todo",
  "tbd",
  "n/a",
  "na",
  "changeme",
  "change_me",
  "@github-handle",
  "@your-handle",
  "your-handle",
  "example",
  "pending",
  "xxx",
]);

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_TOKENS.has(value.trim().toLowerCase());
}

// docs/PLAYABILITY_GOVERNANCE.md に載せているサンプル値そのもの。PR #472 は
// evidence block を「未記入テンプレートのまま」merge された (#463 コメント) ので、
// テンプレートの値をそのままコピーしただけの block を明示的に fail にする。
const TEMPLATE_EXAMPLE_EVIDENCE_URL =
  "https://github.com/susumutomita/TenkaCloudChallenge/issues/123#issuecomment-456";

const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

function validateEvidenceProblem(problem: PlayabilityEvidenceProblem): string[] {
  const errors: string[] = [];

  if (typeof problem.tester !== "string" || isPlaceholder(problem.tester)) {
    errors.push(`${problem.id}: tester must identify the human playtester (not left as a placeholder)`);
  }

  if (typeof problem.completedAt !== "string") {
    errors.push(`${problem.id}: completedAt must be an ISO-8601 timestamp`);
  } else {
    const parsed = Date.parse(problem.completedAt);
    if (!Number.isFinite(parsed)) {
      errors.push(`${problem.id}: completedAt must be an ISO-8601 timestamp`);
    } else if (parsed > Date.now() + FUTURE_TOLERANCE_MS) {
      errors.push(`${problem.id}: completedAt must not be in the future`);
    }
  }

  for (const field of [
    "blind",
    "starterFailed",
    "solutionPassed",
    "negativeCasesPassed",
    "cleanupPassed",
  ] as const) {
    if (problem[field] !== true) {
      errors.push(`${problem.id}: ${field} must be true`);
    }
  }

  if (
    typeof problem.evidenceUrl !== "string" ||
    !GITHUB_EVIDENCE_URL.test(problem.evidenceUrl) ||
    problem.evidenceUrl === TEMPLATE_EXAMPLE_EVIDENCE_URL
  ) {
    errors.push(
      `${problem.id}: evidenceUrl must link to a real repository Issue/PR evidence comment (not the documentation example)`,
    );
  }

  return errors;
}

export function affectedProblemIds(
  input: Pick<
    PlayabilityGateInput,
    | "addedProblemIds"
    | "promotedReadyProblemIds"
    | "participantFacingReadyProblemIds"
    | "contractOnlyProblemIds"
  >,
): string[] {
  return [
    ...new Set([
      ...input.addedProblemIds,
      ...input.promotedReadyProblemIds,
      ...(input.participantFacingReadyProblemIds ?? []),
      ...(input.contractOnlyProblemIds ?? []),
    ]),
  ].sort();
}

export function evaluatePlayabilityGate(input: PlayabilityGateInput): string[] {
  const affected = affectedProblemIds(input);
  if (affected.length === 0) return [];

  // #476 の postmortem: このゲートは Draft のあいだも fail を返し、意図的に
  // 未完成な Draft PR を何週間も赤くし続けたことが repository owner がゲートごと
  // 削除する決め手になった。GitHub は Draft PR の merge をそもそも許可しないので、
  // ここで fail にする効果は「余計な赤」以外に無い。evidence は non-draft
  // (= ready for review, つまり merge 候補) になった時点から要求する。
  if (input.draft) return [];

  const errors: string[] = [];
  if (!input.labels.includes("playtest-verified")) {
    errors.push('the human-owned "playtest-verified" label is required after evidence review');
  }

  let evidence: PlayabilityEvidence;
  try {
    evidence = parsePlayabilityEvidence(input.body);
  } catch (error) {
    errors.push(
      `playability evidence is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
    return errors;
  }

  const byId = new Map<string, PlayabilityEvidenceProblem>();
  for (const raw of evidence.problems) {
    if (!isRecord(raw) || typeof raw.id !== "string" || raw.id.trim().length === 0) {
      errors.push("each playability evidence entry must have a non-empty id");
      continue;
    }
    if (byId.has(raw.id)) {
      errors.push(`${raw.id}: duplicate playability evidence entry`);
      continue;
    }
    byId.set(raw.id, raw as unknown as PlayabilityEvidenceProblem);
  }

  for (const id of affected) {
    const problem = byId.get(id);
    if (!problem) {
      errors.push(`${id}: playability evidence is missing`);
      continue;
    }
    errors.push(...validateEvidenceProblem(problem));
  }
  return errors;
}

function runGit(args: readonly string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args[0]} failed: ${new TextDecoder().decode(result.stderr).trim()}`);
  }
  return new TextDecoder().decode(result.stdout);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function main(): void {
  const baseSha = requiredEnvironment("PR_BASE_SHA");
  const headSha = requiredEnvironment("PR_HEAD_SHA");
  const nameStatus = runGit(["diff", "--name-status", `${baseSha}...${headSha}`]);
  const titleValue: unknown = JSON.parse(process.env.PR_TITLE_JSON ?? '""');

  const showCache = new Map<string, string | undefined>();
  const readAtRef = (ref: "base" | "head", path: string): string | undefined => {
    const key = `${ref}:${path}`;
    if (showCache.has(key)) return showCache.get(key);
    const sha = ref === "base" ? baseSha : headSha;
    const result = Bun.spawnSync(["git", "show", `${sha}:${path}`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const value = result.exitCode === 0 ? new TextDecoder().decode(result.stdout) : undefined;
    showCache.set(key, value);
    return value;
  };

  const changes = classifyProblemChanges(
    nameStatus,
    readAtRef,
    typeof titleValue === "string" ? titleValue : "",
  );

  const bodyValue: unknown = JSON.parse(process.env.PR_BODY_JSON ?? '""');
  const labelsValue: unknown = JSON.parse(process.env.PR_LABELS_JSON ?? "[]");
  const draft = process.env.PR_DRAFT === "true";

  const input: PlayabilityGateInput = {
    draft,
    body: typeof bodyValue === "string" ? bodyValue : "",
    labels: Array.isArray(labelsValue)
      ? labelsValue.filter((value): value is string => typeof value === "string")
      : [],
    ...changes,
  };

  const affected = affectedProblemIds(input);
  const errors = evaluatePlayabilityGate(input);

  if (errors.length > 0) {
    console.error("Playability gate failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  if (affected.length === 0) {
    console.log(
      "Playability gate: no new problem, ready promotion, or participant-facing change to a ready problem in this PR.",
    );
    return;
  }

  if (draft) {
    console.log(
      `Playability gate: ${affected.join(", ")} touched by this Draft PR. ` +
        'Evidence and the "playtest-verified" label are required before this can leave Draft — not required while it stays Draft.',
    );
    return;
  }

  console.log(`Playability gate: verified ${affected.join(", ")}.`);
}

if (import.meta.main) main();
