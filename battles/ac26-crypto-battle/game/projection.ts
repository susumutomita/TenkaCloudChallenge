/**
 * battles/ac26-crypto-battle/game/projection.ts
 *
 * この model は platform の dispatcher (trusted runtime) 上で実行され、サーバーは
 * 秘密を保持しない — commitments のみ。 projectForTeam は各チームの portal に
 * そのまま届く投影 (projection) を作る — この関数の出力に、他チームの
 * 「leak されていない」share 値や、他チームの contract queue のような非公開情報を
 * 絶対に含めてはならない。
 *
 * そもそも「leak されていない自チームの share 値」自体が server state に一切
 * 存在しない (client 側だけが持つ) ので、この関数がそれを漏らす経路は構造的に
 * 存在しない。 own vault は「自チームの share のうちどの index が leak 済みか」
 * という risk view であり、値そのものは持たない。
 */

import type { ContractSpec, CryptoBattleState, LedgerEntry, Phase } from "./types.ts";

/** 自チームの1世代分の leak 状況 (risk view)。 値は含まない、index のみ。 */
export interface TeamVaultGenerationView {
  readonly generation: number;
  readonly leakedShareIndexes: readonly number[];
}

export interface TeamVaultView {
  readonly currentGeneration: number;
  readonly generations: readonly TeamVaultGenerationView[];
}

export interface ScoreboardEntry {
  readonly teamId: string;
  readonly score: number;
}

export interface CryptoBattleProjection {
  readonly phase: Phase;
  readonly matchStartMs: number;
  /** 自チーム宛の contract のみ (他チームの contract queue は非公開)。 */
  readonly ownContracts: readonly ContractSpec[];
  /** 未初期化のチームには null。 */
  readonly ownVault: TeamVaultView | null;
  /** 全チームの leak/hunt-success/rotate イベント。 leak の値は公開情報。 */
  readonly publicLedger: readonly LedgerEntry[];
  readonly scoreboard: readonly ScoreboardEntry[];
}

function buildVault(state: CryptoBattleState, teamId: string): TeamVaultView | null {
  const team = state.teams[teamId];
  if (team === undefined || !team.initialized) return null;
  return {
    currentGeneration: team.currentGeneration,
    generations: team.generations.map((g) => ({
      generation: g.generation,
      leakedShareIndexes: Object.keys(g.leaked)
        .map((k) => Number(k))
        .sort((a, b) => a - b),
    })),
  };
}

/** teamId の portal が見る投影を組み立てる。 */
export function projectForTeam(
  state: CryptoBattleState,
  teamId: string,
): CryptoBattleProjection {
  const ownContracts = state.contracts.filter((c) => c.teamId === teamId);
  const scoreboard = Object.entries(state.teams)
    .map(([id, t]) => ({ teamId: id, score: t.score }))
    .sort((a, b) => a.teamId.localeCompare(b.teamId));

  return {
    phase: state.phase,
    matchStartMs: state.matchStartMs,
    ownContracts,
    ownVault: buildVault(state, teamId),
    publicLedger: state.publicLedger,
    scoreboard,
  };
}
