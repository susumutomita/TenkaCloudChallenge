/**
 * battles/ac26-crypto-battle/game/reducer.ts
 *
 * この model は platform の dispatcher (trusted runtime) 上で実行され、サーバーは
 * 秘密を保持しない — commitments のみ。 純関数 (= 副作用なし) の state machine。
 *
 * PR1 は SDK-free: "@tenkacloud/coordination-plugin-sdk" には依存しない
 * (battles/microservice-migration-battle/coordination/router.ts が参考にした
 * CoordinationPlugin 形状 — initialState/validateOp/applyOp/projectForTeam — には
 * 意図的に寄せてある。 PR3 でその SDK 経由の実行環境へ接続する)。
 *
 * validateOp / applyOp は敵対的入力 (不正な hex、桁外れの巨大文字列、存在しない
 * team/contract、偽造 share、リプレイされた hunt など) を想定して書く。
 * どちらも決して throw しない — 不正な入力は必ず error code (validateOp) か
 * 状態を変えない no-op (applyOp) として返す。 暗号的な正しさは確率的であっては
 * ならない: 正しい artifact は常に検証を通り、不正な artifact は常に弾かれる。
 *
 * 時刻は必ず呼び出し側が nowMs として明示的に渡す — Date.now() はここでは
 * 一切使わない (決定性を保つため。 issue の "no randomness in the reducer" と
 * 同じ理由で「現在時刻」もテストから注入可能な入力として扱う)。
 *
 * 補足: 元の spec では validateOp のシグネチャに nowMs が含まれていなかったが、
 * contract の期限切れ (contract_expired) と rotate のクールダウン
 * (rotate_cooldown) は「今」を知らなければ判定できない。 applyOp 側だけが
 * nowMs を持つ形にすると、時刻依存の妥当性判定を validateOp が返す機械可読な
 * error code (contract_expired など) で表現できなくなってしまう。 そのため
 * ここでは validateOp にも nowMs を追加している (詳細は PR 本文の deviation 参照)。
 */

import {
  CONTRACT_SUCCESS_POINTS,
  DEFAULT_THRESHOLD,
  DEFAULT_TOTAL_SHARES,
  HUNT_BONUS_POINTS,
  MAX_ID_LEN,
  ROTATE_COOLDOWN_MS,
} from "./constants.ts";
import { verifyShare, verifySecret } from "./crypto/feldman.ts";
import { tryHexToBigint } from "./crypto/modmath.ts";
import { tryParseScalar, tryParseSubgroupElement } from "./crypto/group.ts";
import { verifyKnowledge, type ProofContext } from "./crypto/schnorr.ts";
import type {
  ContractSpec,
  CryptoBattleOp,
  CryptoBattleState,
  LedgerEntry,
  TeamGeneration,
  TeamState,
  ValidationResult,
} from "./types.ts";

const ok: ValidationResult = { ok: true };
const err = (error: string): ValidationResult => ({ ok: false, error });

/** id 系文字列 (contractId, teamId) の防御的な形式チェック。 */
function isValidId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LEN;
}

/**
 * state に保存済みの commitments (hex[]) を bigint[] へ戻す。 init/rotate 時点で
 * 既に部分群所属チェックを通しているので、通常は必ず成功する。 それでも内部不整合
 * (万一の破損 state) に対しては throw せず null を返し、呼び出し側で error code に
 * 変換する。
 */
function parseStoredCommitments(commitments: readonly string[]): bigint[] | null {
  const parsed: bigint[] = [];
  for (const hex of commitments) {
    const x = tryHexToBigint(hex);
    if (x === null) return null;
    parsed.push(x);
  }
  return parsed;
}

/** commitments 配列の形式・件数・部分群所属を検証する (init/rotate 共通)。 */
function validateCommitments(commitments: readonly string[]): ValidationResult {
  if (!Array.isArray(commitments)) return err("invalid_commitments");
  if (commitments.length !== DEFAULT_THRESHOLD) return err("invalid_commitments");
  for (const hex of commitments) {
    if (typeof hex !== "string") return err("invalid_commitments");
    if (tryParseSubgroupElement(hex) === null) return err("invalid_commitments");
  }
  return ok;
}

