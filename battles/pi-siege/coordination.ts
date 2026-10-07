import { applyOp, initialState, projectForTeam, teamScores, validateOp } from "./game/reducer.ts";
// The existing coordination hook shape. The local prototype composes these same hooks.
// No catalog metadata declares host support: native discovery is currently ID-specific.
export default { initialState, validateOp, applyOp, projectForTeam, teamScores, stateSchemaVersion: 1 };
