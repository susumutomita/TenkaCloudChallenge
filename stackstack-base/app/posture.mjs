import { participantPosts } from "./board.mjs";
import { readConfig } from "./config.mjs";
import { READY_TOKEN } from "./secrets.mjs";

/**
 * `/posture` reports what is *measured* about the running app, never what a
 * participant claims. It is the same idea the StackStack Battle uses on AWS:
 * a gate is true because the app looked, not because a flag was set.
 *
 * A scenario supplies its own gates as pure predicates over the observed
 * surface, so each StackStack problem can measure its own definition of ready
 * while sharing this reporting shape.
 */

/** Route hits the app has served, e.g. "GET /api/logs". */
const observed = new Set();

export function observe(event) {
  observed.add(event);
}

/**
 * Evaluate a scenario's gates.
 * @param {Record<string, (context: object) => boolean>} gates
 */
export function posture(gates) {
  const config = readConfig();
  const context = {
    observed,
    config: config.value,
    configOk: config.ok,
    participantPosts: participantPosts(),
  };
  const state = {};
  for (const [name, predicate] of Object.entries(gates)) {
    state[name] = predicate(context) === true;
  }
  // `every` on an empty list is true, so a scenario that forgot to export
  // `gates` would be reported ready and hand out its sign-off token having
  // measured nothing at all. No gates means nothing is known, not that
  // everything is fine.
  const ready = Object.keys(state).length > 0 && Object.values(state).every(Boolean);
  return {
    gates: state,
    ready,
    // Withheld until every gate is green: the token is the proof of the whole
    // pass, so handing it out early would let a checkpoint be answered without
    // the work behind it.
    readyToken: ready ? READY_TOKEN : null,
    configError: config.error,
  };
}