/** 初期 state を組み立てる。 各チームは未初期化 (initialized=false, generations=[])。 */
export function initialState(
  teamIds: readonly string[],
  matchStartMs: number,
): CryptoBattleState {
  const teams: Record<string, TeamState> = {};
  for (const teamId of teamIds) {
    teams[teamId] = { score: 0, currentGeneration: 0, generations: [], initialized: false };
  }
  return {
    phase: "build",
    matchStartMs,
    contracts: [],
    publicLedger: [],
    teams,
    huntsClaimed: {},
  };
}

// --- validateOp -------------------------------------------------------------------

/**
 * op.proofCommitment/op.proofResponse を新しい C_0 (= commitments[0]) の離散対数の
 * proof of knowledge として検証する共通ヘルパー (init/rotate 共通)。 これがないと
 * 他チームの commitments をそのままコピーして「自分の commitments」として登録する
 * commitment cloning が可能になってしまう (types.ts のコメント参照)。
 */
function validateKnowledgeProof(
  commitments: readonly string[],
  proofCommitment: unknown,
  proofResponse: unknown,
  context: ProofContext,
): ValidationResult {
  if (typeof proofCommitment !== "string" || typeof proofResponse !== "string") {
    return err("invalid_proof");
  }
  const c0 = commitments[0];
  if (c0 === undefined) return err("invalid_commitments");
  const proof = { commitment: proofCommitment, response: proofResponse };
  if (!verifyKnowledge(c0, proof, context)) return err("invalid_proof");
  return ok;
}

function validateInit(
  team: TeamState,
  teamId: string,
  op: Extract<CryptoBattleOp, { type: "init" }>,
): ValidationResult {
  if (team.initialized) return err("already_initialized");
  const commitmentsCheck = validateCommitments(op.commitments);
  if (!commitmentsCheck.ok) return commitmentsCheck;
  const context: ProofContext = { purpose: "init", teamId, generation: 0, contractId: "" };
  return validateKnowledgeProof(op.commitments, op.proofCommitment, op.proofResponse, context);
}

function validateLeak(
  state: CryptoBattleState,
  team: TeamState,
  teamId: string,
  op: Extract<CryptoBattleOp, { type: "leak" }>,
  nowMs: number,
): ValidationResult {
  if (!team.initialized) return err("not_initialized");
  if (!isValidId(op.contractId)) return err("unknown_contract");
  const contract = state.contracts.find((c) => c.id === op.contractId);
  if (contract === undefined) return err("unknown_contract");
  if (contract.teamId !== teamId) return err("not_your_contract");
  if (contract.kind !== "leak-share") return err("wrong_contract_kind");
  if (contract.status === "expired") return err("contract_expired");
  if (contract.status !== "open") return err("contract_not_open");
  if (nowMs >= contract.expiresAtMs) return err("contract_expired");

  if (typeof op.shareIndex !== "number" || !Number.isInteger(op.shareIndex)) {
    return err("share_index_out_of_range");
  }
  if (op.shareIndex < 1 || op.shareIndex > DEFAULT_TOTAL_SHARES) {
    return err("share_index_out_of_range");
  }
  if (contract.shareIndex !== undefined && contract.shareIndex !== op.shareIndex) {
    return err("share_index_out_of_range");
  }

  if (typeof op.shareValue !== "string") return err("invalid_share");
  const value = tryParseScalar(op.shareValue);
  if (value === null) return err("invalid_share");

  const generation = team.generations[team.currentGeneration];
  if (generation === undefined) return err("not_initialized");
  const commitments = parseStoredCommitments(generation.commitments);
  if (commitments === null) return err("invalid_commitments");
  if (!verifyShare(op.shareIndex, value, commitments)) return err("invalid_share");

  return ok;
}

function validateSkip(
  state: CryptoBattleState,
  team: TeamState,
  teamId: string,
  op: Extract<CryptoBattleOp, { type: "skip" }>,
  nowMs: number,
): ValidationResult {
  if (!team.initialized) return err("not_initialized");
  if (!isValidId(op.contractId)) return err("unknown_contract");
  const contract = state.contracts.find((c) => c.id === op.contractId);
  if (contract === undefined) return err("unknown_contract");
  if (contract.teamId !== teamId) return err("not_your_contract");
  if (contract.status === "expired") return err("contract_expired");
  if (contract.status !== "open") return err("contract_not_open");
  if (nowMs >= contract.expiresAtMs) return err("contract_expired");
  return ok;
}

