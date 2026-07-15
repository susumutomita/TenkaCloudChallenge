#!/usr/bin/env bun
/**
 * problems/ 配下のすべての metadata.json を problems/SCHEMA.json で validate する。
 * 加えて #951 sub #2 で template.yaml との cross-ref も検査 (= 実 deploy 前に
 * scoring engine が読めない / endpoints が解決できない / portal slot が存在しない
 * パターンを検出する)。
 *
 * Usage:
 *   bun run scripts/validate-problems.ts
 *
 * 失敗時は exit code 1 + エラー内容を stderr に出す。CI / pre-commit で実行する想定。
 */

import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import Ajv2020 from "ajv";
import addFormats from "ajv-formats";
import {
  type KnowledgeGraphCatalogEntry,
  validateKnowledgeGraphCatalog,
} from "./knowledge-graph";
import { checkSimulationOverlay } from "./validate-simulation-overlay";

// このリポジトリは TenkaCloud 本体の `problems/` 配下に git submodule として mount
// される設計のため、 catalog アセット (battles/ challenges/ SCHEMA.json) は repo
// ルート直下に置く。 validation は battles + challenges のみ対象とし、 node_modules /
// .git 等のサブツリーは見ない。
const REPO_ROOT = new URL("..", import.meta.url).pathname;
const PROBLEMS_DIR = REPO_ROOT;
const SCHEMA_PATH = join(REPO_ROOT, "SCHEMA.json");
const CATEGORY_DIRS = ["battles", "challenges"] as const;
type Metadata = Record<string, unknown>;
type ValidationError = string;
const REQUIRED_READMES = ["README.md", "README.ja.md"] as const;

function findMetadataFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      found.push(...findMetadataFiles(full));
    } else if (entry === "metadata.json") {
      found.push(full);
    }
  }
  return found;
}

/**
 * metadata.json と template.yaml の間の cross-ref を検査する。
 *   - flag kind: scoring.flagOutputKey が template.yaml Outputs に存在
 *   - attack-detection kind: scoring.statsOutputKey が Outputs に存在
 *   - endpoints[].default.key (= cfn-output binding) が Outputs に存在
 *   - dashboard.slots["<slot>"] の portal/<file>.tsx が物理 file として存在
 *
 * 実 deploy で CFn が CREATE_COMPLETE しても、 これらの参照が解決できないと
 * scoring engine / portal が壊れるので、 ここで先に止める。
 */
interface CrossRefResult {
  readonly errors: ValidationError[];
  readonly warnings: ValidationError[];
}

/**
 * [contract / AGENT.md §12] 競技者向け `instructions` は必須。 portal は `description` を
 * 競技者に出さない (fairness contract) ため、 これが無いと competitor には shortDescription
 * 1 行しか届かず誘導ゼロになる。 top-level (JA) と i18n.en の両方を要求する。
 */
function checkInstructionsPresent(meta: Metadata): ValidationError[] {
  const errors: ValidationError[] = [];
  const ja = meta.instructions;
  if (typeof ja !== "string" || ja.trim().length === 0) {
    errors.push("instructions (player-facing getting-started) is required — see AGENT.md §12");
  }
  const i18n = meta.i18n as { en?: { instructions?: unknown } } | undefined;
  const en = i18n?.en?.instructions;
  if (typeof en !== "string" || en.trim().length === 0) {
    errors.push("i18n.en.instructions is required — mirror the JA instructions in English");
  }
  return errors;
}

/** 参加者に実際に届く自由文 field。 `description` は運営側なので入らない (下記参照)。 */
const PARTICIPANT_VISIBLE_TEXT_FIELDS = ["instructions", "shortDescription"] as const;

/** 参加者に届く自由文を (field 名, 本文) で列挙する。 未設定 / 非文字列は落とす。 */
function participantVisibleFields(meta: Metadata): Array<readonly [string, string]> {
  const en = (meta.i18n as { en?: Record<string, unknown> } | undefined)?.en;
  return [
    ...PARTICIPANT_VISIBLE_TEXT_FIELDS.map((f) => [f, meta[f]] as const),
    ...PARTICIPANT_VISIBLE_TEXT_FIELDS.map((f) => [`i18n.en.${f}`, en?.[f]] as const),
  ].filter((entry): entry is readonly [string, string] => typeof entry[1] === "string");
}

/** 参加者に予告していない disruption (= サプライズ)。 publicHint: true は作者が意図して公開している。 */
function surpriseDisruptions(meta: Metadata): Array<Record<string, unknown>> {
  const disruptions = Array.isArray(meta.disruptions)
    ? (meta.disruptions as Array<Record<string, unknown>>)
    : [];
  return disruptions.filter((d) => d.publicHint !== true);
}

/**
 * [Issue #192] 競技者視点のネタバラシ検査。
 *
 * SCHEMA は `instructions` を「[競技者向け] ネタバレ厳禁 (採点数値 / hardened state /
 * surprise mechanics は書かない)」と定義しているが、それを機械で確かめるゲートが無かった。
 * 参加者に実際に届く field が `publicHint !== true` の disruption (= サプライズ) を
 * id / name で名指ししていないか検査する。
 *
 * `publicHint: true` の disruption は作者が意図して予告しているので許可する
 * (battles/hello-world-battle は frontend-down を予告し、 初心者に障害と復旧を教えるのが狙い)。
 *
 * ネタバレの正しい置き場は `description` — SCHEMA が [管理者/作者向け] と定義し、 fairness
 * contract (platform #1124) により競技者のポータルには出ない。 よって description は検査
 * 対象に含めない (そこに書くのが正解であり、 移動先でもある)。
 *
 * `id` と `name` (と `i18n.en.name`) の両方を error として見る。 name を warning に留めた版は
 * ゲートとして成立しなかった — validate は warning では落ちないので、 id を書かずに name を
 * そのまま書けばネタバレはそのまま出荷できてしまう。 「無視できる警告」は、 セッションや
 * エージェントがリセットされた次の書き手には存在しないのと同じ。
 *
 * 誤検知の懸念で warning にしていたが、 検査するのは *その問題自身の* サプライズ障害の完全な
 * name の substring 一致であり、 汎用の脆弱性語を見る checkCheckLabelSpoilerAdvisory
 * (= 無害な文にも出るので warning が妥当) とは特異度が違う。 実測でも既存 23 問題は 1 件も
 * 踏まない。 症状を語りたい著者には出口が 2 つある — `description` に書く / `publicHint: true`
 * を宣言して意図的に予告する。
 */
