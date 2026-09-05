import type { CryptoBattleState } from "./types.ts";

/** Logical Shamir/RPS identity; successful-HUNT records keep this public-ID form. */
export function huntKey(attackerTeamId: string, targetTeamId: string, generation: number): string {
  return JSON.stringify([attackerTeamId, targetTeamId, generation]);
}

/**
 * Schema 4 stores budget keys using positions in the fixed, sorted match roster.
 * JSON numbers cannot collide with the old JSON string IDs. No roster field or
 * shared budget is added, and sorting makes object insertion order irrelevant.
 */
export function storedHuntKey(state: Pick<CryptoBattleState, "teams">, logicalKey: string): string {
  const parts: unknown[] = JSON.parse(logicalKey);
  const offset = parts.length === 4 && parts[0] === "sudoku" ? 1 : 0;
  if (parts.length !== offset + 3 || typeof parts[offset] !== "string" || typeof parts[offset + 1] !== "string" || !Number.isSafeInteger(parts[offset + 2])) throw new Error("Invalid logical HUNT budget key");
  const roster = Object.keys(state.teams).sort();
  const attacker = roster.indexOf(parts[offset] as string), target = roster.indexOf(parts[offset + 1] as string);
  if (attacker < 0 || target < 0) throw new Error("HUNT budget references an unknown team");
  return JSON.stringify([...(offset ? ["sudoku"] : []), attacker, target, parts[offset + 2]]);
}

export function compactHuntAttempts(state: CryptoBattleState): CryptoBattleState["huntAttempts"] {
  const attempts: Record<string, number> = {};
  for (const [key, count] of Object.entries(state.huntAttempts)) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid HUNT budget count");
    attempts[storedHuntKey(state, key)] = count;
  }
  return attempts;
}

/** Old-generation counters have no legal caller except a reserved RPS refund. */
export function pruneRetiredHuntAttempts(state: CryptoBattleState): CryptoBattleState {
  const roster = Object.keys(state.teams).sort();
  const reserved = new Set<string>();
  for (const c of state.contracts) for (const [attacker, [, generation]] of Object.entries(c.rps?.predictions ?? {})) reserved.add(storedHuntKey(state, huntKey(predictionTeam(state, attacker), c.teamId, generation)));
  const entries = Object.entries(state.huntAttempts).filter(([key]) => {
    const parts = JSON.parse(key) as (string | number)[];
    const offset = parts[0] === "sudoku" ? 1 : 0;
    const target = roster[Number(parts[offset + 1])];
    return (target !== undefined && state.teams[target]?.generation === parts[offset + 2]) || reserved.has(key);
  });
  return entries.length === Object.keys(state.huntAttempts).length ? state : { ...state, huntAttempts: Object.fromEntries(entries) };
}

/** Judge-private pending predictions use the same fixed-roster identity. */
export function predictionKey(state: Pick<CryptoBattleState, "teams">, teamId: string): string {
  const index = Object.keys(state.teams).sort().indexOf(teamId);
  if (index < 0) throw new Error("Prediction references an unknown team");
  return String(index);
}
export function predictionTeam(state: Pick<CryptoBattleState, "teams">, key: string): string {
  const index = Number(key), teamId = Object.keys(state.teams).sort()[index];
  if (!Number.isSafeInteger(index) || String(index) !== key || teamId === undefined) throw new Error("Invalid prediction roster position");
  return teamId;
}