function validateHunt(
  state: CryptoBattleState,
  teamId: string,
  op: Extract<CryptoBattleOp, { type: "hunt" }>,
): ValidationResult {
  if (!isValidId(op.targetTeamId)) return err("unknown_team");
  if (op.targetTeamId === teamId) return err("cannot_hunt_self");
  const target = state.teams[op.targetTeamId];
  if (target === undefined) return err("unknown_team");
  if (!target.initialized) return err("not_initialized");

  if (typeof op.generation !== "number" || !Number.isInteger(op.generation) || op.generation < 0) {
    return err("wrong_generation");
  }
  if (op.generation >= target.generations.length) return err("wrong_generation");
  if (op.generation !== target.currentGeneration) return err("stale_generation");

  const claimKey = `${teamId}:${op.targetTeamId}:${op.generation}`;
  if (state.huntsClaimed[claimKey] === true) return err("hunt_already_claimed");

  if (typeof op.secret !== "string") return err("invalid_secret");
  const secretValue = tryParseScalar(op.secret);
  if (secretValue === null) return err("invalid_secret");

  const generationRecord = target.generations[op.generation];
  if (generationRecord === undefined) return err("wrong_generation");
  const commitments = parseStoredCommitments(generationRecord.commitments);
  if (commitments === null) return err("invalid_commitments");
  if (!verifySecret(secretValue, commitments)) return err("invalid_secret");

  return ok;
}

function validateRotate(
  team: TeamState,
  teamId: string,
  op: Extract<CryptoBattleOp, { type: "rotate" }>,
  nowMs: number,
): ValidationResult {
  if (!team.initialized) return err("not_initialized");
  const commitmentsCheck = validateCommitments(op.commitments);
  if (!commitmentsCheck.ok) return commitmentsCheck;
  const currentGen = team.generations[team.currentGeneration];
  if (currentGen === undefined) return err("not_initialized");
  if (nowMs - currentGen.createdAtMs < ROTATE_COOLDOWN_MS) return err("rotate_cooldown");
  const newGeneration = team.currentGeneration + 1;
  const context: ProofContext = { purpose: "rotate", teamId, generation: newGeneration, contractId: "" };
  return validateKnowledgeProof(op.commitments, op.proofCommitment, op.proofResponse, context);
}

/**
 * "prove" op: contract kind "prove-knowledge" を Schnorr proof of knowledge で
 * 充足する。 検証対象はチームの CURRENT generation の C_0 (= commitments[0]) —
 * ROTATE 後に古い generation の proof を使い回すことはできない (context.generation
 * が currentGeneration に束縛されるため)。 基本点は leak と同じく contract.points
 * からそのまま読む (issue: PROVE と LEAK の同一 contract の基本得点は原則同じ —
 * contract 発行側が points を決めるので、この関数は contract.points を信頼するだけ)。
 */
function validateProve(
  state: CryptoBattleState,
  team: TeamState,
  teamId: string,
  op: Extract<CryptoBattleOp, { type: "prove" }>,
  nowMs: number,
): ValidationResult {
  if (!team.initialized) return err("not_initialized");
  if (!isValidId(op.contractId)) return err("unknown_contract");
  const contract = state.contracts.find((c) => c.id === op.contractId);
  if (contract === undefined) return err("unknown_contract");
  if (contract.teamId !== teamId) return err("not_your_contract");
  if (contract.kind !== "prove-knowledge") return err("wrong_contract_kind");
  if (contract.status === "expired") return err("contract_expired");
  if (contract.status !== "open") return err("contract_not_open");
  if (nowMs >= contract.expiresAtMs) return err("contract_expired");

  const generation = team.generations[team.currentGeneration];
  if (generation === undefined) return err("not_initialized");
  const context: ProofContext = {
    purpose: "contract",
    teamId,
    generation: team.currentGeneration,
    contractId: op.contractId,
  };
  return validateKnowledgeProof(generation.commitments, op.commitment, op.response, context);
}

/**
 * op が state に対して妥当かどうかを判定する。 決して throw しない — 不正な入力は
 * 必ず機械可読な error code を返す。
 */
