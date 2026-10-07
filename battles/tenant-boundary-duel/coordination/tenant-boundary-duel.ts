import type { CoordinationPlugin } from "@tenkacloud/coordination-plugin-sdk";
import {
  initialState,
  validateOp,
  applyOp,
  tick,
  projectForTeam,
  teamScores,
} from "../game/reducer.ts";
import type { Op, Projection, State } from "../game/types.ts";
export default {
  initialState,
  validateOp,
  applyOp,
  tick,
  tickOnRequest: true,
  projectForTeam,
  teamScores,
  stateSchemaVersion: 1,
  scoreReasons: () => ({}),
} satisfies CoordinationPlugin<State, Op, Projection>;
