/**
 * Reading back what `world.mjs` `recordLogs` wrote (Issue 470).
 *
 * There is exactly one write path (`recordLogs`, gated on `observability.logs` at the
 * tick the event happened) and this is its only reader. Nothing here can make an
 * unstructured run look structured after the fact, because the shape was decided at
 * write time — `{ raw: string }` or the structured object — and query only filters,
 * never re-renders one as the other.
 */

export function queryLogs(world, { route, limit = 100 } = {}) {
  const entries = world.logs.filter((entry) => !route || entry.route === route);
  return entries.slice(Math.max(0, entries.length - limit));
}

export function renderLogLine(entry) {
  if ("raw" in entry) return entry.raw;
  const parts = [`tick=${entry.tick}`, `service=${entry.service}`, `severity=${entry.severity}`, `route=${entry.route}`, `outcome=${entry.outcome}`];
  if (entry.requestId) parts.push(`request_id=${entry.requestId}`);
  if (entry.authHeader) parts.push(entry.authHeader);
  return parts.join(" ");
}
