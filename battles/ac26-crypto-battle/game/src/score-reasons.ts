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
    reasons[teamId] = cause.kind === "tick" ? "deadline" : operationReason(cause.op.kind, teamId !== cause.teamId);
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
