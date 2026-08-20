/**
 * battles/ac26-crypto-battle/game/types.ts
 *
 * この model は platform の dispatcher (trusted runtime) 上で実行され、サーバーは
 * 秘密を保持しない — commitments のみ。 state / op / projection の型定義。
 *
 * JSON-serializable であることが必須の制約: group / field の元 (bigint) はすべて
 * hex 文字列として保持する。 bigint を state / op の型に直接持ち込まない。
 *
 * PR2: "prove" op (Schnorr proof of knowledge の contract 充足) を追加。 また
 * init/rotate は commitment cloning (他チームの commitments をコピーして登録する
 * 攻撃) を防ぐため、新しい C_0 の離散対数の proof of knowledge を必須にした
 * (proofCommitment/proofResponse — crypto/schnorr.ts の KnowledgeProof)。
 * CryptoBattleOp は union なので、追加時は reducer.ts の switch が網羅性チェックで
 * 検出する。
 */

/** マッチの進行フェーズ。 tick scheduling (PR3) が遷移させる想定。 */
export type Phase = "build" | "pressure" | "endgame";

/** contract の種別。 "prove-knowledge" は PR2 の "prove" op で充足する。 */
export type ContractKind = "leak-share" | "prove-knowledge";

export type ContractStatus = "open" | "fulfilled" | "expired" | "skipped";

/** 1件の contract。 teamId 宛てのプライベートな依頼 (projection では自チーム分のみ見せる)。 */
export interface ContractSpec {
  readonly id: string;
  readonly teamId: string;
  readonly kind: ContractKind;
  /** leak-share では必須: どの share index (1..n) を leak すれば満たせるか。 */
  readonly shareIndex?: number;
  readonly points: number;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly status: ContractStatus;
}

/** leak 済み share 1件の記録。 value は公開情報 (leak = 公開なので秘匿しない)。 */
export interface LeakedShareRecord {
  readonly value: string; // hex, Z_q の scalar
  readonly leakedAtMs: number;
}

/**
 * チームの1世代分の Feldman commitment と、その世代で leak された share の記録。
 * createdAtMs は init (generation 0) または rotate (generation >= 1) の時刻であり、
 * ROTATE のクールダウン判定にも使う (= 実質的な「最後の rotate 時刻」)。
 */
export interface TeamGeneration {
  readonly generation: number; // 0-based
  readonly commitments: readonly string[]; // hex, C_0..C_{t-1} (Z_p の元)
  readonly leaked: Readonly<Record<string, LeakedShareRecord>>; // shareIndex(string) -> record
  readonly createdAtMs: number;
}

export interface TeamState {
  readonly score: number;
  readonly currentGeneration: number;
  readonly generations: readonly TeamGeneration[];
  readonly initialized: boolean;
}

export type LedgerEntryKind = "leak" | "hunt-success" | "rotate" | "prove";

/**
 * 公開 transcript の1行。 replay/debrief 用 (例: "34:10 Team A LEAK share #1")。
 * hunt-success は generation は含むが、復元された secret 値そのものは含めない
 * (issue: 再公開の必要はない — 既に leaked share から公開情報のみで検証できる)。
 * prove は zero-knowledge proof なので R/s (proof の中身) はそもそも秘密を含まないが、
 * ledger に載せる必要もない情報なので contractId/generation/points だけを記録する
 * (shareIndex/shareValue は使わない — leak 専用)。
 */
export interface LedgerEntry {
  readonly at: number;
  readonly teamId: string;
  readonly kind: LedgerEntryKind;
  readonly contractId?: string;
  readonly shareIndex?: number;
  readonly shareValue?: string; // leak のみ。 leak = 公開情報なのでそのまま載せる
  readonly targetTeamId?: string; // hunt-success のみ
  readonly generation?: number; // hunt-success / rotate / prove
  readonly points?: number;
}

export interface CryptoBattleState {
  readonly phase: Phase;
  readonly matchStartMs: number;
  readonly contracts: readonly ContractSpec[];
  readonly publicLedger: readonly LedgerEntry[];
  readonly teams: Readonly<Record<string, TeamState>>;
  /** "attacker:target:generation" -> true。 hunt の冪等性キー。 */
  readonly huntsClaimed: Readonly<Record<string, true>>;
}

/**
 * team が送る operation。 この union は閉じている前提で reducer.ts の switch が
 * 網羅性チェックを行うので、追加時はそちらもコンパイルエラーで検出される。
 *
 * init/rotate は PR2 で proofCommitment/proofResponse (新しい C_0 の離散対数の
 * Schnorr proof of knowledge) が必須になった — これがないと、他チームの
 * commitments をそのままコピーして自分の commitments として登録する
 * "commitment cloning" が可能になってしまう (secret を知らないのに他人の C_0 を
 * 名乗れる。 hunt の正当性は「C_0 の secret を知っているのはその team だけ」という
 * 前提に依存するため、この前提が崩れると hunt semantics 自体が壊れる)。
 */
export type CryptoBattleOp =
  | {
      readonly type: "init";
      readonly commitments: readonly string[];
      readonly proofCommitment: string;
      readonly proofResponse: string;
    }
  | {
      readonly type: "leak";
      readonly contractId: string;
      readonly shareIndex: number;
      readonly shareValue: string;
    }
  | { readonly type: "skip"; readonly contractId: string }
  | {
      readonly type: "hunt";
      readonly targetTeamId: string;
      readonly generation: number;
      readonly secret: string;
    }
  | {
      readonly type: "rotate";
      readonly commitments: readonly string[];
      readonly proofCommitment: string;
      readonly proofResponse: string;
    }
  | {
      readonly type: "prove";
      readonly contractId: string;
      readonly commitment: string;
      readonly response: string;
    };

export type ValidationResult = { readonly ok: true } | { readonly ok: false; readonly error: string };
