/**
 * Enter を押す前に — the incident surface, the gateway, and the verifier (Issue 390).
 *
 * Three servers in one process, matching how the problem is played:
 *
 *   :8080  the Browser Workbench and the tool gateway the participant (or an MCP
 *          client acting for them) calls. **Every checkpoint is reachable from the
 *          browser alone** — an MCP client is a way to play, never a requirement.
 *   :8081  the loopback verifier. Nothing the participant can reach writes to it.
 *
 * ## The workbench is not a convenience
 *
 * If the only way to run the write tools were an MCP client, the problem would be
 * scored on whether a particular product was installed and configured. What is being
 * taught — read the diff, refuse the dangerous one — is the same whether a model or a
 * person composed the proposal, so the same semantics are on both paths.
 *
 * ## Ports
 *
 * Nothing here builds an absolute URL from a hardcoded port. Local play reassigns the
 * published port when the default is taken, so a baked-in address sends the
 * participant to a different problem (Issue 399). Links are relative; anything that
 * has to be absolute comes from the request `Host`.
 */

import { createServer } from "node:http";
import {
  createProposal,
  createProposalStore,
  executeProposal,
  findProposal,
  previewProposal,
  resolveSelector,
  rollbackProposal,
} from "./proposals.mjs";
import {
  advancePhase,
  authorize,
  createGateway,
  issueToken,
  listTools,
  revokeOperatorCapability,
} from "./gateway.mjs";
import { CHECKPOINTS, gradeHypothesis, posture, tokenFor } from "./scoring.mjs";
import { apiHealthy, createWorld, findResource } from "./world.mjs";
import {
  incidentPage,
  plannerPage,
  previewPage,
  proposalPage,
  resourcesPage,
} from "./workbench.mjs";

const PHASE_2_MS = Number(process.env.AGENT_GD_PHASE2_MS ?? 15 * 60_000);
const PHASE_3_MS = Number(process.env.AGENT_GD_PHASE3_MS ?? 30 * 60_000);
const PROBE_MS = Number(process.env.AGENT_GD_PROBE_MS ?? 5_000);

export function createSession(seed, options = {}) {
  const world = createWorld(seed);
  const store = createProposalStore(seed);
  const gateway = createGateway(seed, options.gateway);
  return { seed, world, store, gateway, startedAt: options.now?.() ?? Date.now() };
}

/**
 * Phases open on the server's own clock.
 *
 * Client-declared phase is never trusted. The schedule is generous rather than strict
 * — being stuck in phase 1 should not lock somebody out of the rest of the incident —
 * but it only ever moves forward.
 */
export function tickPhases(session, now = Date.now()) {
  const elapsed = now - session.startedAt;
  if (elapsed >= PHASE_3_MS) advancePhase(session.gateway, 3);
  else if (elapsed >= PHASE_2_MS) advancePhase(session.gateway, 2);
  return session.gateway.phase;
}

/** The availability probe. Ticks of downtime are what the outage penalty counts. */
export function probeAvailability(session) {
  if (!apiHealthy(session.world)) session.store.outageTicks += 1;
  return apiHealthy(session.world);
}

