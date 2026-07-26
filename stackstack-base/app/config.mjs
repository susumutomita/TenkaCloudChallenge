import { readFileSync } from "node:fs";
import { log } from "./log.mjs";

/**
 * The app's runtime configuration, read from a file the participant owns.
 *
 * The file is bind-mounted read-only from their checkout, so editing it is a
 * real edit to a real file — not a toggle in a UI the problem controls. It is
 * re-read on every request rather than cached at boot, so a saved edit takes
 * effect immediately: an onboarding step must not hide behind "now restart the
 * container".
 *
 * A missing or malformed file is NOT silently replaced by defaults. The values
 * fall back so the app still answers (a participant who breaks the JSON must
 * still be able to reach `/healthz` to find out why), but the failure is
 * reported on `/healthz`, written to the log, and visible in `/posture`.
 */

const CONFIG_PATH = process.env.APP_CONFIG ?? "/app/config/app.json";

const DEFAULTS = {
  boardTitle: "board",
  acceptingPosts: false,
};

/**
 * Only known keys are adopted, and only at the declared type.
 *
 * A key that is missing, misspelled, or the wrong type is reported rather than
 * quietly ignored. `acceptingPost: true` and `"acceptingPosts": "true"` are the
 * two edits a participant actually makes by accident, and both would otherwise
 * leave the board closed with nothing anywhere saying why.
 */
function coerce(raw) {
  const problems = [];
  const value = { ...DEFAULTS };
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    if (!(key in raw)) {
      problems.push(`${key} is missing`);
      continue;
    }
    if (typeof raw[key] !== typeof fallback) {
      problems.push(`${key} must be ${typeof fallback}, got ${typeof raw[key]}`);
      continue;
    }
    value[key] = raw[key];
  }
  for (const key of Object.keys(raw)) {
    if (!(key in DEFAULTS)) problems.push(`${key} is not a setting this app reads`);
  }
  return { value, problems };
}

let lastError = null;

/**
 * Read the config as it is on disk right now.
 * @returns {{ ok: boolean, value: typeof DEFAULTS, error: string | null }}
 */
export function readConfig(path = CONFIG_PATH) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return report(`cannot read ${path}: ${error.code ?? error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return report(`${path} is not valid JSON: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return report(`${path} must contain a JSON object`);
  }
  const { value, problems } = coerce(parsed);
  if (problems.length > 0) return report(problems.join("; "), value);
  if (lastError !== null) {
    lastError = null;
    log("info", "config reloaded cleanly");
  }
  return { ok: true, value, error: null };
}

/** Log a config failure once per distinct message, so a reload loop cannot flood the ring. */
function report(error, value = { ...DEFAULTS }) {
  if (lastError !== error) {
    lastError = error;
    log("error", `config error: ${error}`);
  }
  return { ok: false, value, error };
}

export const CONFIG_FILE = CONFIG_PATH;
