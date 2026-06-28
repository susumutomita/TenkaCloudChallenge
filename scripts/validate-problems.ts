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

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import Ajv2020 from "ajv";
import addFormats from "ajv-formats";

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
    ...checkHintTranslations(meta),
  ];
  const entry = typeof runtime?.entry === "string" ? runtime.entry : undefined;
  if (!entry) {
    errors.push("runtime.entry is required for a container problem");
  } else if (!existsSync(join(dir, entry))) {
    errors.push(`runtime.entry "${entry}" not found`);
  }
  const scoringKind = (meta.scoring as { kind?: unknown } | undefined)?.kind;
  if (scoringKind !== "verify") {
    errors.push('a container problem must use scoring.kind="verify" (evaluation lives in /verify)');
  }
  errors.push(...checkDashboardSlotFiles(meta, dir), ...checkCoordinationPluginFile(meta, dir));
  return { errors, warnings: [] };
}

function checkCrossRefs(metaPath: string, meta: Metadata): CrossRefResult {
  const dir = dirname(metaPath);
  if (isContainerProblem(meta)) return checkContainerRefs(dir, meta);
  const cfnTemplate = typeof meta.cfnTemplate === "string" ? meta.cfnTemplate : "template.yaml";
  const templatePath = join(dir, cfnTemplate);

  if (!existsSync(templatePath)) {
    return { errors: [`cfnTemplate file "${cfnTemplate}" not found`], warnings: [] };
  }
  const yaml = readFileSync(templatePath, "utf8");
  return {
    errors: [
      ...checkInstructionsPresent(meta),
      ...checkHintTranslations(meta),
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
  let failed = 0;
  for (const file of metadataFiles) {
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (!validate(data)) {
      failed += 1;
      printSchemaErrors(file, data, validate.errors ?? []);
      continue;
    }

    const { errors, warnings } = checkCrossRefs(file, data);
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

main();
