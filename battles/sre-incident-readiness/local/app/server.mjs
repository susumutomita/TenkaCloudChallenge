/**
 * The Workbench, the telemetry surface, and the verifier — three concerns, two ports
 * (Issue 470).
 *
 *   :8080  Browser Workbench, `/metrics`, `/orders` (a connectivity check — the traffic
 *          that is actually scored is the continuous simulated load `step()` generates
 *          every tick, matching the issue's "hidden load-generator" ground truth; a
 *          participant's own request is not required to make the incident happen).
 *   :8081  the loopback verifier, exactly like `agent-approval-gameday`.
 *
 * `tick()` is driven by `setInterval` in production and by a plain loop in tests — see
 * `world.mjs` file header for why that split is safe.
 */

import { createServer } from "node:http";
import { createWorld, step, currentPhase, applyAction } from "./world.mjs";
import { validateResilience, validateObservability, validateAlertRule } from "./config-store.mjs";
import { declare, withdrawDeclaration, assignRole, addFact, addHypothesis, addUpdate, attemptResolve } from "./incident.mjs";
import { CHECKPOINTS, posture } from "./scoring.mjs";
import { renderPrometheus } from "./metrics.mjs";
import {
  alertsPage,
  buildPage,
  dashboardPage,
  evidencePage,
  incidentPage,
  logsPage,
  scoreboardPage,
  telemetryPage,
} from "./workbench.mjs";

const TICK_MS = Number(process.env.SRE_TICK_MS ?? 1000);
const DURATION_MODE = process.env.SRE_DURATION_MODE === "120" ? "120" : "90";
const PHASE_OVERRIDES = {
  build: envTicks("SRE_BUILD_TICKS"),
  calibrate: envTicks("SRE_CALIBRATE_TICKS"),
  incident: envTicks("SRE_INCIDENT_TICKS"),
  stabilize: envTicks("SRE_STABILIZE_TICKS"),
};

function envTicks(name) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

export function createSession(seed, options = {}) {
  const world = createWorld(seed, {
    durationMode: options.durationMode ?? DURATION_MODE,
    phaseOverrides: options.phaseOverrides ?? PHASE_OVERRIDES,
  });
  return { seed, world, resetCount: 0 };
}

export function resetSession(session) {
  session.resetCount += 1;
  session.world = createWorld(`${session.seed}:reset:${session.resetCount}`, {
    durationMode: session.world.durationMode,
    phaseOverrides: PHASE_OVERRIDES,
  });
  return session.world;
}

function send(response, status, contentType, body) {
  response.writeHead(status, { "content-type": contentType, "x-content-type-options": "nosniff" });
  response.end(body);
}
const sendJson = (response, status, payload) => send(response, status, "application/json; charset=utf-8", JSON.stringify(payload));
const sendHtml = (response, status, body) => send(response, status, "text/html; charset=utf-8", body);
const sendText = (response, status, body) => send(response, status, "text/plain; version=0.0.4; charset=utf-8", body);

