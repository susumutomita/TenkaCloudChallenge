import type { CryptoBattleProjection, HuntBudgetProjection, CipherPairArtifact, SudokuRevealArtifact } from "../game/src/types.ts";
import { rungSpec, type CipherRung } from "../game/src/ladder.ts";

/** Distinct public share indices, grouped by opponent and current generation. */
export function ledgerTargets(projection: CryptoBattleProjection | null) {
  if (!projection) return [];
  const seen = new Set<string>();
  const targets: { teamId: string; generation: number; shareIndices: number[] }[] = [];
  for (const entry of projection.publicLedger) {
    if (entry.kind !== "share" || entry.teamId === projection.vault.teamId || entry.generation !== projection.teams[entry.teamId]?.generation) continue;
    const key = `${entry.teamId}:${entry.generation}`;
    let target = targets.find((candidate) => `${candidate.teamId}:${candidate.generation}` === key);
    if (!target) {
      target = { teamId: entry.teamId, generation: entry.generation, shareIndices: [] };
      targets.push(target);
    }
    const indexKey = `${key}:${entry.shareIndex}`;
    if (!seen.has(indexKey)) {
      seen.add(indexKey);
      target.shareIndices.push(entry.shareIndex);
    }
  }
  return targets;
}


/** Only the reader's budget against the requested current generation. */
export function huntBudgetFor(
  projection: CryptoBattleProjection | null,
  target: { readonly teamId: string; readonly generation: number },
): HuntBudgetProjection | undefined {
  const budget = projection?.huntAttempts[target.teamId];
  return budget !== undefined && budget.generation === target.generation ? budget : undefined;
}


export interface CipherHuntCandidate {
  readonly teamId: string;
  readonly generation: number;
  readonly rung: CipherRung;
  readonly pairs: readonly CipherPairArtifact[];
  readonly pairsToBreak: number;
}

/** Current-generation pairs, deduplicated by Order, against each rung's public threshold. */
export function cipherHuntCandidates(
  projection: CryptoBattleProjection | null,
): readonly CipherHuntCandidate[] {
  if (!projection) return [];
  const byKey = new Map<string, CipherHuntCandidate>();
  for (const entry of projection.publicLedger) {
    if (entry.kind !== "cipher-pair" || projection.teams[entry.teamId]?.generation !== entry.generation) continue;
    // Never your own team: hunting yourself is refused by the reducer, and
    // offering it here would be offering a move that cannot be made.
    if (entry.teamId === projection.vault.teamId) continue;
    const key = `${entry.teamId}:${entry.generation}:${entry.rung}`;
    const current = byKey.get(key) ?? {
      teamId: entry.teamId,
      generation: entry.generation,
      rung: entry.rung,
      pairs: [],
      pairsToBreak: rungSpec(entry.rung).pairsToBreak,
    };
    if (!current.pairs.some(pair => pair.contractId === entry.contractId)) byKey.set(key, { ...current, pairs: [...current.pairs, entry] });
  }
  return [...byKey.values()].filter((c) => c.pairs.length >= c.pairsToBreak);
}


export interface SudokuHuntCandidate {
  readonly teamId: string;
  readonly teamName: string;
  readonly generation: number;
  readonly puzzle: readonly number[];
  readonly reveals: readonly SudokuRevealArtifact[];
}

/** Public puzzle and opened groups; HuntPanel applies reuse and uniqueness before offering a form. */
export function sudokuHuntCandidates(
  projection: CryptoBattleProjection | null,
): readonly SudokuHuntCandidate[] {
  if (!projection) return [];
  const byTeam = new Map<string, SudokuHuntCandidate>();
  for (const entry of projection.publicLedger) {
    if (entry.kind !== "sudoku-reveal" || entry.teamId === projection.vault.teamId) continue;
    const team = projection.teams[entry.teamId];
    const puzzle = projection.publicPuzzles[entry.teamId];
    if (team === undefined || puzzle === undefined || team.generation !== entry.generation) continue;
    const current = byTeam.get(entry.teamId) ?? {
      teamId: entry.teamId,
      teamName: team.teamName || entry.teamId,
      generation: team.generation,
      puzzle,
      reveals: [],
    };
    byTeam.set(entry.teamId, { ...current, reveals: [...current.reveals, entry] });
  }
  return [...byTeam.values()];
}

