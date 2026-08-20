/**
 * battles/ac26-crypto-battle/game/fixtures.ts
 *
 * この model は platform の dispatcher (trusted runtime) 上で実行され、サーバーは
 * 秘密を保持しない — commitments のみ。 このファイル自体はテスト専用の決定的
 * fixture 生成器で、production の trust boundary には関わらない。 ここで作る
 * secret / coefficients は「テストコード内だけに存在する client 側の値」であり、
 * reducer には commitments と (意図的に) leak させた share しか渡さない。
 *
 * Math.random は使わない — splitmix64 ベースの決定的擬似乱数生成器 (文字列 seed
 * から常に同じ bigint 列を再現する) だけを使う。 これにより「同じ fixture seed
 * なら同じ state になる」determinism テストが成立する。
 *
 * PR2: init/rotate op は Schnorr proof of knowledge (proofCommitment/proofResponse)
 * を必須に持つ。 この proof 用の nonce も RNG (createRng) から取る — Math.random
 * は使わない、という同じ制約が nonce にもかかる。
 */

import { shareSecret, type FeldmanShare } from "./crypto/feldman.ts";
import { bigintToHex } from "./crypto/modmath.ts";
import { Q } from "./crypto/group.ts";
import { mod } from "./crypto/modmath.ts";
import { proveKnowledge, type ProofContext } from "./crypto/schnorr.ts";
import { applyOp, initialState, issueContract } from "./reducer.ts";
import { CONTRACT_SUCCESS_POINTS, DEFAULT_THRESHOLD, DEFAULT_TOTAL_SHARES } from "./constants.ts";
import type { ContractSpec, CryptoBattleOp, CryptoBattleState } from "./types.ts";

// --- splitmix64 ベースの決定的 RNG -------------------------------------------------

const MASK64 = (1n << 64n) - 1n;
const SPLITMIX64_GAMMA = 0x9e3779b97f4a7c15n;

/** 文字列 seed を 64-bit の初期 state へ変換する (FNV-1a 64-bit hash)。 */
function seedFromString(seed: string): bigint {
  const FNV_OFFSET = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;
  let hash = FNV_OFFSET;
  const bytes = new TextEncoder().encode(seed);
  for (const b of bytes) {
    hash = (hash ^ BigInt(b)) & MASK64;
    hash = (hash * FNV_PRIME) & MASK64;
  }
  return hash;
}

/** splitmix64 の1ステップ。 state を進め、その state をスクランブルした出力を返す。 */
function splitmix64Next(state: bigint): { value: bigint; state: bigint } {
  const nextState = (state + SPLITMIX64_GAMMA) & MASK64;
  let z = nextState;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  z = z ^ (z >> 31n);
  return { value: z, state: nextState };
}

/** Q の bit 数を十分覆うだけの 64-bit word 数。 Q は 2047-bit なので余裕を持たせる。 */
const WORDS_FOR_SCALAR = 34; // 34*64 = 2176 bit > 2047 bit

export interface DeterministicRng {
  /** Z_q 上の疑似乱数 scalar を1つ返す。 */
  nextScalar(): bigint;
}

/**
 * rng.nextScalar() を、0 を引くまで (実用上はまず起こらない) 引き直して返す。
 * Schnorr の nonce は 0 を許さない (proveKnowledge が [1, Q-1] を要求する) ので、
 * このヘルパーを nonce 用にだけ使う — secret / coefficients は従来通り 0 も許容する。
 */
function nextNonzeroScalar(rng: DeterministicRng): bigint {
  let value = rng.nextScalar();
  while (value === 0n) value = rng.nextScalar();
  return value;
}

/** 文字列 seed から決定的な RNG を作る。 同じ seed なら常に同じ scalar 列。 */
export function createRng(seed: string): DeterministicRng {
  let state = seedFromString(seed);
  const nextWord = (): bigint => {
    const { value, state: nextState } = splitmix64Next(state);
    state = nextState;
    return value;
  };
  return {
    nextScalar(): bigint {
      let acc = 0n;
      for (let i = 0; i < WORDS_FOR_SCALAR; i++) {
        acc = (acc << 64n) | nextWord();
      }
      return mod(acc, Q);
    },
  };
}