export function checkParticipantVisibleSpoilers(meta: Metadata): ValidationError[] {
  const fields = participantVisibleFields(meta);
  if (fields.length === 0) return [];

  const errors: ValidationError[] = [];
  for (const disruption of surpriseDisruptions(meta)) {
    const id = typeof disruption.id === "string" ? disruption.id : "(unknown)";
    const enName = (disruption.i18n as { en?: { name?: unknown } } | undefined)?.en?.name;
    // id / name / i18n.en.name のどれで書かれてもネタバレは等しく参加者に届く。
    const tells = [disruption.id, disruption.name, enName].filter(
      (tell): tell is string => typeof tell === "string" && tell.trim().length > 0,
    );
    for (const [field, value] of fields) {
      for (const tell of tells) {
        if (!value.includes(tell)) continue;
        errors.push(
          `${field} gives away the surprise disruption "${tell}" (id="${id}") — participant-facing ` +
            "text must not spoil it. Move it to `description` (= [管理者/作者向け]; the fairness " +
            "contract keeps that field off the competitor's portal), or declare " +
            "`disruptions[].publicHint: true` to announce it on purpose.",
        );
      }
    }
  }
  return errors;
}

/**
 * [TenkaCloud#2191] writeup は optional だが、追加する場合は JA canonical と EN override を
 * 必ず対にする。片言語だけの種明かしを出荷すると競技終了後の学習体験が locale で欠落する。
 */
export function checkWriteupTranslations(meta: Metadata): ValidationError[] {
  const ja = typeof meta.writeup === "string" && meta.writeup.trim().length > 0;
  const i18n = meta.i18n as { en?: { writeup?: unknown } } | undefined;
  const en = typeof i18n?.en?.writeup === "string" && i18n.en.writeup.trim().length > 0;
  if (ja === en) return [];
  return ja
    ? ["i18n.en.writeup is required when top-level writeup is present (ja/en parity)"]
    : ["top-level writeup is required when i18n.en.writeup is present (ja/en parity)"];
}

/**
 * [TenkaCloud#2393] Local-play (container) 問題は本番 (Battle / Challenge) に向けた
 * ドリル / 学習の場であり、 解答後に portal へ即出る writeup が「解いた」を「理解した」に
 * 変える摩擦ゼロの導線になる。 container 問題が writeup を 1 つも持たずに出荷されると
 * その導線が空になるため warning を出す (= ソフト必須)。 writeup は schema 上 optional の
 * ままで CI は落とさない — writeup の hard error は ja/en parity (checkWriteupTranslations)
 * だけに保つ。
 */
export function checkContainerWriteupAdvisory(meta: Metadata): ValidationError[] {
  const ja = typeof meta.writeup === "string" && meta.writeup.trim().length > 0;
  const i18n = meta.i18n as { en?: { writeup?: unknown } } | undefined;
  const en = typeof i18n?.en?.writeup === "string" && i18n.en.writeup.trim().length > 0;
  if (ja || en) return [];
  return [
    "local-play (container) problem has no writeup — add a post-solve writeup (top-level ja + i18n.en.writeup) so the drill teaches after the solve, not just scores (TenkaCloud#2393)",
  ];
}

/**
 * [contract / AGENT.md §How to add a problem] Every problem ships an English
 * primary README and a Japanese mirror. This is a release artifact, not an
 * optional review preference, so fail CI before a metadata-only PR can merge.
 */
export function checkRequiredReadmes(dir: string): ValidationError[] {
  const errors: ValidationError[] = [];
  let exactEntries: ReadonlySet<string>;
  try {
    exactEntries = new Set(readdirSync(dir));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return [
      `problem directory cannot be read (${code ?? "unknown error"}) — fix its permissions before validating READMEs`,
    ];
  }
  for (const filename of REQUIRED_READMES) {
    if (!exactEntries.has(filename)) {
      errors.push(
        `${filename} is required with this exact case — add the English primary and Japanese mirror`,
      );
      continue;
    }
    const path = join(dir, filename);
    let stat;
    try {
      stat = lstatSync(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      errors.push(
        code === "ENOENT"
          ? `${filename} is required with this exact case — add the English primary and Japanese mirror`
          : `${filename} cannot be inspected (${code ?? "unknown error"}) — ensure it is a readable regular file`,
      );
      continue;
    }
    if (!stat.isFile()) {
      errors.push(
        `${filename} must be a regular file and not a symlink — see AGENT.md authoring step 4`,
      );
      continue;
    }

    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      errors.push(
        `${filename} cannot be read (${code ?? "unknown error"}) — fix its permissions and encoding`,
      );
      continue;
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      errors.push(`${filename} must be valid UTF-8 text — re-save it as UTF-8`);
      continue;
    }
    if (text.trim().length === 0) {
      errors.push(`${filename} must not be empty — mirror the problem guide in both languages`);
    }
  }
  return errors;
}

/**
 * [contract / ja-en parity] `scoring.hints[]` (= JA canonical) を持つ問題は、 同じ id の英訳を
 * `i18n.en.hints[]` に必ず持たなければならない (= portal の locale switcher で英語競技者にヒントが
 * 日本語のまま残らないようにする)。 翻訳側 id が canonical に無い (= typo / drift) も loud に止める。
 * `penalty` / 順序は language-neutral なので翻訳側では宣言しない (= localizedHints は id + content)。
 */
function checkHintTranslations(meta: Metadata): ValidationError[] {
  const errors: ValidationError[] = [];
  const scoring = meta.scoring as { hints?: unknown } | undefined;
  const rawHints = Array.isArray(scoring?.hints) ? scoring.hints : [];
  const canonicalIds = new Set<string>();
  for (const h of rawHints) {
    if (h && typeof h === "object" && typeof (h as { id?: unknown }).id === "string") {
      canonicalIds.add((h as { id: string }).id);
    }
  }
  if (canonicalIds.size === 0) return errors;

  const i18n = meta.i18n as { en?: { hints?: unknown } } | undefined;
  const enHints = Array.isArray(i18n?.en?.hints)
    ? (i18n.en.hints as Array<Record<string, unknown>>)
    : [];
  const translatedIds = new Set<string>();
  for (const h of enHints) {
    const id = typeof h.id === "string" ? h.id : undefined;
    if (id === undefined) continue;
    translatedIds.add(id);
    if (!canonicalIds.has(id)) {
      errors.push(
        `i18n.en.hints[].id="${id}" は scoring.hints[] に存在しない (= 翻訳の id typo / drift)`,
      );
    }
  }
  for (const id of canonicalIds) {
    if (!translatedIds.has(id)) {
      errors.push(
        `scoring.hints[].id="${id}" の英訳が i18n.en.hints に無い — mirror the JA hint in English (ja/en parity)`,
      );
    }
  }
  return errors;
}

/**
 * [scoring regulation / SCORING.md, AGENT.md §14] Challenge の固定点採点 (flag / verify /
 * multi-flag / multi-verify) を難易度ティアに統一する:
 *   - 満点 (flat points、 または flags[]/checks[] の points 合計) == ティア標準点
 *     (Easy=100 / Medium=200 / Hard=300)
 *   - flat wrongAnswerPenalty == ティアの 5% (5 / 10 / 15)
 *   - 全ヒント減点 (scoring.hints[] + flags[]/checks[].hints[]) の合計 <= 満点の 50%
 * Battle (uptime/phased 採点、 固定 points 無し) は対象外。 固定点が判定できない Challenge も skip。
 */
