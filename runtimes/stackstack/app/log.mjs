/**
 * The app log, kept in a bounded ring so `GET /api/logs` can serve it and so a
 * long session cannot grow the container's memory without bound.
 *
 * Every line also goes to stdout, so `docker compose logs` and `/api/logs` show
 * the same text. A learner who reaches for either one finds the same evidence —
 * which is the point of the onboarding step that sends them looking.
 */

const MAX_LINES = 500;

/**
 * The boot lines are never evicted.
 *
 * They carry what a problem's log is *for* — the onboarding checkpoint reads the
 * boot-check value out of them — and the ring is otherwise driven by request
 * traffic, so a participant who sends a few hundred bad requests would push the
 * only line they needed out of the window. Docker's own log still has it, but an
 * app that loses its own boot record under load is a trap, not a lesson.
 */
const PROLOGUE_LINES = 8;

/** @type {{ at: string, level: string, message: string }[]} */
const prologue = [];

/** @type {{ at: string, level: string, message: string }[]} */
const lines = [];

const clock = () => new Date().toISOString();

export function log(level, message) {
  const entry = { at: clock(), level, message };
  if (prologue.length < PROLOGUE_LINES) prologue.push(entry);
  else {
    lines.push(entry);
    if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  }
  console.log(`${entry.at} ${level} ${message}`);
  return entry;
}

/**
 * Newest last, so reading top to bottom reads forwards in time. The pinned boot
 * lines always come first, whatever the limit.
 */
export function recentLines(limit = 100) {
  const tail = Math.max(1, Math.min(limit, MAX_LINES));
  return [...prologue, ...lines.slice(-tail)];
}