export function validateOp(
  state: CryptoBattleState,
  teamId: string,
  op: CryptoBattleOp,
  nowMs: number,
): ValidationResult {
  if (!isValidId(teamId)) return err("unknown_team");
  const team = state.teams[teamId];
  if (team === undefined) return err("unknown_team");

  // dispatcher からの op は実行時には型保証のない生 JSON payload — null / 非オブジェクト /
  // type 欠落をここで止めないと op.type アクセスで throw してしまう (下の switch は
  // 「type はあるが未知の値」のケースだけを守る)。
  if (typeof op !== "object" || op === null || typeof (op as { type?: unknown }).type !== "string") {
    return err("unknown_op_type");
  }

  switch (op.type) {
    case "init":
      return validateInit(team, teamId, op);
    case "leak":
      return validateLeak(state, team, teamId, op, nowMs);
    case "skip":
      return validateSkip(state, team, teamId, op, nowMs);
    case "hunt":
      return validateHunt(state, teamId, op);
    case "rotate":
      return validateRotate(team, teamId, op, nowMs);
    case "prove":
      return validateProve(state, team, teamId, op, nowMs);
    default: {
      // union に新しい op 種別が増えたらここが型エラーになる — 網羅性チェックを
      // コンパイル時に強制しつつ、万一型を経由しない不正な op.type が実行時に来ても
      // throw せず error code を返す二重の安全策。
      const _exhaustive: never = op;
      return err("unknown_op_type");
    }
  }
}

// --- applyOp ----------------------------------------------------------------------

function applyInit(
  state: CryptoBattleState,
  teamId: string,
  op: Extract<CryptoBattleOp, { type: "init" }>,
  nowMs: number,
): CryptoBattleState {
  const generation: TeamGeneration = {
    generation: 0,
    commitments: [...op.commitments],
    leaked: {},
    createdAtMs: nowMs,
  };
  const newTeam: TeamState = {
    score: 0,
    currentGeneration: 0,
    generations: [generation],
    initialized: true,
  };
  return { ...state, teams: { ...state.teams, [teamId]: newTeam } };
}

function applyLeak(
  state: CryptoBattleState,
  teamId: string,
  op: Extract<CryptoBattleOp, { type: "leak" }>,
  nowMs: number,
): CryptoBattleState {
  const team = state.teams[teamId];
  if (team === undefined) return state;
  const contractIndex = state.contracts.findIndex((c) => c.id === op.contractId);
  if (contractIndex === -1) return state;
  const contract = state.contracts[contractIndex];
  const generation = team.generations[team.currentGeneration];
  if (generation === undefined) return state;

  const contracts = [...state.contracts];
  contracts[contractIndex] = { ...contract, status: "fulfilled" };

  const updatedGeneration: TeamGeneration = {
    ...generation,
    leaked: {
      ...generation.leaked,
      [String(op.shareIndex)]: { value: op.shareValue, leakedAtMs: nowMs },
    },
  };
  const generations = [...team.generations];
  generations[team.currentGeneration] = updatedGeneration;

  const updatedTeam: TeamState = { ...team, score: team.score + contract.points, generations };

  const ledgerEntry: LedgerEntry = {
    at: nowMs,
    teamId,
    kind: "leak",
    contractId: op.contractId,
    shareIndex: op.shareIndex,
    shareValue: op.shareValue,
    points: contract.points,
  };

  return {
    ...state,
    contracts,
    teams: { ...state.teams, [teamId]: updatedTeam },
    publicLedger: [...state.publicLedger, ledgerEntry],
  };
}

function applySkip(
  state: CryptoBattleState,
  _teamId: string,
  op: Extract<CryptoBattleOp, { type: "skip" }>,
): CryptoBattleState {
  const contractIndex = state.contracts.findIndex((c) => c.id === op.contractId);
  if (contractIndex === -1) return state;
  const contracts = [...state.contracts];
  contracts[contractIndex] = { ...contracts[contractIndex], status: "skipped" };
  return { ...state, contracts };
}

function applyHunt(
  state: CryptoBattleState,
  teamId: string,
  op: Extract<CryptoBattleOp, { type: "hunt" }>,
  nowMs: number,
): CryptoBattleState {
  const attacker = state.teams[teamId];
  const target = state.teams[op.targetTeamId];
  if (attacker === undefined || target === undefined) return state;
  const claimKey = `${teamId}:${op.targetTeamId}:${op.generation}`;
  if (state.huntsClaimed[claimKey] === true) return state;

  const updatedAttacker: TeamState = { ...attacker, score: attacker.score + HUNT_BONUS_POINTS };
  const ledgerEntry: LedgerEntry = {
    at: nowMs,
    teamId,
    kind: "hunt-success",
    targetTeamId: op.targetTeamId,
    generation: op.generation,
    points: HUNT_BONUS_POINTS,
    // 復元した secret の値そのものは含めない (issue: 再公開の必要はない)。
  };

  return {
    ...state,
    teams: { ...state.teams, [teamId]: updatedAttacker },
    huntsClaimed: { ...state.huntsClaimed, [claimKey]: true },
    publicLedger: [...state.publicLedger, ledgerEntry],
  };
}

