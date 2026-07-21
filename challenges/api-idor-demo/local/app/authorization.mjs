/**
 * Pure, DB-free authorization + response-shaping helpers for the api-idor-demo
 * profile API.
 *
 * These are kept in their own module (no `node:sqlite`, no `node:http`, no
 * side effects) so they can be unit tested under `bun test` — `server.mjs`
 * itself cannot be imported there because Bun does not implement `node:sqlite`
 * and the module opens a database + starts listening as soon as it loads.
 *
 * Two intentionally different response shapes live here, and that difference
 * is the point:
 *   - `profileOf` is the FULL record (incl. the private `secret_note`). It
 *     backs the deliberately-vulnerable `/api/profile` and `/api/profile/:id`
 *     routes in server.mjs — never change its shape, that over-exposure is
 *     the bug the challenge teaches.
 *   - `listProfilesFor` backs the new `/api/profiles` list route and is a
 *     correctly-designed "list objects I can access" endpoint: it enforces
 *     an ownership/role check AND only ever returns the least-privilege
 *     summary shape (never `secret_note`). It must never become a second,
 *     unintended IDOR — that would hand the flag to a guest without the
 *     singular endpoint's bug ever coming into play.
 */

/**
 * Full record shape. Used ONLY by the intentionally-vulnerable single-object
 * routes — includes the private note on purpose.
 */
export function profileOf(row) {
  return { id: row.id, username: row.username, role: row.role, note: row.secret_note };
}

/** Least-privilege summary shape for list responses: never includes secret_note. */
function profileSummaryOf(row) {
  return { id: row.id, username: row.username, role: row.role };
}

/**
 * Authorization model for `GET /api/profiles`:
 *   - an ordinary caller sees only their own record (ownership check)
 *   - an admin caller sees every record (role check) — still summary-only
 *
 * Either way the response is the least-privilege summary shape, so this list
 * route cannot leak `secret_note` (and therefore not the flag) to anyone,
 * regardless of role. It exists purely so a caller can discover the shape of
 * a profile object (and that `id` is a small integer worth trying against
 * `/api/profile/:id`) without a second authorization bug doing the work for
 * them.
 */
export function listProfilesFor(rows, caller) {
  const visible = caller.role === "admin" ? rows : rows.filter((row) => row.id === caller.id);
  return visible.map(profileSummaryOf);
}
