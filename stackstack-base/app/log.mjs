/**
 * The app log, kept in a bounded ring so `GET /api/logs` can serve it and so a
 * long session cannot grow the container's memory without bound.
 *
 * Every line also goes to stdout, so `docker compose logs` and `/api/logs` show
 * the same text. A learner who reaches for either one finds the same evidence —
 * which is the point of the onboarding step that sends them looking.
 */

const MAX_LINES = 500;

/** @type {{ at: string, level: string, message: string }[]} */
const lines = [];

let clock = () => new Date().toISOString();

/** Swap the clock in tests so log assertions are not time-dependent. */
export function setLogClock(next) {
  clock = next;
}

export function log(level, message) {
  const entry = { at: clock(), level, message };
  lines.push(entry);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  console.log(`${entry.at} ${level} ${message}`);
  return entry;
}

/** Newest last, so reading top to bottom reads forwards in time. */
export function recentLines(limit = 100) {
  return lines.slice(-Math.max(1, Math.min(limit, MAX_LINES)));
}

export function clearLog() {
  lines.length = 0;
}
