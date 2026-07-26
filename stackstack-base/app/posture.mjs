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

export function resetPosture() {
  observed.clear();
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
  const ready = Object.values(state).every(Boolean);
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