function applyRotate(
  state: CryptoBattleState,
  teamId: string,
  op: Extract<CryptoBattleOp, { type: "rotate" }>,
  nowMs: number,
): CryptoBattleState {
  const team = state.teams[teamId];
  if (team === undefined) return state;
  const newGeneration: TeamGeneration = {
    generation: team.currentGeneration + 1,
    commitments: [...op.commitments],
    leaked: {},
    createdAtMs: nowMs,
  };
  const updatedTeam: TeamState = {
    ...team,
    currentGeneration: newGeneration.generation,
    generations: [...team.generations, newGeneration],
  };
  const ledgerEntry: LedgerEntry = {
    at: nowMs,
    teamId,
    kind: "rotate",
    generation: newGeneration.generation,
  };
  return {
    ...state,
    teams: { ...state.teams, [teamId]: updatedTeam },
    publicLedger: [...state.publicLedger, ledgerEntry],
  };
}

/**
 * "prove" op を適用する。 leak と異なり shareValue のような秘密由来の値は一切
 * ledger に残さない (zero-knowledge proof なので R/s 自体は秘密を漏らさないが、
 * そもそも ledger に載せる意味がないので contractId/generation/points のみ記録する)。
 */
function applyProve(
  state: CryptoBattleState,
  teamId: string,
  op: Extract<CryptoBattleOp, { type: "prove" }>,
  nowMs: number,
): CryptoBattleState {
  const team = state.teams[teamId];
  if (team === undefined) return state;
  const contractIndex = state.contracts.findIndex((c) => c.id === op.contractId);
  if (contractIndex === -1) return state;
  const contract = state.contracts[contractIndex];

  const contracts = [...state.contracts];
  contracts[contractIndex] = { ...contract, status: "fulfilled" };

  const updatedTeam: TeamState = { ...team, score: team.score + contract.points };

  const ledgerEntry: LedgerEntry = {
    at: nowMs,
    teamId,
    kind: "prove",
    contractId: op.contractId,
    generation: team.currentGeneration,
    points: contract.points,
  };

  return {
    ...state,
    contracts,
    teams: { ...state.teams, [teamId]: updatedTeam },
    publicLedger: [...state.publicLedger, ledgerEntry],
  };
}

/**
 * op を state へ適用する。 validateOp を内部で必ず再実行してから分岐する — 直接
 * applyOp を (validateOp を経ずに) 不正な入力で呼んでも state は変化しない
 * no-op になるだけで、決して throw しない。
 */
export function applyOp(
  state: CryptoBattleState,
  teamId: string,
  op: CryptoBattleOp,
  nowMs: number,
): CryptoBattleState {
  const validation = validateOp(state, teamId, op, nowMs);
  if (!validation.ok) return state;

  switch (op.type) {
    case "init":
      return applyInit(state, teamId, op, nowMs);
    case "leak":
      return applyLeak(state, teamId, op, nowMs);
    case "skip":
      return applySkip(state, teamId, op);
    case "hunt":
      return applyHunt(state, teamId, op, nowMs);
    case "rotate":
      return applyRotate(state, teamId, op, nowMs);
    case "prove":
      return applyProve(state, teamId, op, nowMs);
    default: {
      const _exhaustive: never = op;
      return state;
    }
  }
}

// --- contract helpers ---------------------------------------------------------------

/**
 * contract を state へ追加する (決定的な contract injection)。 tick scheduling は
 * PR3 の役割 — この関数はテスト・fixtures から直接呼ぶための最小限のヘルパー。
 * 呼び出し側は信頼された経路 (server 側のスケジューラ/テスト) を想定しており、
 * 敵対的な op 入力の経路 (validateOp/applyOp) には晒さない。
 */
export function issueContract(state: CryptoBattleState, spec: ContractSpec): CryptoBattleState {
  return { ...state, contracts: [...state.contracts, spec] };
}

/** nowMs 時点で期限切れの open contract を expired へ遷移させる。 */
export function expireContracts(state: CryptoBattleState, nowMs: number): CryptoBattleState {
  let changed = false;
  const contracts = state.contracts.map((c) => {
    if (c.status === "open" && nowMs >= c.expiresAtMs) {
      changed = true;
      return { ...c, status: "expired" as const };
    }
    return c;
  });
  return changed ? { ...state, contracts } : state;
}