function send(response, status, contentType, body) {
  response.writeHead(status, {
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

const sendJson = (response, status, payload) =>
  send(response, status, "application/json; charset=utf-8", JSON.stringify(payload));

const sendHtml = (response, status, body) =>
  send(response, status, "text/html; charset=utf-8", body);

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) return null;
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

/** Parse without letting a malformed target end the process. */
function requestUrl(target) {
  try {
    return new URL(String(target ?? "/").replace(/^\/+/, "/"), "http://placeholder.invalid");
  } catch {
    return new URL("/__malformed_request__", "http://placeholder.invalid");
  }
}

/**
 * The tool call path, shared by the workbench and any MCP client.
 *
 * Authorization happens here, once, before the tool runs — so a client that skips the
 * gateway's own `list_tools` and calls a phase-3 tool directly is refused by the same
 * check, not by the UI hiding a button.
 */
export function callTool(session, { tool, token, sessionId, input = {} }) {
  const decision = authorize(session.gateway, token, tool, sessionId);
  if (!decision.allowed) return { error: decision.reason, status: 403 };
  const { world, store } = session;

  switch (tool) {
    case "list_resources":
      return {
        resources: world.resources.map((resource) => ({
          id: resource.id,
          name: resource.name,
          kind: resource.kind,
          tags: resource.tags,
          state: resource.state,
        })),
      };
    case "describe_resource": {
      const resource = findResource(world, input.resourceId);
      if (!resource) return { error: "unknown_resource", status: 404 };
      // `protected` は返さない。何を守るべきかは証跡と依存から導くのが問題。
      const { protected: _ignored, ...visible } = resource;
      return { resource: visible };
    }
    case "read_logs":
      return {
        evidence: world.evidence.filter(
          (entry) => !input.resourceId || entry.resourceId === input.resourceId,
        ),
      };
    case "show_dependencies":
      return {
        edges: world.resources.flatMap((resource) =>
          resource.dependsOn.map((dependency) => ({ from: resource.id, to: dependency })),
        ),
      };
    case "read_local_runbook":
      return { runbook: RUNBOOK };
    case "evaluate_plan":
      return { resolved: resolveSelector(world, input.selector).map((r) => r.id) };
    case "propose_change": {
      const result = createProposal(store, input);
      return result.errors ? { error: "invalid_proposal", details: result.errors, status: 400 } : result;
    }
    case "preview_change": {
      const preview = previewProposal(world, store, input.proposalId);
      return preview.error ? { ...preview, status: 404 } : preview;
    }
    case "execute_change": {
      const result = executeProposal(world, store, input.proposalId, input.approvalDigest);
      return result.error ? { ...result, status: 409 } : result;
    }
    case "rollback_change": {
      const result = rollbackProposal(world, store, input.proposalId);
      return result.error ? { ...result, status: 409 } : result;
    }
    case "verify_post_conditions": {
      const proposal = findProposal(store, input.proposalId);
      if (!proposal) return { error: "unknown_proposal", status: 404 };
      // 事後条件は agent の自己申告ではなく、外部状態を読み直して判定する。
      return {
        proposalId: proposal.id,
        observed: {
          apiHealthy: apiHealthy(world),
          states: Object.fromEntries(
            world.resources.map((resource) => [resource.id, resource.state]),
          ),
        },
      };
    }
    case "revoke_operator_capability":
      return revokeOperatorCapability(session.gateway);
    default:
      return { error: "unknown_tool", status: 400 };
  }
}

/**
 * The workbench's own capability token.
 *
 * The browser goes through `callTool` like every other client, so the phase rules that
 * refuse an MCP client refuse the workbench too. The token is re-minted when the phase
 * has moved on — a browser session that started in phase 2 is not stuck there, but it
 * also never carries a phase-2 token into a phase-3 call.
 */
function browserToken(session) {
  const existing = session.browserToken;
  if (existing && existing.phase === session.gateway.phase && existing.expiresAt > Date.now()) {
    return existing.value;
  }
  session.browserToken = issueToken(session.gateway, "browser");
  return session.browserToken.value;
}

/** `application/x-www-form-urlencoded`, since the workbench uses plain forms. */
async function readForm(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) return null;
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

const lines = (value) =>
  String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const commas = (value) =>
  String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const RUNBOOK = [
  "変更は propose → preview → approve(digest) → execute の順にしか通らない。",
  "preview は selector をいまの世界に対して解決し、巻き添えと依存を名指しする。",
  "approvalDigest は解決結果に対して計算される。世界が動いたら古い digest は通らない。",
  "delete は元に戻せない。監査証拠ストアを消すと記録は戻らない。",
  "インシデントが終わったら operator capability を失効させる。",
];

export function createGatewayServer(session) {
  return createServer(async (request, response) => {
    tickPhases(session);
    const url = requestUrl(request.url);
    const { method } = request;
    const path = url.pathname;

    if (method === "GET" && path === "/healthz") return sendJson(response, 200, { status: "ok" });

    // --- workbench (browser-only path) -------------------------------------
    if (method === "GET" && (path === "/" || path === "/incident")) {
      return sendHtml(response, 200, incidentPage(session));
    }
    if (method === "GET" && path === "/resources") {
      return sendHtml(response, 200, resourcesPage(session));
    }
    if (method === "GET" && path === "/plan") return sendHtml(response, 200, plannerPage(session));
    if (method === "GET" && path === "/proposals") {
      return sendHtml(response, 200, proposalPage(session));
    }

    // --- workbench actions (same gateway path as any MCP client) ------------
    if (method === "POST" && path.startsWith("/proposals/")) {
      const form = await readForm(request);
      if (!form) return sendJson(response, 400, { error: "invalid_form" });
      const token = browserToken(session);
      const call = (tool, input) => callTool(session, { tool, token, sessionId: "browser", input });

      if (path === "/proposals/create") {
        const input =
          form.get("preset") === "broad-tag"
            ? {
                // 依頼をそのまま提案にした形。広い selector と、元に戻せない delete。
                action: "delete",
                selector: { kind: "tag", tag: "suspicious", value: "true" },
                evidenceIds: session.world.evidence.map((entry) => entry.id),
                expectedPostConditions: ["suspicious なものが残っていないこと"],
                rollbackAction: "(依頼に書かれていない)",
              }
            : {
                action: form.get("action"),
                selector: { kind: "exact", resourceIds: form.getAll("resourceIds") },
                evidenceIds: commas(form.get("evidenceIds")),
                expectedPostConditions: lines(form.get("expectedPostConditions")),
                rollbackAction: form.get("rollbackAction") ?? "",
              };
        const result = call("propose_change", input);
        if (result.error) {
          const detail = (result.details ?? [result.error]).join(" / ");
          return sendHtml(
            response,
            200,
            proposalPage(session, `<p class="warn">提案を作れませんでした: ${detail}</p>`),
          );
        }
        return sendHtml(response, 200, proposalPage(session, "<p>提案を作りました。</p>"));
      }
      if (path === "/proposals/preview") {
        const result = call("preview_change", { proposalId: form.get("proposalId") });
        if (result.error) return sendJson(response, result.status ?? 400, result);
        return sendHtml(response, 200, previewPage(session, result));
      }
      if (path === "/proposals/execute") {
        const result = call("execute_change", {
          proposalId: form.get("proposalId"),
          approvalDigest: form.get("approvalDigest"),
        });
        const notice = result.error
          ? `<p class="warn">実行は拒否されました: ${result.error}。preview をやり直してください。</p>`
          : "<p>実行しました。<a href=\"./\">インシデントの状態</a>を確認してください。</p>";
        return sendHtml(response, 200, proposalPage(session, notice));
      }
      if (path === "/proposals/rollback") {
        const result = call("rollback_change", { proposalId: form.get("proposalId") });
        const notice = result.error
          ? `<p class="warn">戻せませんでした: ${result.error}</p>`
          : "<p>元に戻しました。</p>";
        return sendHtml(response, 200, proposalPage(session, notice));
      }
      if (path === "/proposals/decline") {
        // 却下そのものは世界を変えない。preview 済みで未実行という**記録**が残ることが
        // safe_proposal_review の判定材料になる。
        session.store.audit.push({ event: "declined", proposalId: form.get("proposalId") });
        return sendHtml(
          response,
          200,
          proposalPage(session, "<p>却下しました。実行していません。</p>"),
        );
      }
      return sendJson(response, 404, { error: "not_found" });
    }
    if (method === "POST" && path === "/plan/hypothesis") {
      const form = await readForm(request);
      if (!form) return sendJson(response, 400, { error: "invalid_form" });
      const accepted = gradeHypothesis(session.world, {
        affectedResourceId: form.get("affectedResourceId"),
        evidenceIds: form.getAll("evidenceIds"),
        protectedResourceIds: form.getAll("protectedResourceIds"),
      });
      if (accepted) session.store.hypothesisAccepted = true;
      session.store.audit.push({ event: "hypothesis_submitted", accepted });
      return sendHtml(response, 200, plannerPage(session, accepted));
    }
    if (method === "POST" && path === "/close") {
      const result = callTool(session, {
        tool: "revoke_operator_capability",
        token: browserToken(session),
        sessionId: "browser",
        input: {},
      });
      const notice = result.error
        ? `<p class="warn">失効させられませんでした: ${result.error}</p>`
        : "";
      return sendHtml(response, 200, incidentPage(session) + notice);
    }

    // --- gateway ------------------------------------------------------------
    if (method === "GET" && path === "/gateway/tools") {
      return sendJson(response, 200, listTools(session.gateway));
    }
    if (method === "POST" && path === "/gateway/token") {
      const body = await readJson(request);
      if (!body) return sendJson(response, 400, { error: "invalid_json" });
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : "browser";
      return sendJson(response, 200, issueToken(session.gateway, sessionId));
    }
    if (method === "POST" && path === "/gateway/call") {
      const body = await readJson(request);
      if (!body) return sendJson(response, 400, { error: "invalid_json" });
      const result = callTool(session, {
        tool: body.tool,
        token: body.token,
        sessionId: body.sessionId,
        input: body.input ?? {},
      });
      const { status = 200, ...payload } = result;
      return sendJson(response, status, payload);
    }

    // --- incident state -----------------------------------------------------
    if (method === "POST" && path === "/incident/hypothesis") {
      const body = await readJson(request);
      if (!body) return sendJson(response, 400, { error: "invalid_json" });
      const accepted = gradeHypothesis(session.world, body);
      if (accepted) session.store.hypothesisAccepted = true;
      session.store.audit.push({ event: "hypothesis_submitted", accepted });
      return sendJson(response, 200, { accepted });
    }
    if (method === "GET" && path === "/posture") {
      return sendJson(
        response,
        200,
        posture(session.world, session.store, session.gateway, session.seed),
      );
    }
    if (method === "GET" && path === "/audit") {
      // 参加者から書き換える経路は無い。読み出しだけ。
      return sendJson(response, 200, {
        gateway: session.gateway.audit,
        operations: session.store.audit,
      });
    }
    return sendJson(response, 404, { error: "not_found" });
  });
}

/**
 * The verifier.
 *
 * It grades one thing: does the submitted receipt match the token this checkpoint's
 * gate is emitting **right now**. Because `posture` recomputes from the world on every
 * call, a receipt harvested while a gate was briefly true stops being accepted as soon
 * as the gate goes false.
 */
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
    if (!CHECKPOINTS.includes(checkpointId)) {
      return sendJson(response, 400, { error: "unknown_checkpoint" });
    }
    const submission = typeof body.submission === "string" ? body.submission.trim() : "";
    if (submission.length < 1 || submission.length > 200) {
      return sendJson(response, 400, { checkpointId, error: "invalid_submission" });
    }
    const live = posture(session.world, session.store, session.gateway, session.seed);
    const expected = live.tokens[checkpointId];
    const correct = expected !== null && submission === expected;
    return sendJson(response, 200, {
      checkpointId,
      correct,
      message: correct
        ? "Checkpoint cleared."
        : expected === null
          ? "この checkpoint の gate はいま満たされていません。"
          : "その値はこの checkpoint の受領証ではありません。",
    });
  });
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const session = createSession(process.env.FLAG_SEED ?? "local-dev-seed");
  setInterval(() => probeAvailability(session), PROBE_MS).unref?.();
  createGatewayServer(session).listen(8080, "0.0.0.0", () => console.log("workbench on :8080"));
  createVerifyServer(session).listen(8081, "0.0.0.0", () => console.log("verify on :8081"));
}

export { RUNBOOK, tokenFor };