export function checkScoringRegulation(meta: Metadata): ValidationError[] {
  const errors: ValidationError[] = [];
  if (meta.category !== "Challenge") return errors;
  const scoring = meta.scoring as Record<string, unknown> | undefined;
  if (!scoring) return errors;

  const flat = typeof scoring.points === "number" ? scoring.points : undefined;
  const groups = Array.isArray(scoring.flags)
    ? (scoring.flags as Array<Record<string, unknown>>)
    : Array.isArray(scoring.checks)
      ? (scoring.checks as Array<Record<string, unknown>>)
      : undefined;
  let total = flat;
  if (total === undefined && groups) {
    total = groups.reduce((s, g) => s + (typeof g.points === "number" ? g.points : 0), 0);
  }
  if (typeof total !== "number") return errors; // 固定点が無い (= battle 相当) → skip

  const difficulty = typeof meta.difficulty === "number" ? meta.difficulty : 0;
  const tier =
    difficulty <= 2
      ? { name: "Easy", points: 100, waP: 5 }
      : difficulty === 3
        ? { name: "Medium", points: 200, waP: 10 }
        : { name: "Hard", points: 300, waP: 15 };

  if (total !== tier.points) {
    errors.push(
      `scoring total points=${total} != ${tier.name} tier standard ${tier.points} (difficulty ${difficulty}) — see SCORING.md`,
    );
  }
  if (
    flat !== undefined &&
    typeof scoring.wrongAnswerPenalty === "number" &&
    scoring.wrongAnswerPenalty !== tier.waP
  ) {
    errors.push(
      `scoring.wrongAnswerPenalty=${scoring.wrongAnswerPenalty} != ${tier.name} tier standard ${tier.waP} (= 5% of ${tier.points}) — see SCORING.md`,
    );
  }

  const penalties: number[] = [];
  const collect = (hints: unknown) => {
    if (!Array.isArray(hints)) return;
    for (const h of hints) {
      const p = (h as { penalty?: unknown }).penalty;
      if (typeof p === "number") penalties.push(p);
    }
  };
  collect(scoring.hints);
  if (groups) for (const g of groups) collect(g.hints);
  const sum = penalties.reduce((a, b) => a + b, 0);
  const cap = total * 0.5;
  if (sum > cap) {
    errors.push(
      `sum of hint penalties=${sum} exceeds 50% of points (${cap}) — see SCORING.md`,
    );
  }
  return errors;
}

/**
 * [Composite Runtime / TenkaCloud#2058] 複合 runtime 問題 (runtime.kind === "composite")。
 * target ごとに entry の実在と AWS target の CFn 整合性を検査する。
 */
function isCompositeProblem(meta: Metadata): boolean {
  const runtime = meta.runtime as { kind?: unknown } | undefined;
  return runtime?.kind === "composite";
}

const PINNED_APPRUN_IMAGE =
  /^(?:ghcr\.io|docker\.io|index\.docker\.io|registry\.sakura\.ad\.jp)\/[A-Za-z0-9._/-]+@sha256:[a-f0-9]{64}$/;

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Composite-only AppRun contract. A descriptor remains a repository artifact,
 * while every executable component is fixed to a registry and manifest digest
 * understood by the Simulator/AppRun adapters.
 */
