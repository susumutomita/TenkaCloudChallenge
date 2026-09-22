import { defineCoordinationPlugin } from "@tenkacloud/coordination-plugin-sdk";
import { applyOp, initialState, projectForTeam, teamScores, validateOp } from "./exchange";
export default defineCoordinationPlugin({
  initialState, validateOp, applyOp, projectForTeam, teamScores, stateSchemaVersion: 1,
  scoreReasons: (before, after) => Object.fromEntries(Object.entries(teamScores(after)).filter(([id, score]) => score !== teamScores(before)[id]).map(([id]) => [id, "partner_exchange"])),
});
