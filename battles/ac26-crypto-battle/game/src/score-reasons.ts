import type { CryptoBattleOp, CryptoBattleState } from "./types.ts";

/** Public classification only. Never copy an answer, recovered secret, proof, or target ID. */
export function scoreReasons(
  before: CryptoBattleState,
  after: CryptoBattleState,
  cause: { readonly kind: "op"; readonly teamId: string; readonly op: CryptoBattleOp } | { readonly kind: "tick" },
): Readonly<Record<string, string>> {
  const reasons: Record<string, string> = {};
  for (const [teamId, team] of Object.entries(after.teams)) {
    if (team.score === before.teams[teamId]?.score) continue;
    const duelPoints = newDuelPoints(before, after, teamId);
    const lastHunt = team.lastRpsHunt;
    const delta = team.score - (before.teams[teamId]?.score ?? 0);
    // A single opening can settle several predictions; the final result may have zero
    // points after an earlier penalty reached the floor. Compare the net change too.
    const huntSettled = lastHunt && delta !== duelPoints && JSON.stringify(lastHunt) !== JSON.stringify(before.teams[teamId]?.lastRpsHunt);
    if (cause.kind === "op" && cause.op.kind === "rps-open" && huntSettled) {
      reasons[teamId] = duelPoints > 0 ? "duel-hunt" : "hunt";
    } else if (cause.kind === "tick" && duelPoints > 0) {
      reasons[teamId] = delta === duelPoints ? "duel" : "duel-deadline";
    } else {
      reasons[teamId] = cause.kind === "tick" ? "deadline" : operationReason(cause.op.kind, teamId !== cause.teamId);
    }
  }
  return reasons;
}

function operationReason(kind: CryptoBattleOp["kind"], otherTeam: boolean): string {
  switch (kind) {
    case "prove-sudoku": return "prove";
    case "cipher": return "cipher";
    case "leak": return "leak";
    case "fhe": return "fhe";
    case "mpc": return "mpc";
    case "rps-commit":
    case "rps-open": return "duel";
    case "hunt":
    case "hunt-cipher":
    case "hunt-sudoku":
    case "hunt-rps": return otherTeam ? "hunted" : "hunt";
    case "rotate": return "rotate";
    case "reveal-hint": return "hint";
    case "ready":
    case "start": return "coordination";
  }
}

/** Only completed public adjudications; private predictions/openings are never returned. */
function newDuelPoints(before: CryptoBattleState, after: CryptoBattleState, teamId: string): number {
  let points = 0;
  for (const order of after.contracts) {
    if (order.teamId !== teamId || order.resolution !== "duel" || order.status !== "completed") continue;
    if (before.contracts.find(previous => previous.id === order.id)?.status !== "open") continue;
    if (order.rps?.outcome === "draw") points += after.config.scores.duelDraw;
    if (order.rps?.outcome === "win" || order.rps?.outcome === "forfeit-win") points += after.config.scores.duelWin;
  }
  return points;
}
