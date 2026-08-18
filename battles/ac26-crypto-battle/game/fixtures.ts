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
 */

import { shareSecret, type FeldmanShare } from "./crypto/feldman.ts";
import { bigintToHex } from "./crypto/modmath.ts";
import { Q } from "./crypto/group.ts";
import { mod } from "./crypto/modmath.ts";
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

/** 1チーム分の (client 側にしか存在しない) 秘密一式 + そこから導かれる公開情報。 */
export interface TeamFixture {
  readonly teamId: string;
  readonly secret: bigint;
  readonly coefficients: readonly bigint[]; // a_1..a_{t-1}
  readonly shares: readonly FeldmanShare[]; // n 個すべて (client 側が持つ)
  readonly commitments: readonly bigint[]; // C_0..C_{t-1} (公開)
}

/** seed 文字列から決定的にチームの secret/coefficients/shares/commitments を作る。 */
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
  return { teamId, secret, coefficients, shares, commitments };
}

/** fixture の commitments から init op を組み立てる。 */
export function initOpFor(fixture: TeamFixture): Extract<CryptoBattleOp, { type: "init" }> {
  return { type: "init", commitments: fixture.commitments.map(bigintToHex) };
}

/** fixture の commitments から rotate op を組み立てる (新しい世代として再利用)。 */
export function rotateOpFor(fixture: TeamFixture): Extract<CryptoBattleOp, { type: "rotate" }> {
  return { type: "rotate", commitments: fixture.commitments.map(bigintToHex) };
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
