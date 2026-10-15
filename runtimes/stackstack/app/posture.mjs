import { participantPosts } from "./board.mjs";
import { readConfig } from "./config.mjs";
import { READY_TOKEN, gateToken } from "./secrets.mjs";

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
 *
 * @param {object} scenario the loaded scenario module
 * @param {object} [extra] scenario-owned state to expose to its own predicates
 */
export function posture(scenario, extra = {}) {
  const gates = scenario.gates ?? {};
  const config = readConfig();
  const context = {
    observed,
    config: config.value,
    configOk: config.ok,
    participantPosts: participantPosts(),
    ...extra,
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
    ...(scenario.gateTokens === true ? { tokens: tokensFor(state) } : {}),
    ready,
    // Withheld until every gate is green: the token is the proof of the whole
    // pass, so handing it out early would let a checkpoint be answered without
    // the work behind it.
    readyToken: ready ? READY_TOKEN : null,
    configError: config.error,
  };
}

/**
 * A receipt per gate, for problems whose checkpoints grade behaviour rather
 * than a value the participant can go and read.
 *
 * The whole family after onboarding is like that: "the search endpoint returns
 * what the spec says" has no answer written anywhere, so the app has to be the
 * one that says it happened. A token that appears only while its gate is true
 * makes the submission a receipt for measured behaviour instead of a claim —
 * the same rule as `readyToken`, one gate at a time.
 *
 * Opt-in (`gateTokens: true`) so onboarding's `/posture`, whose answers really
 * are displayed on the board and in the log, does not grow a field that would
 * hand out three of its four answers at once.
 */
function tokensFor(state) {
  const tokens = {};
  for (const [name, ok] of Object.entries(state)) {
    tokens[name] = ok ? gateToken(name) : null;
  }
  return tokens;
}