// --- team fixture -------------------------------------------------------------------

/**
 * 1チーム分の (client 側にしか存在しない) 秘密一式 + そこから導かれる公開情報。
 * proofNonce は init/rotate の Schnorr proof of knowledge 専用の nonce
 * (PR2) — leak/hunt の share/secret とは無関係。
 */
export interface TeamFixture {
  readonly teamId: string;
  readonly secret: bigint;
  readonly coefficients: readonly bigint[]; // a_1..a_{t-1}
  readonly shares: readonly FeldmanShare[]; // n 個すべて (client 側が持つ)
  readonly commitments: readonly bigint[]; // C_0..C_{t-1} (公開)
  readonly proofNonce: bigint; // init/rotate の proof of knowledge 用 nonce
}

/** seed 文字列から決定的にチームの secret/coefficients/shares/commitments/proofNonce を作る。 */
export function buildTeamFixture(
  teamId: string,
  seed: string,
  t: number = DEFAULT_THRESHOLD,
  n: number = DEFAULT_TOTAL_SHARES,
): TeamFixture {
  const rng = createRng(seed);
  const secret = rng.nextScalar();
  const coefficients = Array.from({ length: t - 1 }, () => rng.nextScalar());
  const { shares, commitments } = shareSecret(secret, coefficients, n);
  const proofNonce = nextNonzeroScalar(rng);
  return { teamId, secret, coefficients, shares, commitments, proofNonce };
}

/**
 * fixture の commitments + proof of knowledge から init op を組み立てる。
 * PR2: 素の commitments だけでなく、C_0 の離散対数を知っていることの Schnorr proof
 * (proofCommitment/proofResponse) も必須 — さもないと他チームの commitments を
 * コピーするだけで「自分の commitments」を名乗れてしまう (commitment cloning)。
 */
export function initOpFor(fixture: TeamFixture): Extract<CryptoBattleOp, { type: "init" }> {
  const context: ProofContext = { purpose: "init", teamId: fixture.teamId, generation: 0, contractId: "" };
  const proof = proveKnowledge(fixture.secret, fixture.proofNonce, context);
  return {
    type: "init",
    commitments: fixture.commitments.map(bigintToHex),
    proofCommitment: proof.commitment,
    proofResponse: proof.response,
  };
}

/**
 * fixture の commitments + proof of knowledge から rotate op を組み立てる
 * (新しい世代として再利用)。 generation は「rotate 後に成立する新世代番号」
 * (= 呼び出し側が知っている team.currentGeneration + 1) — fixture 自体は
 * どの世代に使われるかを知らないので、呼び出し側が明示的に渡す。
 */
export function rotateOpFor(
  fixture: TeamFixture,
  generation: number,
): Extract<CryptoBattleOp, { type: "rotate" }> {
  const context: ProofContext = { purpose: "rotate", teamId: fixture.teamId, generation, contractId: "" };
  const proof = proveKnowledge(fixture.secret, fixture.proofNonce, context);
  return {
    type: "rotate",
    commitments: fixture.commitments.map(bigintToHex),
    proofCommitment: proof.commitment,
    proofResponse: proof.response,
  };
}

/**
 * fixture の secret から prove-knowledge contract 用の proof を組み立てる。
 * nonce は init/rotate の proofNonce とは独立に、contractId ごとに一意な決定的値
 * (seed = teamId+contractId から派生する RNG) を使う — 同じ nonce を複数 context で
 * 使い回すと special soundness で secret が漏れる (schnorr.ts のヘッダコメント、
 * scripts/ac26-crypto-battle.test.ts のnonce-reuse attack テスト参照)。
 */