export function checkCompositeAppRunDescriptor(
  dir: string,
  targetId: string,
  entry: string,
): ValidationError[] {
  const path = join(dir, entry);
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return [`runtime.targets[${targetId}].entry must be a non-symlink regular AppRun JSON file`];
    }
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    const descriptor = jsonRecord(value);
    if (descriptor === undefined) {
      return [`runtime.targets[${targetId}].entry must contain a valid JSON object`];
    }
    const components = descriptor.components;
    if (!Array.isArray(components) || components.length === 0) {
      return [`runtime.targets[${targetId}].entry must declare at least one AppRun component`];
    }
    const errors: ValidationError[] = [];
    for (const [index, component] of components.entries()) {
      const source = jsonRecord(jsonRecord(component)?.deploy_source);
      const registry = jsonRecord(source?.container_registry);
      const image = registry?.image;
      if (typeof image !== "string" || !PINNED_APPRUN_IMAGE.test(image)) {
        errors.push(
          `runtime.targets[${targetId}].entry components[${index}] image must be digest-pinned from a supported AppRun registry`,
        );
      }
    }
    return errors;
  } catch (error) {
    return [
      `runtime.targets[${targetId}].entry must contain valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
}

function checkCompositeRefs(dir: string, meta: Metadata): CrossRefResult {
  const errors: ValidationError[] = [
    ...checkInstructionsPresent(meta),
    ...checkParticipantVisibleSpoilers(meta),
    ...checkWriteupTranslations(meta),
    ...checkHintTranslations(meta),
    ...checkScoringRegulation(meta),
    ...checkDashboardSlotFiles(meta, dir),
    ...checkCoordinationPluginFile(meta, dir),
  ];
  const runtime = meta.runtime as { targets?: unknown } | undefined;
  const targets = Array.isArray(runtime?.targets)
    ? (runtime.targets as Array<Record<string, unknown>>)
    : [];
  const scoring = meta.scoring as Record<string, unknown> | undefined;

  // 単一 row 前提の kind (flag 等) は composite の親 deployment に stackOutputs が無く成立しない。
  if (scoring !== undefined && scoring.kind !== "composite-probe") {
    errors.push(
      'a composite problem must use scoring.kind="composite-probe" (single-row kinds cannot read per-target outputs)',
    );
  }

  const targetIds = new Set<string>();
  for (const t of targets) {
    const id = typeof t.id === "string" ? t.id : "?";
    targetIds.add(id);
    const entry = typeof t.entry === "string" ? t.entry : undefined;
    if (!entry) continue; // 形は schema が enforce 済み
    if (!existsSync(join(dir, entry))) {
      errors.push(`runtime.targets[${id}].entry "${entry}" not found`);
      continue;
    }
    if (t.provider === "sakura" && t.engine === "apprun") {
      errors.push(...checkCompositeAppRunDescriptor(dir, id, entry));
    }
    if (t.provider === "aws" && t.engine === "cloudformation") {
      // ライブ CFn 経路 (CodeBuild deploy-battles.sh) は常に <problemDir>/template.yaml を
      // deploy し target entry を読まないため、 AWS target の entry は root 固定。
      if (entry !== "template.yaml") {
        errors.push(
          `runtime.targets[${id}].entry must be "template.yaml" (the live CFn path always deploys the problem-root template.yaml)`,
        );
        continue;
      }
      const yaml = readFileSync(join(dir, entry), "utf8");
      errors.push(
        ...checkParticipantBaseline(yaml, entry),
        ...checkResourceTagging(yaml, entry),
        ...checkCompositeProbeOutputRefs(scoring, id, yaml, entry),
      );
    }
  }

  // 採点対象の targetId が runtime.targets に実在すること (typo / drift を deploy 前に止める)。
  if (scoring?.kind === "composite-probe" && Array.isArray(scoring.targets)) {
    for (const st of scoring.targets as Array<Record<string, unknown>>) {
      const tid = typeof st.targetId === "string" ? st.targetId : "?";
      if (!targetIds.has(tid)) {
        errors.push(
          `scoring.targets[].targetId="${tid}" は runtime.targets[].id に存在しない (= scorer が target を解決できない)`,
        );
      }
    }
  }
  return { errors, warnings: [] };
}

/** AWS target の CFn Outputs に composite-probe の outputKey が存在するかを cross-check する。 */
function checkCompositeProbeOutputRefs(
  scoring: Record<string, unknown> | undefined,
  targetId: string,
  yaml: string,
  cfnTemplate: string,
): ValidationError[] {
  if (scoring?.kind !== "composite-probe" || !Array.isArray(scoring.targets)) return [];
  const errors: ValidationError[] = [];
  for (const st of scoring.targets as Array<Record<string, unknown>>) {
    if (st.targetId !== targetId) continue;
    const key = st.outputKey;
    if (typeof key === "string" && !yaml.includes(`${key}:`)) {
      errors.push(
        `scoring.targets[targetId=${targetId}].outputKey="${key}" not found in ${cfnTemplate} Outputs (= scorer が probe URL を引けない)`,
      );
    }
  }
  return errors;
}

/**
 * [#2054] container 配信問題 (runtime.engine !== cloudformation、 例: docker/compose)。
 * CFn template を持たないため、 CFn cross-ref ではなく container 固有の整合性だけを検査する。
 */
function isContainerProblem(meta: Metadata): boolean {
  const runtime = meta.runtime as { engine?: unknown } | undefined;
  return typeof runtime?.engine === "string" && runtime.engine !== "cloudformation";
}

function checkContainerRefs(dir: string, meta: Metadata): CrossRefResult {
  const runtime = meta.runtime as { entry?: unknown } | undefined;
  const errors: ValidationError[] = [
    ...checkInstructionsPresent(meta),
    ...checkParticipantVisibleSpoilers(meta),
    ...checkWriteupTranslations(meta),
    ...checkHintTranslations(meta),
    ...checkScoringRegulation(meta),
  ];
  const entry = typeof runtime?.entry === "string" ? runtime.entry : undefined;
  if (!entry) {
    errors.push("runtime.entry is required for a container problem");
  } else if (!existsSync(join(dir, entry))) {
    errors.push(`runtime.entry "${entry}" not found`);
  }
  const scoringKind = (meta.scoring as { kind?: unknown } | undefined)?.kind;
  // [TenkaCloud#2252] container 問題の採点はコンテナ /verify への委譲のみ:
  // 単一判定の "verify" か、 check 単位部分点の "multi-verify"。
  if (scoringKind !== "verify" && scoringKind !== "multi-verify") {
    errors.push(
      'a container problem must use scoring.kind="verify" or "multi-verify" (evaluation lives in /verify)',
    );
  }
  const warnings: ValidationError[] = [...checkContainerWriteupAdvisory(meta)];
  if (scoringKind === "multi-verify") {
    errors.push(...checkMultiVerifyStructure(meta), ...checkMultiVerifyTranslations(meta));
    warnings.push(...checkCheckLabelSpoilerAdvisory(meta));
  }
  errors.push(...checkDashboardSlotFiles(meta, dir), ...checkCoordinationPluginFile(meta, dir));
  return { errors, warnings };
}

/**
 * [TenkaCloud#2252] multi-verify の構造検査 (platform parser / SDK と同じ契約):
 *   - checks は 2〜8 件 (engine の許容範囲、 教材は原則 4〜6)
 *   - checks[].id は `^[a-z0-9][a-z0-9-]{0,63}$` かつ問題内 unique (= verify request の checkpointId)
 *   - checks[].label 非空・80 文字以下、 checks[].points 正整数
 *   - wrongAnswerPenalty は 0 以上整数、 当該 check の points 以下
 *   - 1 check 内の hint 減点合計は当該 check points の 50% 以下 (問題全体 50% は checkScoringRegulation)
 *   - hints[].id は **問題全体で unique** (portal の reveal route が hintId 単独キーのため、
 *     check 跨ぎの衝突は reveal を曖昧にする)
 * 満点 = ティア標準点 / 問題全体のヒント減点 50% cap は checkScoringRegulation が検査する。
 */
const CHECK_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CHECK_LABEL_MAX = 80;
const MIN_CHECKS = 2;
const MAX_CHECKS = 8;

export function checkMultiVerifyStructure(meta: Metadata): ValidationError[] {
  const errors: ValidationError[] = [];
  const scoring = meta.scoring as { checks?: unknown } | undefined;
  const checks = Array.isArray(scoring?.checks)
    ? (scoring.checks as Array<Record<string, unknown>>)
    : [];
  if (checks.length < MIN_CHECKS || checks.length > MAX_CHECKS) {
    errors.push(
      `scoring.checks must have ${MIN_CHECKS}–${MAX_CHECKS} entries (multi-verify), got ${checks.length}`,
    );
    if (checks.length === 0) return errors;
  }
  const seenCheckIds = new Set<string>();
  const seenHintIds = new Set<string>();
  checks.forEach((check, index) => {
    const id = typeof check.id === "string" ? check.id : undefined;
    if (!id || !CHECK_ID_RE.test(id)) {
      errors.push(`scoring.checks[${index}].id must match ^[a-z0-9][a-z0-9-]{0,63}$`);
    } else if (seenCheckIds.has(id)) {
      errors.push(`scoring.checks[${index}].id "${id}" is duplicated`);
    } else {
      seenCheckIds.add(id);
    }
    if (typeof check.label !== "string" || check.label.trim().length === 0) {
      errors.push(`scoring.checks[${index}].label must be a non-empty string`);
    } else if (check.label.length > CHECK_LABEL_MAX) {
      errors.push(`scoring.checks[${index}].label must be ${CHECK_LABEL_MAX} characters or fewer`);
    }
    const points = check.points;
    const pointsValid = typeof points === "number" && Number.isInteger(points) && points > 0;
    if (!pointsValid) {
      errors.push(`scoring.checks[${index}].points must be a positive integer`);
    }
    const waP = check.wrongAnswerPenalty;
    if (waP !== undefined) {
      if (typeof waP !== "number" || !Number.isInteger(waP) || waP < 0) {
        errors.push(`scoring.checks[${index}].wrongAnswerPenalty must be a non-negative integer`);
      } else if (pointsValid && waP > (points as number)) {
        errors.push(
          `scoring.checks[${index}].wrongAnswerPenalty=${waP} must not exceed the check points (${points})`,
        );
      }
    }
    const hints = Array.isArray(check.hints) ? (check.hints as Array<Record<string, unknown>>) : [];
    let hintPenaltySum = 0;
    for (const hint of hints) {
      const penalty = (hint as { penalty?: unknown }).penalty;
      if (typeof penalty === "number") hintPenaltySum += penalty;
      const hintId = typeof hint.id === "string" ? hint.id : undefined;
      if (hintId === undefined) continue;
      if (seenHintIds.has(hintId)) {
        errors.push(
          `scoring.checks[${index}].hints id "${hintId}" is duplicated (hint ids must be unique across the problem — the reveal route is keyed on hintId alone)`,
        );
      }
      seenHintIds.add(hintId);
    }
    if (pointsValid && hintPenaltySum > (points as number) * 0.5) {
      errors.push(
        `scoring.checks[${index}] hint penalties=${hintPenaltySum} exceed 50% of the check points (${(points as number) * 0.5}) — see SCORING.md`,
      );
    }
  });
  return errors;
}

/**
 * [TenkaCloud#2252 / ja-en parity] multi-verify の checks[].label / hints は競技者に見えるため、
 * `i18n.en.checks[]` に同じ id の英訳 (label 必須 + hint content) を必ず持つ。 翻訳側にしか無い
 * id (typo / drift) も loud に止める。 points / id は language-neutral なので翻訳側では宣言しない。
 */
export function checkMultiVerifyTranslations(meta: Metadata): ValidationError[] {
  const errors: ValidationError[] = [];
  const scoring = meta.scoring as { checks?: unknown } | undefined;
  const checks = Array.isArray(scoring?.checks)
    ? (scoring.checks as Array<Record<string, unknown>>)
    : [];
  if (checks.length === 0) return errors;

  const i18n = meta.i18n as { en?: { checks?: unknown } } | undefined;
  const enChecks = Array.isArray(i18n?.en?.checks)
    ? (i18n.en.checks as Array<Record<string, unknown>>)
    : [];
  const enById = new Map<string, Record<string, unknown>>();
  for (const entry of enChecks) {
    if (typeof entry.id === "string") enById.set(entry.id, entry);
  }
  const canonicalIds = new Set(
    checks.map((check) => check.id).filter((id): id is string => typeof id === "string"),
  );
  for (const id of enById.keys()) {
    if (!canonicalIds.has(id)) {
      errors.push(
        `i18n.en.checks[].id="${id}" は scoring.checks[] に存在しない (= 翻訳の id typo / drift)`,
      );
    }
  }
  for (const check of checks) {
    const id = typeof check.id === "string" ? check.id : undefined;
    if (id === undefined) continue;
    const en = enById.get(id);
    if (!en || typeof en.label !== "string" || en.label.trim().length === 0) {
      errors.push(
        `scoring.checks[].id="${id}" の英訳 label が i18n.en.checks に無い — mirror the JA label in English (ja/en parity)`,
      );
      continue;
    }
    // per-check hints parity: canonical hint id ⊆/⊇ en hint id
    const hintIds = (Array.isArray(check.hints) ? check.hints : [])
      .map((h) => (h as { id?: unknown }).id)
      .filter((v): v is string => typeof v === "string");
    const enHintIds = new Set(
      (Array.isArray(en.hints) ? en.hints : [])
        .map((h) => (h as { id?: unknown }).id)
        .filter((v): v is string => typeof v === "string"),
    );
    for (const hintId of hintIds) {
      if (!enHintIds.has(hintId)) {
        errors.push(
          `scoring.checks[].id="${id}" hints[].id="${hintId}" の英訳が i18n.en.checks に無い (ja/en parity)`,
        );
      }
    }
    for (const enHintId of enHintIds) {
      if (!hintIds.includes(enHintId)) {
        errors.push(
          `i18n.en.checks[].id="${id}" hints[].id="${enHintId}" は scoring.checks の hints に存在しない (= 翻訳の id typo / drift)`,
        );
      }
    }
  }
  return errors;
}

/**
 * [TenkaCloud#2252 / AGENT.md §10] checks[].label は競技者に見える。 脆弱性名を書くと
 * 「何を探すか」 の種明かしになる (security-CTF ルール: 「公開バックアップ」 は可、
 * 「SQLi bypass」 は不可)。 文言 match は演出と区別できないため error ではなく warning
 * (= checkDisruptionDeliveryAdvisory と同方針)。
 */
const SPOILER_TERMS =
  /\b(sqli|sql injection|xss|csrf|ssrf|rce|idor|path traversal|prototype pollution|deserialization)\b|インジェクション|ディレクトリトラバーサル/i;

export function checkCheckLabelSpoilerAdvisory(meta: Metadata): ValidationError[] {
  const warnings: ValidationError[] = [];
  const scoring = meta.scoring as { checks?: unknown } | undefined;
  const checks = Array.isArray(scoring?.checks)
    ? (scoring.checks as Array<Record<string, unknown>>)
    : [];
  const i18n = meta.i18n as { en?: { checks?: unknown } } | undefined;
  const enChecks = Array.isArray(i18n?.en?.checks)
    ? (i18n.en.checks as Array<Record<string, unknown>>)
    : [];
  const labels = [
    ...checks.map((c) => [c.id, c.label] as const),
    ...enChecks.map((c) => [c.id, c.label] as const),
  ];
  for (const [id, label] of labels) {
    if (typeof label === "string" && SPOILER_TERMS.test(label)) {
      warnings.push(
        `scoring.checks id="${String(id)}" label "${label}" looks like a vulnerability-name spoiler — name the symptom/asset instead (AGENT.md §10)`,
      );
    }
  }
  return warnings;
}

function checkCrossRefs(metaPath: string, meta: Metadata): CrossRefResult {
  const dir = dirname(metaPath);
  const simulationErrors = checkSimulationOverlay(metaPath, meta);
  if (isCompositeProblem(meta)) {
    const result = checkCompositeRefs(dir, meta);
    return { ...result, errors: [...simulationErrors, ...result.errors] };
  }
  if (isContainerProblem(meta)) {
    const result = checkContainerRefs(dir, meta);
    return { ...result, errors: [...simulationErrors, ...result.errors] };
  }
  const cfnTemplate = typeof meta.cfnTemplate === "string" ? meta.cfnTemplate : "template.yaml";
  const templatePath = join(dir, cfnTemplate);

  if (!existsSync(templatePath)) {
    return {
      errors: [...simulationErrors, `cfnTemplate file "${cfnTemplate}" not found`],
      warnings: [],
    };
  }
  const yaml = readFileSync(templatePath, "utf8");
  // [TenkaCloud#2252] verify / multi-verify はコンテナ委譲採点 (= runtime.provider=docker
  // 専用)。 CFn 配信問題に書かれた場合は組み合わせ違反として loud に止める。
  const cfnScoringKind = (meta.scoring as { kind?: unknown } | undefined)?.kind;
  const containerOnlyKindErrors: ValidationError[] =
    cfnScoringKind === "verify" || cfnScoringKind === "multi-verify"
      ? [
          `scoring.kind="${cfnScoringKind}" is container-only (runtime.provider=docker) — CFn problems must use flag / multi-flag / uptime* / phased-polling / attack-detection`,
        ]
      : [];
  return {
    errors: [
      ...simulationErrors,
      ...containerOnlyKindErrors,
      ...checkInstructionsPresent(meta),
      ...checkParticipantVisibleSpoilers(meta),
      ...checkWriteupTranslations(meta),
      ...checkHintTranslations(meta),
      ...checkScoringRegulation(meta),
      ...checkScoringOutputRefs(meta, yaml, cfnTemplate),
      ...checkEndpointOutputRefs(meta, yaml, cfnTemplate),
      ...checkDisruptionRefs(meta, yaml, cfnTemplate),
      ...checkDashboardSlotFiles(meta, dir),
      ...checkCoordinationPluginFile(meta, dir),
      ...checkParticipantBaseline(yaml, cfnTemplate),
      ...checkResourceTagging(yaml, cfnTemplate),
    ],
    warnings: [
      ...checkFlagEarnedAdvisory(meta, yaml, cfnTemplate),
      ...checkDisruptionDeliveryAdvisory(meta, dir),
    ],
  };
}

/**
 * [check engine / 助言] disruption が「届く」 形になっているかの advisory (AGENT.md §11)。
 *   - action + effect の二重宣言 → 実障害は probe 失敗由来の failurePenalty で既に減点される
 *     ため二重課金になり、 effect 側は移行済みチームにも無条件で当たる (= 不公平)。
 *   - description が障害 (503 / 停止 / outage 等) を謳うのに action も parameters.probe も
 *     無い → 「何も起きない約束」。 stackstack で実際に出荷された bug (#44 で修正)。
 *   - disruption が複数あるのに redteam/README.md が無い → operator が catalog / 復旧経路 /
 *     targeting 規律を知る場所が無い。
 * 文言 match は fuzzy で「意図的な演出」 と区別できないため error ではなく warning とする。
 */
function checkDisruptionDeliveryAdvisory(meta: Metadata, dir: string): ValidationError[] {
  const warnings: ValidationError[] = [];
  const disruptions = Array.isArray(meta.disruptions)
    ? (meta.disruptions as Array<Record<string, unknown>>)
    : [];
  if (disruptions.length === 0) return warnings;

  const FAULT_CLAIM = /\b50[0-9]\b|5xx|停止|ダウン|不通|outage|service (?:goes )?down/i;
  for (const d of disruptions) {
    const id = String(d.id ?? "?");
    const action = d.action && typeof d.action === "object" ? d.action : undefined;
    const effect = d.effect && typeof d.effect === "object" ? d.effect : undefined;
    const params = (d.parameters ?? {}) as Record<string, unknown>;
    const probe = typeof params.probe === "string" ? params.probe : undefined;

    if (action && effect) {
      warnings.push(
        `disruption[${id}] が action と effect を両方宣言。 実障害は probe 失敗 (failurePenalty) で既に減点されるため二重課金になり、 effect は移行済みチームにも無条件で当たる。 どちらか 1 つに絞ってください (AGENT.md §11)`,
      );
    }
    if (!action && !probe && typeof d.description === "string" && FAULT_CLAIM.test(d.description)) {
      warnings.push(
        `disruption[${id}] の description が障害 (503 / 停止等) を謳っているが、 action も parameters.probe も無い = 何も起きない約束。 実障害なら action を宣言、 採点圧だけなら description を score 圧の表現に直してください (AGENT.md §11)`,
      );
    }
  }

  if (disruptions.length > 1 && !existsSync(join(dir, "redteam", "README.md"))) {
    warnings.push(
      `disruptions が ${disruptions.length} 件あるのに redteam/README.md が無い。 catalog 表 / 復旧経路 / targeting 規律を operator 向けに書いてください (AGENT.md §11)`,
    );
  }
  return warnings;
}

/**
 * ADR-021 per-tenant scoping は IAM policy 側の
 * `Condition: aws:ResourceTag/TenkaCloud:NamePrefix == ${NamePrefix}` で実装される。
 * これが効くためには、 deploy される per-team な EC2 系リソースに同じ tag が
 * 必ず付いていないと、 condition がマッチせず 「自分のリソースなのに Console に
 * 出ない」という UX バグになる (= leak ではないが problem solvable 性を壊す)。
 * テンプレ作成者が tag を忘れないよう deploy 前に止める。
 */
function checkResourceTagging(yaml: string, cfnTemplate: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const taggableTypes = new Set([
    "AWS::EC2::VPC",
    "AWS::EC2::Subnet",
    "AWS::EC2::InternetGateway",
    "AWS::EC2::RouteTable",
    "AWS::EC2::SecurityGroup",
    "AWS::EC2::Instance",
  ]);
  const lines = yaml.split("\n");
  type ResourceStart = { lineIdx: number; type: string; logicalId: string };
  const starts: ResourceStart[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s+)Type:\s+(\S+)/);
    if (!m) continue;
    const typeIndent = m[1].length;
    const type = m[2];
    let logicalId = "?";
    for (let k = i - 1; k >= 0; k--) {
      const km = lines[k].match(/^(\s+)(\S+):\s*$/);
      if (km && km[1].length === typeIndent - 2) {
        logicalId = km[2];
        break;
      }
      if (lines[k].trim().length === 0) continue;
    }
    starts.push({ lineIdx: i, type, logicalId });
  }
  for (let ri = 0; ri < starts.length; ri++) {
    const r = starts[ri];
    if (!taggableTypes.has(r.type)) continue;
    const blockEnd = ri + 1 < starts.length ? starts[ri + 1].lineIdx : lines.length;
    const block = lines.slice(r.lineIdx, blockEnd).join("\n");
    if (!/^\s*-\s+Key:\s+TenkaCloud:NamePrefix\b/m.test(block)) {
      errors.push(
        `${cfnTemplate}: ${r.type} ${r.logicalId} missing TenkaCloud:NamePrefix tag (ADR-021 per-team scoping via aws:ResourceTag IAM Condition)`,
      );
    }
  }
  return errors;
}

/**
 * 全問題テンプレ共通のアクセス baseline を ParticipantViewerRole が持っていることを検査する。
 *   - SignInLocalDevelopmentAccess (AWS-managed) — `aws login` (2025-11) OAuth2 用
 *   - cloudshell の対話セッション系 7 actions — Browser CloudShell 用
 * 抜けていると参加者が "デプロイ後にアクセスできない" 状態になるので deploy 前に止める。
 * 各値が YAML list item として実際に使われていることまでチェック (`#` でコメントアウト
 * した状態を弾く)。 baseline の文言を変えるならこのリストと全テンプレ両方を同時に更新する。
 */
function checkParticipantBaseline(yaml: string, cfnTemplate: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const signInArn = "arn:aws:iam::aws:policy/SignInLocalDevelopmentAccess";
  const cloudshellActions = [
    "cloudshell:CreateEnvironment",
    "cloudshell:CreateSession",
    "cloudshell:GetEnvironmentStatus",
    "cloudshell:StartEnvironment",
    "cloudshell:StopEnvironment",
    "cloudshell:DeleteEnvironment",
    "cloudshell:PutCredentials",
  ];
  if (!hasYamlListItem(yaml, signInArn)) {
    errors.push(
      `${cfnTemplate}: ParticipantViewerRole.ManagedPolicyArns must include ${signInArn} (= aws login OAuth2)`,
    );
  }
  const missingActions = cloudshellActions.filter((a) => !hasYamlListItem(yaml, a));
  if (missingActions.length > 0) {
    errors.push(
      `${cfnTemplate}: ParticipantViewerRole is missing CloudShell baseline actions: ${missingActions.join(", ")}`,
    );
  }
  return errors;
}

/** 行頭〜空白 → `- ` → exact value で始まる YAML list item があるかを判定。 */
function hasYamlListItem(yaml: string, value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*-\\s+${escaped}(\\s|$)`, "m").test(yaml);
}

function checkScoringOutputRefs(
  meta: Metadata,
  yaml: string,
  cfnTemplate: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const scoring = meta.scoring as Record<string, unknown> | undefined;
  const kind = scoring?.kind;

  if (kind === "flag") {
    const flagKey = scoring?.flagOutputKey;
    if (typeof flagKey === "string" && !yaml.includes(`${flagKey}:`)) {
      errors.push(
        `scoring.flagOutputKey="${flagKey}" not found in ${cfnTemplate} Outputs (= scoring engine が読めない)`,
      );
    }
  }

  if (kind === "attack-detection") {
    const statsKey = scoring?.statsOutputKey;
    if (typeof statsKey === "string" && !yaml.includes(`${statsKey}:`)) {
      errors.push(`scoring.statsOutputKey="${statsKey}" not found in ${cfnTemplate} Outputs`);
    }
  }
  return errors;
}

function checkEndpointOutputRefs(
  meta: Metadata,
  yaml: string,
  cfnTemplate: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const endpoints = Array.isArray(meta.endpoints) ? meta.endpoints : [];
  for (const ep of endpoints as Array<Record<string, unknown>>) {
    const def = ep.default as Record<string, unknown> | undefined;
    const from = def?.from;
    const key = def?.key;
    if (from === "cfn-output" && typeof key === "string" && !yaml.includes(`${key}:`)) {
      errors.push(
        `endpoints[slot=${String(ep.slot)}].default.key="${key}" not found in ${cfnTemplate} Outputs`,
      );
    }
  }
  return errors;
}

/**
 * [check engine] disruption (= red team) の整合性を deploy 前に検査する。 schema は形だけ見て
 * 「実際に発火するか」 を見ないため、 ここで「成立しているか」 を機械的に確認する:
 *   - action.targetRef は template Outputs に存在する (= executor が注入対象を解決できる)
 *   - operatorEditable は その disruption の parameters か timing 予約語 afterMinutes のみ
 *   - paramTemplate / revert.paramTemplate の {{placeholder}} は parameters に全て存在する
 *     (= 置換されず literal `{{x}}` のまま壊れた command が走るのを防ぐ)
 * これらは AWS に deploy しなくても静的に分かる「赤チームが動かない」 bug。
 */
function checkDisruptionRefs(meta: Metadata, yaml: string, cfnTemplate: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const disruptions = Array.isArray(meta.disruptions) ? meta.disruptions : [];
  for (const d of disruptions as Array<Record<string, unknown>>) {
    const id = String(d.id ?? "?");
    const action = d.action as Record<string, unknown> | undefined;
    if (!action || typeof action !== "object") continue; // effect / probe 型は targetRef を持たない

    const targetRef = action.targetRef;
    if (typeof targetRef === "string" && !yaml.includes(`${targetRef}:`)) {
      errors.push(
        `disruption[${id}].action.targetRef="${targetRef}" not found in ${cfnTemplate} Outputs (= executor が注入対象を解決できず赤チームが動かない)`,
      );
    }

    const params = d.parameters && typeof d.parameters === "object" ? Object.keys(d.parameters) : [];
    const editable = Array.isArray(d.operatorEditable) ? (d.operatorEditable as unknown[]) : [];
    for (const k of editable) {
      if (typeof k === "string" && k !== "afterMinutes" && !params.includes(k)) {
        errors.push(
          `disruption[${id}].operatorEditable "${k}" は parameters にも timing 予約語 afterMinutes にも無い`,
        );
      }
    }

    const tplStr = JSON.stringify(action.paramTemplate ?? {}) + JSON.stringify(
      (action.revert as Record<string, unknown> | undefined)?.paramTemplate ?? {},
    );
    const placeholders = [...tplStr.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
    for (const ph of new Set(placeholders)) {
      if (!params.includes(ph)) {
        errors.push(
          `disruption[${id}] paramTemplate placeholder "{{${ph}}}" が parameters に無い (= 置換されず壊れた command が走る)`,
        );
      }
    }
  }
  return errors;
}

/**
 * [check engine / 助言] flag kind の flag 値が `/create-problem` の scaffold プレースホルダー
 * (例: "Hello from ${NamePrefix}") のまま放置されていないかを警告する。 この値は deploy 直後に
 * Output に出るため、 課題 (remediation 等) を解かずに submit できてしまい「成立しない問題」 になる。
 * 静的には「意図的な smoke-test の trivial flag」 と区別できないため error ではなく warning とし、
 * 作者に「flag を解答に紐付けたか」 を必ず確認させる。
 */
function checkFlagEarnedAdvisory(meta: Metadata, yaml: string, cfnTemplate: string): ValidationError[] {
  const scoring = meta.scoring as Record<string, unknown> | undefined;
  if (scoring?.kind !== "flag") return [];
  const flagKey = scoring.flagOutputKey;
  if (typeof flagKey !== "string") return [];
  const value = extractOutputValue(yaml, flagKey);
  if (value === undefined) return [];
  const SCAFFOLD = [/hello from/i, /\bTODO\b/, /placeholder/i, /change[\s_-]?me/i, /replace[\s_-]?me/i];
  if (SCAFFOLD.some((re) => re.test(value))) {
    return [
      `scoring.flagOutputKey="${flagKey}" の Output 値が scaffold プレースホルダー ("${value.trim()}") のまま。 deploy 直後に Output に出るため、 課題を解かずに submit できる = 問題が成立しない。 flag を解答 (remediation 完了等) に紐付くものに置き換えてください (${cfnTemplate})`,
    ];
  }
  return [];
}

/** template の `Outputs:` 配下の <name>: ブロックから Value: 行を 1 つ取り出す (= 簡易抽出)。 */
function extractOutputValue(yaml: string, outputName: string): string | undefined {
  const lines = yaml.split("\n");
  const startRe = new RegExp(`^(\\s+)${outputName}:\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(startRe);
    if (!m) continue;
    const indent = m[1].length;
    for (let k = i + 1; k < lines.length; k++) {
      const cur = lines[k];
      const km = cur.match(/^(\s*)(\S+):\s?(.*)$/);
      if (km && km[1].length <= indent) break; // 次の sibling output に到達
      const vm = cur.match(/^\s*Value:\s?(.*)$/);
      if (vm) return vm[1];
    }
  }
  return undefined;
}