async function readBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(request) {
  const text = await readBody(request);
  if (text === null) return null;
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readForm(request) {
  const text = await readBody(request);
  if (text === null) return null;
  return new URLSearchParams(text);
}

function requestUrl(target) {
  try {
    return new URL(String(target ?? "/").replace(/^\/+/, "/"), "http://placeholder.invalid");
  } catch {
    return new URL("/__malformed_request__", "http://placeholder.invalid");
  }
}

const linesOf = (value) =>
  String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
const csvOf = (value) =>
  String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

function notice(kind, text) {
  return `<p class="${kind === "error" ? "warn" : "ok"}">${text}</p>`;
}

export function createGatewayServer(session) {
  return createServer(async (request, response) => {
    const url = requestUrl(request.url);
    const { method } = request;
    const path = url.pathname;
    const world = () => session.world;

    if (method === "GET" && path === "/healthz") return sendJson(response, 200, { status: "ok" });

    if (method === "GET" && (path === "/" || path === "/dashboard")) return sendHtml(response, 200, dashboardPage(world()));
    if (method === "GET" && path === "/build") return sendHtml(response, 200, buildPage(world()));
    if (method === "GET" && path === "/alerts") return sendHtml(response, 200, alertsPage(world()));
    if (method === "GET" && path === "/telemetry") return sendHtml(response, 200, telemetryPage(world()));
    if (method === "GET" && path === "/logs") return sendHtml(response, 200, logsPage(world()));
    if (method === "GET" && path === "/evidence") return sendHtml(response, 200, evidencePage(world()));
    if (method === "GET" && path === "/incident") return sendHtml(response, 200, incidentPage(world()));
    if (method === "GET" && path === "/scoreboard") return sendHtml(response, 200, scoreboardPage(world()));
    if (method === "GET" && path === "/metrics") return sendText(response, 200, renderPrometheus(world()));
    if (method === "GET" && path === "/posture") return sendJson(response, 200, posture(world()));

    if (method === "POST" && path === "/orders") {
      // A connectivity check, not graded traffic — see file header.
      return sendJson(response, 200, {
        sessionId: session.seed,
        tick: world().tick,
        phase: currentPhase(world()),
        message: "order accepted (this call is a connectivity check; scored traffic is continuous and automatic)",
      });
    }

    if (method === "POST" && path === "/reset") {
      resetSession(session);
      return sendHtml(response, 200, dashboardPage(session.world, notice("ok", "リセットしました。新しい試行が始まります。")));
    }

    if (method === "POST" && path === "/build/resilience") {
      const form = await readForm(request);
      if (!form) return sendJson(response, 400, { error: "invalid_form" });
      const candidate = {
        timeoutMs: Number(form.get("timeoutMs")),
        maxRetries: Number(form.get("maxRetries")),
        circuitBreaker: {
          enabled: form.get("cbEnabled") === "on",
          failureThreshold: Number(form.get("cbFailureThreshold")),
          cooldownMs: Number(form.get("cbCooldownMs")),
        },
      };
      const result = validateResilience(candidate);
      if (result.errors) return sendHtml(response, 200, buildPage(world(), notice("error", `保存できませんでした: ${result.errors.join(", ")}`)));
      world().config.resilience = result.value;
      return sendHtml(response, 200, buildPage(world(), notice("ok", "resilience 設定を保存しました。")));
    }

    if (method === "POST" && path === "/build/observability") {
      const form = await readForm(request);
      if (!form) return sendJson(response, 400, { error: "invalid_form" });
      const candidate = {
        redMetrics: { byRoute: form.get("byRoute") === "on", byStatus: form.get("byStatus") === "on" },
        dependencyMetrics: form.get("dependencyMetrics") === "on",
        saturation: { poolGauge: form.get("poolGauge") === "on" },
        healthCheck: { mode: form.get("healthMode") === "synthetic" ? "synthetic" : "liveness" },
        logs: {
          structured: form.get("logsStructured") === "on",
          includeRequestId: form.get("logsRequestId") === "on",
          includeAuthHeader: form.get("logsAuthHeader") === "on",
        },
      };
      const result = validateObservability(candidate);
      if (result.errors) return sendHtml(response, 200, buildPage(world(), notice("error", `保存できませんでした: ${result.errors.join(", ")}`)));
      world().config.observability = result.value;
      return sendHtml(response, 200, buildPage(world(), notice("ok", "observability 設定を保存しました。")));
    }

    if (method === "POST" && path === "/alerts/add") {
      const form = await readForm(request);
      if (!form) return sendJson(response, 400, { error: "invalid_form" });
      const candidate = {
        id: form.get("id"),
        metric: form.get("metric"),
        route: form.get("route") || undefined,
        op: form.get("op"),
        threshold: Number(form.get("threshold")),
        forTicks: Number(form.get("forTicks")),
      };
      const result = validateAlertRule(candidate);
      if (result.errors) return sendHtml(response, 200, alertsPage(world(), notice("error", `追加できませんでした: ${result.errors.join(", ")}`)));
      if (world().config.alerts.rules.some((rule) => rule.id === result.value.id)) {
        return sendHtml(response, 200, alertsPage(world(), notice("error", "同じ id のルールが既にあります。")));
      }
      if (world().config.alerts.rules.length >= 10) {
        return sendHtml(response, 200, alertsPage(world(), notice("error", "ルールは最大 10 件です。")));
      }
      // Stamped so `alertCaughtIncident` can tell monitoring that was built in
      // advance from monitoring added once the incident was already visible. The
      // checkpoint is about readiness, and a rule written after the fact
      // demonstrates none.
      world().config.alerts.rules.push({ ...result.value, createdAtTick: world().tick });
      return sendHtml(response, 200, alertsPage(world(), notice("ok", "ルールを追加しました。")));
    }

    if (method === "POST" && path === "/alerts/remove") {
      const form = await readForm(request);
      if (!form) return sendJson(response, 400, { error: "invalid_form" });
      const id = form.get("id");
      world().config.alerts.rules = world().config.alerts.rules.filter((rule) => rule.id !== id);
      delete world().alerts.states[id];
      return sendHtml(response, 200, alertsPage(world(), notice("ok", "ルールを削除しました。")));
    }

    if (method === "POST" && path === "/incident/declare") {
      const form = await readForm(request);
      if (!form) return sendJson(response, 400, { error: "invalid_form" });
      const result = declare(world(), world().tick, { severity: form.get("severity") });
      return sendHtml(response, 200, incidentPage(world(), result.ok ? notice("ok", "宣言しました。") : notice("error", `宣言できませんでした: ${result.error}`)));
    }

    if (method === "POST" && path === "/incident/withdraw") {
      const result = withdrawDeclaration(world(), world().tick);
      return sendHtml(
        response,
        200,
        incidentPage(
          world(),
          result.ok
            ? notice("ok", "宣言を取り下げました。あらためて declare できます。")
            : notice("error", `取り下げできませんでした: ${result.error}`),
        ),
      );
    }

    if (method === "POST" && path === "/incident/assign") {
      const form = await readForm(request);
      if (!form) return sendJson(response, 400, { error: "invalid_form" });
      const result = assignRole(world(), { role: form.get("role"), member: form.get("member") });
      return sendHtml(response, 200, incidentPage(world(), result.ok ? notice("ok", "割り当てました。") : notice("error", `割り当てできませんでした: ${result.error}`)));
    }

    if (method === "POST" && path === "/incident/fact") {
      const form = await readForm(request);
      if (!form) return sendJson(response, 400, { error: "invalid_form" });
      const result = addFact(world(), world().tick, { text: form.get("text"), evidenceIds: csvOf(form.get("evidenceIds")) });
      return sendHtml(response, 200, incidentPage(world(), result.ok ? notice("ok", "記録しました。") : notice("error", `記録できませんでした: ${result.error}`)));
    }

    if (method === "POST" && path === "/incident/hypothesis") {
      const form = await readForm(request);
      if (!form) return sendJson(response, 400, { error: "invalid_form" });
      const result = addHypothesis(world(), world().tick, {
        dependency: form.get("dependency"),
        mechanism: form.get("mechanism"),
        evidenceIds: csvOf(form.get("evidenceIds")),
      });
      const penaltyNote = result.penaltyPoints < 0 ? `（当てずっぽうの提出として ${result.penaltyPoints} 点を記録しました）` : "";
      return sendHtml(
        response,
        200,
        incidentPage(
          world(),
          result.accepted
            ? notice("ok", "hypothesis を受理しました。")
            : notice("error", `hypothesis は不採用でした: ${result.reason}${penaltyNote}`),
        ),
      );
    }

    if (method === "POST" && path === "/incident/action") {
      const form = await readForm(request);
      if (!form) return sendJson(response, 400, { error: "invalid_form" });
      const result = applyAction(world(), world().tick, { type: form.get("type") });
      return sendHtml(response, 200, incidentPage(world(), result.ok ? notice("ok", "実行しました。") : notice("error", `実行できませんでした: ${result.error}`)));
    }

    if (method === "POST" && path === "/incident/update") {
      const form = await readForm(request);
      if (!form) return sendJson(response, 400, { error: "invalid_form" });
      const result = addUpdate(world(), world().tick, {
        customerImpact: form.get("customerImpact"),
        confirmedFacts: linesOf(form.get("confirmedFacts")),
        activeHypothesis: form.get("activeHypothesis"),
        owner: form.get("owner"),
        nextUpdateInTicks: Number(form.get("nextUpdateInTicks")),
      });
      return sendHtml(response, 200, incidentPage(world(), result.ok ? notice("ok", "update を投稿しました。") : notice("error", `投稿できませんでした: ${result.error}`)));
    }

    if (method === "POST" && path === "/incident/resolve") {
      const result = attemptResolve(world(), world().tick);
      return sendHtml(
        response,
        200,
        incidentPage(world(), result.ok ? notice("ok", "resolve しました。") : notice("error", `resolve できませんでした: ${result.reasons.join(", ")}`)),
      );
    }

    return sendJson(response, 404, { error: "not_found" });
  });
}

export function createVerifyServer(session) {
  return createServer(async (request, response) => {
    if (request.method === "GET" && (request.url ?? "/") === "/healthz") {
      return sendJson(response, 200, { status: "ok" });
    }
    if (request.method !== "POST" || (request.url ?? "/") !== "/verify") {
      return sendJson(response, 404, { error: "not_found" });
    }
    const body = await readJson(request);
    if (!body) return sendJson(response, 400, { error: "invalid_json" });
    const checkpointId = typeof body.checkpointId === "string" ? body.checkpointId : "";
    if (!CHECKPOINTS.includes(checkpointId)) return sendJson(response, 400, { error: "unknown_checkpoint" });
    const submission = typeof body.submission === "string" ? body.submission.trim() : "";
    if (submission.length < 1 || submission.length > 200) {
      return sendJson(response, 400, { checkpointId, error: "invalid_submission" });
    }
    const live = posture(session.world);
    const expected = live.tokens[checkpointId];
    const correct = expected !== null && submission === expected;
    return sendJson(response, 200, {
      checkpointId,
      correct,
      message: correct ? "Checkpoint cleared." : expected === null ? "この checkpoint の gate はいま満たされていません。" : "その値はこの checkpoint の受領証ではありません。",
    });
  });
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const session = createSession(process.env.FLAG_SEED ?? "local-dev-seed");
  setInterval(() => step(session.world), TICK_MS).unref?.();
  createGatewayServer(session).listen(8080, "0.0.0.0", () => console.log("workbench on :8080"));
  createVerifyServer(session).listen(8081, "0.0.0.0", () => console.log("verify on :8081"));
}