export function proveOpFor(
  fixture: TeamFixture,
  contractId: string,
  generation: number,
): Extract<CryptoBattleOp, { type: "prove" }> {
  const nonce = nextNonzeroScalar(createRng(`${fixture.teamId}-prove-nonce-${contractId}`));
  const context: ProofContext = {
    purpose: "contract",
    teamId: fixture.teamId,
    generation,
    contractId,
  };
  const proof = proveKnowledge(fixture.secret, nonce, context);
  return { type: "prove", contractId, commitment: proof.commitment, response: proof.response };
}

/** fixture の指定 share index から leak op を組み立てる。 */
export function leakOpFor(
  fixture: TeamFixture,
  contractId: string,
  shareIndex: number,
): Extract<CryptoBattleOp, { type: "leak" }> {
  const share = fixture.shares.find((s) => s.i === shareIndex);
  if (share === undefined) {
    throw new RangeError(`leakOpFor: no share with index ${shareIndex} in fixture`);
  }
  return { type: "leak", contractId, shareIndex, shareValue: bigintToHex(share.value) };
}

/** fixture の secret から hunt op を組み立てる (hunter が自力で復元した値を渡す想定の代替)。 */
export function huntOpFor(
  targetTeamId: string,
  generation: number,
  secret: bigint,
): Extract<CryptoBattleOp, { type: "hunt" }> {
  return { type: "hunt", targetTeamId, generation, secret: bigintToHex(secret) };
}

// --- state builders -------------------------------------------------------------------

/** 2チーム分の初期化済み state を組み立てる。 テストの共通セットアップ用。 */
export function buildTwoTeamState(
  teamAId: string,
  teamBId: string,
  matchStartMs: number,
  seedA: string = `${teamAId}-seed`,
  seedB: string = `${teamBId}-seed`,
): { state: CryptoBattleState; teamA: TeamFixture; teamB: TeamFixture } {
  const teamA = buildTeamFixture(teamAId, seedA);
  const teamB = buildTeamFixture(teamBId, seedB);
  let state = initialState([teamAId, teamBId], matchStartMs);
  state = applyOp(state, teamAId, initOpFor(teamA), matchStartMs);
  state = applyOp(state, teamBId, initOpFor(teamB), matchStartMs);
  return { state, teamA, teamB };
}

/**
 * 標準的な leak-share contract 列を issue する (tick scheduling (PR3) の代替、
 * テスト用の決定的な contract 注入)。 shareIndexes の順で1件ずつ contract を作る。
 */
export function issueStandardLeakContracts(
  state: CryptoBattleState,
  teamId: string,
  shareIndexes: readonly number[],
  issuedAtMs: number,
  expiresAtMs: number,
): { state: CryptoBattleState; contractIds: string[] } {
  let next = state;
  const contractIds: string[] = [];
  for (const shareIndex of shareIndexes) {
    const id = `${teamId}-leak-${shareIndex}-${issuedAtMs}`;
    const spec: ContractSpec = {
      id,
      teamId,
      kind: "leak-share",
      shareIndex,
      points: CONTRACT_SUCCESS_POINTS,
      issuedAtMs,
      expiresAtMs,
      status: "open",
    };
    next = issueContract(next, spec);
    contractIds.push(id);
  }
  return { state: next, contractIds };
}

/**
 * "prove-knowledge" contract を1件 issue する。 leak-share と異なり shareIndex を
 * 持たない — 対象は常にチームの現在世代の C_0 (Schnorr proof of knowledge で
 * 証明する)。 points のデフォルトは leak-share と同じ CONTRACT_SUCCESS_POINTS
 * (issue MUST: PROVE と LEAK の同一 Contract の基本得点は原則同じ)。
 */
export function issueProveContract(
  state: CryptoBattleState,
  teamId: string,
  issuedAtMs: number,
  expiresAtMs: number,
  points: number = CONTRACT_SUCCESS_POINTS,
): { state: CryptoBattleState; contractId: string } {
  const id = `${teamId}-prove-${issuedAtMs}`;
  const spec: ContractSpec = {
    id,
    teamId,
    kind: "prove-knowledge",
    points,
    issuedAtMs,
    expiresAtMs,
    status: "open",
  };
  return { state: issueContract(state, spec), contractId: id };
}