function checkDashboardSlotFiles(meta: Metadata, dir: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const dashboard = meta.dashboard as Record<string, unknown> | undefined;
  const slots = dashboard?.slots as Record<string, unknown> | undefined;
  if (!slots) return errors;
  for (const [slotName, slotPath] of Object.entries(slots)) {
    if (typeof slotPath === "string") {
      const physical = join(dir, slotPath);
      if (!existsSync(physical)) {
        errors.push(`dashboard.slots["${slotName}"]="${slotPath}" file not found`);
      }
    }
  }

  return errors;
}

/**
 * interTeamCoordination.plugin (ADR-028 / #1420) が物理 file として存在するか cross-ref する。
 * portal slot (dashboard.slots) と同方針 — platform の dispatcher が runtime に動的 import するので、
 * 存在しない path を宣言したまま catalog に載ると、 実行時に coordination が無言で無効化され出題者は
 * 気付けない。 SCHEMA は path pattern までしか保証しないため、 file 実在はここで止める。
 * interTeamCoordination 未宣言の problem は無影響 (= 早期 return)。
 */
function checkCoordinationPluginFile(meta: Metadata, dir: string): ValidationError[] {
  const coordination = meta.interTeamCoordination as Record<string, unknown> | undefined;
  const plugin = coordination?.plugin;
  if (typeof plugin !== "string") return [];
  if (!existsSync(join(dir, plugin))) {
    return [`interTeamCoordination.plugin="${plugin}" file not found`];
  }
  return [];
}

