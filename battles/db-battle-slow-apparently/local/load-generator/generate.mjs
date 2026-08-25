/**
 * db-battle-slow-apparently — load generator.
 *
 * Stands in for "production traffic". Fires a steady mix of writes (new
 * orders) and reads (recent orders) against the order API for the whole
 * container lifetime, so `GET /metrics` always has real, continuous samples
 * to report — there is no synthetic traffic model here, just genuine HTTP
 * calls whose real latency the api records.
 */
const API_URL = process.env.API_URL ?? "http://api:3000";
const REQUESTS_PER_SECOND = Number(process.env.REQUESTS_PER_SECOND ?? 12);
const INTERVAL_MS = Math.max(20, Math.round(1000 / REQUESTS_PER_SECOND));

async function fireOne() {
  const isWrite = Math.random() < 0.3;
  try {
    if (isWrite) {
      await fetch(`${API_URL}/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(10_000),
      });
    } else {
      await fetch(`${API_URL}/orders/recent`, { signal: AbortSignal.timeout(10_000) });
    }
  } catch {
    // A timed-out or refused request IS a data point (the api's own /metrics
    // records it as an error on its side); the generator itself just keeps
    // going rather than crashing the container.
  }
}

async function loop() {
  // Give the api container a moment to come up (compose's depends_on already
  // waits for its healthcheck, this is defense in depth).
  await new Promise((r) => setTimeout(r, 2000));
  for (;;) {
    fireOne();
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

loop();
