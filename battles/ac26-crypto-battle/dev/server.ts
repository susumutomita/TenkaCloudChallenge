/**
 * Issue #644: `bun run dev` — the local development harness's HTTP server.
 *
 * Serves the REAL `../portal/*.tsx` slot components against the REAL
 * `../game/src` reducer, with no AWS credentials, no network calls, and no
 * deploy. What it exists for is the loop:
 *
 *     edit a portal component -> reload -> LEAK -> look at the Ledger -> edit
 *
 * in seconds rather than through a CloudFormation round trip.
 *
 * NOT A TRUST BOUNDARY. State lives in this process's memory and is fully
 * visible to whoever runs it; there is no authentication, and `?team=` is taken
 * at face value. Nothing here produces an official score. See README.md.
 *
 * The bundle is rebuilt on every request for `/app.js`, so a save-and-reload is
 * the whole edit cycle — no watcher, no dev-server cache to get stale. A cold
 * bundle costs well under a second, which is far cheaper than the class of
 * confusion a stale bundle causes.
 */

import { buildScenario, type Scenario, SCENARIO_IDS, type ScenarioId } from "./scenarios.ts";
import { readProjection, submitOp } from "./host.ts";
import type { CryptoBattleOp } from "../game/src/types.ts";

const PORT = Number(Bun.env.PORT ?? 5644);
const HERE = new URL(".", import.meta.url).pathname;

/**
 * The harness's clock.
 *
 * Paused by default, and that is the important part: a UI author wants the
 * board to hold still while they read it, and a paused clock makes every reload
 * of a scenario byte-identical. `running` turns it into a live match for
 * checking countdowns and phase transitions.
 */
interface Clock {
  /** Scenario time (ms since match start) at the last pause or resume. */
  baseMs: number;
  /** Wall clock at the last resume; null while paused. */
  resumedAtWallMs: number | null;
}

interface Session {
  scenarioId: ScenarioId;
  scenario: Scenario;
  clock: Clock;
}

function loadScenario(scenarioId: ScenarioId): Session {
  const scenario = buildScenario(scenarioId);
  return {
    scenarioId,
    scenario,
    clock: { baseMs: scenario.nowMs, resumedAtWallMs: null },
  };
}

let session: Session = loadScenario("fresh");

function eventNowMs(clock: Clock): number {
  if (clock.resumedAtWallMs === null) return clock.baseMs;
  return clock.baseMs + (Date.now() - clock.resumedAtWallMs);
}

function freeze(clock: Clock): void {
  clock.baseMs = eventNowMs(clock);
  clock.resumedAtWallMs = null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * `?team=` names which of the two seats the browser is sitting in. It is
 * rejected rather than defaulted when unknown: a typo silently falling back to
 * `alpha` would show one seat's vault while the toolbar claimed the other, and
 * "the harness lied about whose vault that was" is the worst possible bug in a
 * tool whose whole job is showing what a team may see.
 */
function resolveTeam(url: URL): string | undefined {
  const team = url.searchParams.get("team") ?? undefined;
  if (!team) return undefined;
  return session.scenario.host.ctx.teamIds.includes(team) ? team : undefined;
}

function sessionPayload(): unknown {
  const clock = session.clock;
  return {
    scenarioId: session.scenarioId,
    scenarios: SCENARIO_IDS,
    teamIds: session.scenario.host.ctx.teamIds,
    eventId: session.scenario.host.ctx.eventId,
    nowMs: eventNowMs(clock),
    running: clock.resumedAtWallMs !== null,
    version: session.scenario.host.version,
  };
}

async function handleApi(request: Request, url: URL): Promise<Response> {
  switch (url.pathname) {
    case "/api/session":
      return json(sessionPayload());

    case "/api/scenario": {
      const body = (await request.json()) as { id?: string };
      const id = SCENARIO_IDS.find((candidate) => candidate === body.id);
      if (!id) return json({ error: "unknown_scenario" }, 400);
      session = loadScenario(id);
      return json(sessionPayload());
    }

    case "/api/clock": {
      const body = (await request.json()) as { advanceMs?: number; running?: boolean };
      const clock = session.clock;
      if (typeof body.advanceMs === "number" && Number.isFinite(body.advanceMs)) {
        freeze(clock);
        // Never rewind past the match start: a negative scenario time is not a
        // position the reducer's clock can be in, and `tick` would compute a
        // negative elapsed time from it.
        clock.baseMs = Math.max(0, clock.baseMs + body.advanceMs);
      }
      if (typeof body.running === "boolean") {
        if (body.running) {
          if (clock.resumedAtWallMs === null) clock.resumedAtWallMs = Date.now();
        } else {
          freeze(clock);
        }
      }
      return json(sessionPayload());
    }

    case "/api/projection": {
      const team = resolveTeam(url);
      if (!team) return json({ kind: "unauthorized" });
      return json(readProjection(session.scenario.host, team, eventNowMs(session.clock)));
    }

    case "/api/op": {
      const team = resolveTeam(url);
      if (!team) return json({ kind: "unauthorized" });
      const op = (await request.json()) as CryptoBattleOp;
      return json(submitOp(session.scenario.host, team, op, eventNowMs(session.clock)));
    }

    default:
      return json({ error: "not_found" }, 404);
  }
}

/**
 * Forces every `react` / `react-dom` specifier in the bundle — this
 * directory's and `../portal/*.tsx`'s alike — onto the ONE copy installed
 * here.
 *
 * Without it the bundle ends up with two Reacts: `app.tsx` resolves through
 * `./tsconfig.json`, while `../portal/*.tsx` resolves through
 * `../portal/tsconfig.json`, whose `paths` deliberately point at
 * `../game/node_modules` (it exists to make `bun test` work from `../game`).
 * Two Reacts means two independent hook dispatchers, and the page dies on
 * mount with "Invalid hook call … more than one copy of React" — a failure
 * that looks like a bug in whichever component happened to render first.
 *
 * Resolving from THIS directory (rather than `../game/node_modules`) keeps the
 * harness's dependency story in its own `package.json`, which is the point of
 * it having one.
 */
const singleReactCopy: import("bun").BunPlugin = {
  name: "ac26-dev-single-react",
  setup(build) {
    build.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, (args) => ({
      path: Bun.resolveSync(args.path, HERE),
    }));
  },
};

async function bundleClient(): Promise<Response> {
  const built = await Bun.build({
    entrypoints: [`${HERE}app.tsx`],
    target: "browser",
    minify: false,
    plugins: [singleReactCopy],
  });
  if (!built.success) {
    // Surface the real bundler diagnostics as the response body. Serving a
    // blank or stale script here would look like a component bug and send the
    // author hunting in the wrong file.
    const detail = built.logs.map((log) => String(log)).join("\n");
    return new Response(`console.error(${JSON.stringify(`bundle failed:\n${detail}`)});`, {
      status: 500,
      headers: { "content-type": "application/javascript; charset=utf-8" },
    });
  }
  const [artifact] = built.outputs;
  if (!artifact) return new Response("console.error('bundle produced no output');", { status: 500 });
  return new Response(await artifact.text(), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, url);
    if (url.pathname === "/app.js") return bundleClient();
    return new Response(Bun.file(`${HERE}index.html`), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  },
});

console.log(`ac26-crypto-battle dev harness: http://localhost:${server.port}`);
console.log("Local preview only. Not the competition trust boundary; no score here is official.");
