/** Actual RSA reducer trace with all pairs in eleven generations, staggered by ms.
 * Two windows require four base-64 digits; all others require three. Pre-endgame
 * ROTATEs also exercise the longest legal generation numbers, rather than 1..11.
 */
import { decodeHuntLog } from "./hunt-log.ts";
import {
  applyOp,
  DEFAULT_CONFIG,
  initialState,
  projectForTeam,
  tick,
  validateOp,
} from "./reducer.ts";

export function playMaximumRsaHistory(teamCount: number) {
  const teamIds = Array.from({ length: teamCount }, (_, i) => String(i).padStart(26, "0"));
  const startMs = 1_788_595_200_000;
  let state = applyOp(
    tick(initialState({ eventId: "rsa-capacity", teamIds, matchSecret: "s".repeat(64) }), startMs),
    teamIds[0]!,
    { kind: "start" },
  );
  const endgameAt = startMs + DEFAULT_CONFIG.phaseBoundaries.pressureToEndgameMs;
  const rotate = () => {
    for (const team of teamIds) {
      const op = { kind: "rotate" as const };
      const validation = validateOp(state, team, op);
      if (!validation.ok) throw new Error(`capacity ROTATE rejected: ${validation.error}`);
      state = applyOp(state, team, op);
    }
  };
  for (let at = startMs; at < endgameAt; at += DEFAULT_CONFIG.rotateCooldownMs) {
    state = tick(state, at);
    rotate();
  }
  const firstGeneration = state.teams[teamIds[0]!]!.generation;
  const spans = [7_000, 263_000, 263_000, ...Array<number>(7).fill(180_000), 7_000];
  const starts: number[] = [];
  let windowStart = endgameAt;
  for (const [window, span] of spans.entries()) {
    starts.push(windowStart);
    state = tick(state, windowStart);
    if (window > 0) rotate();
    const factors = projectForTeam(state, teamIds[0]!).publicRsaKeys!.map((key) => {
      const p = [3, 5, 7, 11, 13].find((n) => key.n % n === 0)!;
      return { teamId: key.teamId, generation: key.generation, p: String(p), q: String(key.n / p) };
    });
    for (let position = 0; position < teamCount - 1; position++) {
      const offset = teamCount <= 2 ? 0 : Math.floor((position * (span - 1)) / (teamCount - 2));
      state = tick(state, windowStart + offset);
      for (const [target, teamId] of teamIds.entries()) {
        const attacker = teamIds[position < target ? position : position + 1]!;
        const key = factors.find((k) => k.teamId === teamId)!;
        const op = {
          kind: "hunt-rsa" as const,
          targetTeamId: teamId,
          generation: key.generation,
          p: key.p,
          q: key.q,
        };
        const validation = validateOp(state, attacker, op);
        if (!validation.ok) throw new Error(`capacity RSA rejected: ${validation.error}`);
        state = applyOp(state, attacker, op);
      }
    }
    windowStart += span;
  }
  if (windowStart !== startMs + DEFAULT_CONFIG.matchDurationMs)
    throw new Error("capacity windows changed match duration");
  const persisted = JSON.parse(JSON.stringify(state)) as typeof state;
  const replay = decodeHuntLog({
    ...persisted,
    teams: Object.fromEntries(Object.entries(persisted.teams).reverse()),
  });
  if (replay.length !== teamCount * (teamCount - 1) * 11)
    throw new Error("capacity history lost a success");
  for (const event of replay) {
    const target = teamIds.indexOf(event.targetTeamId),
      attacker = teamIds.indexOf(event.attackerTeamId);
    const position = attacker < target ? attacker : attacker - 1;
    const window = event.generation - firstGeneration;
    const offset =
      teamCount <= 2 ? 0 : Math.floor((position * (spans[window]! - 1)) / (teamCount - 2));
    if (event.via !== "rsa" || event.atMs !== starts[window]! + offset)
      throw new Error("capacity replay changed identity, generation or milliseconds");
  }
  return { state: persisted, successes: replay.length };
}
