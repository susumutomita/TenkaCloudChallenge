import { applyOp, initialState, migrateState, projectForTeam, scoreReasons, STATE_SCHEMA_VERSION, teamScores, validateOp } from "../game/reducer.ts";
// Structural existing CoordinationPlugin contract; no SDK runtime dependency.
export default { initialState, validateOp, applyOp, projectForTeam, teamScores, scoreReasons, migrateState, stateSchemaVersion: STATE_SCHEMA_VERSION };
