import type { CryptoBattleState } from "./types.ts";

type Teams = CryptoBattleState["teams"];
const rosterCache = new WeakMap<Teams, { ids: readonly string[]; positions: ReadonlyMap<string, number> }>();

/** Reducer team maps are immutable; memoization only avoids repeated sorting. */
function rosterOf(teams: Teams) {
  let roster = rosterCache.get(teams);
  if (!roster) {
    const ids = Object.keys(teams).sort();
    roster = { ids, positions: new Map(ids.map((id, index) => [id, index])) };
    rosterCache.set(teams, roster);
  }
  return roster;
}

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
  const roster = rosterOf(state.teams);
  const attacker = roster.positions.get(parts[offset] as string), target = roster.positions.get(parts[offset + 1] as string);
  if (attacker === undefined || target === undefined) throw new Error("HUNT budget references an unknown team");
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
  const roster = rosterOf(state.teams).ids;
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
  const index = rosterOf(state.teams).positions.get(teamId);
  if (index === undefined) throw new Error("Prediction references an unknown team");
  return String(index);
}
export function predictionTeam(state: Pick<CryptoBattleState, "teams">, key: string): string {
  const index = Number(key), teamId = rosterOf(state.teams).ids[index];
  if (!Number.isSafeInteger(index) || String(index) !== key || teamId === undefined) throw new Error("Invalid prediction roster position");
  return teamId;
}