function main(): void {
  const validate = createSchemaValidator();
  const metadataFiles = CATEGORY_DIRS.flatMap((cat) => {
    const dir = join(PROBLEMS_DIR, cat);
    try {
      return findMetadataFiles(dir);
    } catch {
      return [];
    }
  });
  assertMetadataFilesExist(metadataFiles);
  const failed = validateMetadataFiles(metadataFiles, validate);
  reportResult(failed, metadataFiles.length);
}

function createSchemaValidator() {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

function assertMetadataFilesExist(metadataFiles: string[]): void {
  if (metadataFiles.length === 0) {
    console.error("No metadata.json found under problems/. At least one problem is expected.");
    process.exit(1);
  }
}

function validateMetadataFiles(
  metadataFiles: string[],
  validate: ReturnType<Ajv2020["compile"]>,
): number {
  const parsed = metadataFiles.map((file) => ({
    file,
    data: JSON.parse(readFileSync(file, "utf8")) as Metadata,
  }));
  const schemaErrors = new Map<
    string,
    NonNullable<ReturnType<Ajv2020["compile"]>["errors"]>
  >();
  const graphCatalog: KnowledgeGraphCatalogEntry[] = [];

  for (const { file, data } of parsed) {
    if (validate(data)) {
      graphCatalog.push({ file: relative(REPO_ROOT, file), metadata: data });
    } else {
      schemaErrors.set(file, [...(validate.errors ?? [])]);
    }
  }

  const graphErrors = new Map<string, ValidationError[]>();
  for (const diagnostic of validateKnowledgeGraphCatalog(graphCatalog)) {
    const errors = graphErrors.get(diagnostic.file) ?? [];
    errors.push(`${diagnostic.path}: ${diagnostic.message}`);
    graphErrors.set(diagnostic.file, errors);
  }

  let failed = 0;
  for (const { file, data } of parsed) {
    const invalidSchema = schemaErrors.get(file);
    if (invalidSchema) {
      failed += 1;
      printSchemaErrors(file, data, invalidSchema);
      continue;
    }

    const crossRefs = checkCrossRefs(file, data);
    const errors = [
      ...checkRequiredReadmes(dirname(file)),
      ...crossRefs.errors,
      ...(graphErrors.get(relative(REPO_ROOT, file)) ?? []),
    ];
    const { warnings } = crossRefs;
    if (warnings.length > 0) printWarnings(file, warnings);
    if (errors.length > 0) {
      failed += 1;
      printCrossRefErrors(file, errors);
      continue;
    }

    console.log(`OK  ${relative(REPO_ROOT, file)}${warnings.length > 0 ? " (warnings ↑)" : ""}`);
  }
  return failed;
}

function printWarnings(file: string, warnings: ValidationError[]): void {
  console.warn(`WARN ${relative(REPO_ROOT, file)}`);
  for (const w of warnings) {
    console.warn(`     ⚠ ${w}`);
  }
}

function printSchemaErrors(
  file: string,
  data: Metadata,
  errors: NonNullable<ReturnType<Ajv2020["compile"]>["errors"]>,
): void {
  console.error(`NG  ${relative(REPO_ROOT, file)}`);
  for (const err of errors) {
    console.error(`     ${err.instancePath || "(root)"} ${err.message ?? ""}`);
  }
  const expectedId = file.split("/").slice(-2, -1)[0];
  if (data.id && data.id !== expectedId) {
    console.error(`     id (${data.id}) はディレクトリ名 (${expectedId}) と一致させてください`);
  }
}

function printCrossRefErrors(file: string, errors: ValidationError[]): void {
  console.error(`NG  ${relative(REPO_ROOT, file)} (cross-ref)`);
  for (const e of errors) {
    console.error(`     ${e}`);
  }
}

function reportResult(failed: number, total: number): void {
  if (failed > 0) {
    console.error(
      `\n${failed} / ${total} 件の metadata.json が schema / cross-ref に違反しています`,
    );
    process.exit(1);
  }
  console.log(`\n${total} 件の metadata.json はすべて有効です`);
}

if (import.meta.main) main();
