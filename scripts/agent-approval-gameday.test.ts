import { describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `agent-approval-gameday` — the problem's own conformance suite (Issue 390).
 *
 * The problem claims something quite specific: that capability is what tools an agent
 * can call, that a read-only phase stays read-only, and that a write goes through a
 * review a human has to actually make. Each of those is a claim a broken
 * implementation would silently drop, so each is pinned here.
 *
 * Three groups matter most.
 *
 *   **Solvability across seeds** — every seed has to keep a broad selector dangerous.
 *   A seed where "stop everything tagged suspicious" happens to be harmless teaches the
 *   opposite of the lesson, so the generator is swept rather than spot-checked.
 *
 *   **Starter fails, reference passes** — the untouched world scores nothing, and the
 *   intended play clears every checkpoint. Without both, a scorer that always says yes
 *   and a scorer that always says no would each look fine.
 *
 *   **Security mutations** — for each guard (phase binding, digest freshness, preview
 *   required, revocation) there is a test that fails if the guard is removed.
 *
 * Not covered here: container isolation, the MCP client path, and human play. Those
 * need Docker and a person; they are named in the PR as unverified rather than
 * implied by a green suite.
 */

const APP = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  "battles/agent-approval-gameday/local/app",
);

const world = await import(join(APP, "world.mjs"));
const proposals = await import(join(APP, "proposals.mjs"));
const gateway = await import(join(APP, "gateway.mjs"));
const scoring = await import(join(APP, "scoring.mjs"));
const server = await import(join(APP, "server.mjs"));
const workbench = await import(join(APP, "workbench.mjs"));

const SEED = "test-seed";

/** A session with every phase already open, for tests that are not about the clock. */
function openSession(seed = SEED) {
  const session = server.createSession(seed);
  gateway.advancePhase(session.gateway, 3);
  const token = gateway.issueToken(session.gateway, "test").value;
  const call = (tool: string, input: Record<string, unknown> = {}) =>
    server.callTool(session, { tool, token, sessionId: "test", input }) as Record<string, unknown>;
  return { session, token, call };
}

const compromisedId = (session: { world: { compromisedId: string } }) => session.world.compromisedId;
const byKind = (session: { world: { resources: { kind: string; id: string }[] } }, kind: string) =>
  session.world.resources.find((resource) => resource.kind === kind);

/** The intended play, end to end. Used both as the reference run and as a fixture. */
function playCorrectly(context: ReturnType<typeof openSession>) {
  const { session, call } = context;
  const evidenceIds = session.world.evidence
    .filter((entry: { severity: string }) => entry.severity === "high")
    .map((entry: { id: string }) => entry.id);

  session.store.hypothesisAccepted = scoring.gradeHypothesis(session.world, {
    affectedResourceId: compromisedId(session),
    evidenceIds,
    protectedResourceIds: [byKind(session, "api").id, byKind(session, "audit").id],
  });

  // 依頼どおりの広い提案を作り、preview で巻き添えを見て、実行しない。
  const broad = call("propose_change", {
    action: "delete",
    selector: { kind: "tag", tag: "suspicious", value: "true" },
    evidenceIds,
    expectedPostConditions: ["suspicious が残っていない"],
    rollbackAction: "(依頼に書かれていない)",
  });
  call("preview_change", { proposalId: (broad.proposal as { id: string }).id });

  const exact = call("propose_change", {
    action: "isolate",
    selector: { kind: "exact", resourceIds: [compromisedId(session)] },
    evidenceIds,
    expectedPostConditions: ["侵害された worker が running でない", "注文 API が応答する"],
    rollbackAction: "rollback_change でこの提案を戻す",
  });
  const proposalId = (exact.proposal as { id: string }).id;
  const preview = call("preview_change", { proposalId });
  call("execute_change", { proposalId, approvalDigest: preview.approvalDigest });
  call("revoke_operator_capability");
  return { proposalId, broadId: (broad.proposal as { id: string }).id };
}

describe("solvability across seeds", () => {
  it("should keep every invariant on 200 seeds", () => {
    // 広い selector が無害になる seed が 1 つでもあると、参加者は「広くても平気だった」を
    // 学ぶ。ここは spot check ではなく sweep にする。
    const broken: string[] = [];
    for (let index = 0; index < 200; index += 1) {
      const seed = `sweep-${index}`;
      const problems = world.assertSolvable(world.createWorld(seed));
      if (problems.length > 0) broken.push(`${seed}: ${problems.join("; ")}`);
    }
    expect(broken).toEqual([]);
  });

  it("should always let the exact fix contain the threat without breaking the API", () => {
    for (let index = 0; index < 50; index += 1) {
      const context = openSession(`fix-${index}`);
      playCorrectly(context);
      expect(world.threatContained(context.session.world), `seed fix-${index}`).toBe(true);
      expect(world.apiHealthy(context.session.world), `seed fix-${index}`).toBe(true);
      expect(world.collateral(context.session.world), `seed fix-${index}`).toEqual([]);
    }
  });

  it("should make the broad selector reach something that must not be touched", () => {
    for (let index = 0; index < 50; index += 1) {
      const current = world.createWorld(`broad-${index}`);
      const reached = proposals.resolveSelector(current, {
        kind: "tag",
        tag: "suspicious",
        value: "true",
      });
      const protectedIds = new Set(world.protectedIds(current));
      expect(
        reached.some((resource: { id: string }) => protectedIds.has(resource.id)),
        `seed broad-${index}`,
      ).toBe(true);
    }
  });

  it("should be deterministic for one seed", () => {
    expect(JSON.stringify(world.createWorld("same"))).toBe(JSON.stringify(world.createWorld("same")));
  });
});

describe("phase capability", () => {
  it("should expose no tools at all in phase 1", () => {
    // 呼べない tool 名を見せると client はそれを試し、返る拒否はインシデントについて
    // 何も語らない。だから空を返す。
    const session = server.createSession(SEED);
    expect(gateway.listTools(session.gateway)).toMatchObject({ phase: 1, tools: [] });
  });

  it("should expose read-only tools and no write tools in phase 2", () => {
    const session = server.createSession(SEED);
    gateway.advancePhase(session.gateway, 2);
    const { tools } = gateway.listTools(session.gateway);
    expect(tools).toEqual(gateway.READ_ONLY_TOOLS);
    for (const tool of gateway.WRITE_TOOLS) expect(tools).not.toContain(tool);
  });

  it("should refuse a write tool called with a phase-2 token after phase 3 opens", () => {
    // これが無いと「read-only」は「時計が進むまでの read-only」になり、長く生きている
    // agent セッションが誰も渡していない write 権限を静かに獲得する。
    const session = server.createSession(SEED);
    gateway.advancePhase(session.gateway, 2);
    const stale = gateway.issueToken(session.gateway, "agent").value;
    gateway.advancePhase(session.gateway, 3);
    const result = server.callTool(session, {
      tool: "propose_change",
      token: stale,
      sessionId: "agent",
      input: {},
    });
    expect(result).toMatchObject({ error: "phase_locked_token", status: 403 });
  });

  it("should refuse an unknown or expired token", () => {
    const session = server.createSession(SEED);
    gateway.advancePhase(session.gateway, 2);
    expect(
      server.callTool(session, { tool: "list_resources", token: "cap-nope", sessionId: "x" }),
    ).toMatchObject({ error: "unknown_token" });

    let clock = 1_000;
    const expiring = gateway.createGateway(SEED, { now: () => clock, tokenTtlMs: 10 });
    gateway.advancePhase(expiring, 2);
    const token = gateway.issueToken(expiring, "x").value;
    clock += 100;
    expect(gateway.authorize(expiring, token, "list_resources", "x")).toMatchObject({
      allowed: false,
      reason: "token_expired",
    });
  });

  it("should refuse a token replayed from another session", () => {
    const session = server.createSession(SEED);
    gateway.advancePhase(session.gateway, 2);
    const token = gateway.issueToken(session.gateway, "alice").value;
    expect(gateway.authorize(session.gateway, token, "list_resources", "mallory")).toMatchObject({
      allowed: false,
      reason: "session_mismatch",
    });
  });

  it("should never hand the participant the protected flag", () => {
    // 何を守るべきかは証跡と依存から導くのが問題。ラベルを出すと読むだけの作業になる。
    const { session, call } = openSession();
    const described = call("describe_resource", { resourceId: byKind(session, "api").id });
    expect(described.resource).not.toHaveProperty("protected");
    expect(JSON.stringify(call("list_resources"))).not.toContain("protected");
  });

  it("should open phases on the server clock, never on a claim from the caller", () => {
    const session = server.createSession(SEED);
    session.startedAt = 0;
    expect(server.tickPhases(session, 1_000)).toBe(1);
    expect(server.tickPhases(session, 20 * 60_000)).toBe(2);
    expect(server.tickPhases(session, 40 * 60_000)).toBe(3);
    // 時計は戻らない。
    expect(server.tickPhases(session, 1_000)).toBe(3);
  });
});

describe("proposal review", () => {
  it("should refuse an execute that was never previewed", () => {
    const { session, call } = openSession();
    const created = call("propose_change", {
      action: "isolate",
      selector: { kind: "exact", resourceIds: [compromisedId(session)] },
      evidenceIds: ["ev-x"],
      expectedPostConditions: ["contained"],
      rollbackAction: "rollback",
    });
    const proposalId = (created.proposal as { id: string }).id;
    expect(call("execute_change", { proposalId, approvalDigest: "whatever" })).toMatchObject({
      error: "not_previewed",
      refused: true,
    });
    expect(session.store.executedWithoutPreview).toBe(1);
  });

  it("should refuse a digest that no longer describes the world", () => {
    // TOCTOU。「これを承認した」が「これらのリソースを承認した」を意味するために要る。
    const { session, call } = openSession();
    const created = call("propose_change", {
      action: "stop",
      selector: { kind: "tag", tag: "suspicious", value: "true" },
      evidenceIds: ["ev-x"],
      expectedPostConditions: ["stopped"],
      rollbackAction: "rollback",
    });
    const proposalId = (created.proposal as { id: string }).id;
    const preview = call("preview_change", { proposalId });

    // 世界が動く: タグの付いたリソースが 1 つ消える。
    const tagged = session.world.resources.find(
      (resource: { tags: Record<string, string>; id: string }) =>
        resource.tags.suspicious === "true" && resource.id !== compromisedId(session),
    );
    tagged.state = "isolated";

    const result = call("execute_change", { proposalId, approvalDigest: preview.approvalDigest });
    expect(result).toMatchObject({ error: "stale_digest", refused: true });
    expect(session.store.audit.some((entry: { event: string }) => entry.event === "execute_refused")).toBe(
      true,
    );
  });

  it("should let the same proposal through once it is previewed again", () => {
    const { call, session } = openSession();
    const created = call("propose_change", {
      action: "isolate",
      selector: { kind: "exact", resourceIds: [compromisedId(session)] },
      evidenceIds: ["ev-x"],
      expectedPostConditions: ["contained"],
      rollbackAction: "rollback",
    });
    const proposalId = (created.proposal as { id: string }).id;
    const fresh = call("preview_change", { proposalId });
    expect(call("execute_change", { proposalId, approvalDigest: fresh.approvalDigest })).not.toHaveProperty(
      "error",
    );
  });

  it("should show the collateral a broad selector would take, before it is executed", () => {
    const { session, call } = openSession();
    const created = call("propose_change", {
      action: "delete",
      selector: { kind: "tag", tag: "suspicious", value: "true" },
      evidenceIds: ["ev-x"],
      expectedPostConditions: ["clean"],
      rollbackAction: "none",
    });
    const preview = call("preview_change", {
      proposalId: (created.proposal as { id: string }).id,
    });
    expect(preview.broadSelector).toBe(true);
    expect(preview.reversible).toBe(false);
    expect((preview.collateral as { protected: boolean }[]).some((entry) => entry.protected)).toBe(
      true,
    );
  });

  it("should name what depends on the target, so a one-resource change shows its blast radius", () => {
    const { session, call } = openSession();
    const created = call("propose_change", {
      action: "disable",
      selector: { kind: "exact", resourceIds: [byKind(session, "config").id] },
      evidenceIds: ["ev-x"],
      expectedPostConditions: ["disabled"],
      rollbackAction: "rollback",
    });
    const preview = call("preview_change", {
      proposalId: (created.proposal as { id: string }).id,
    });
    expect((preview.dependents as { kind: string }[]).some((entry) => entry.kind === "api")).toBe(true);
  });

  it("should reject a proposal with no evidence, no post-condition or no rollback", () => {
    const { session, call } = openSession();
    for (const missing of ["evidenceIds", "expectedPostConditions", "rollbackAction"]) {
      const input: Record<string, unknown> = {
        action: "isolate",
        selector: { kind: "exact", resourceIds: [compromisedId(session)] },
        evidenceIds: ["ev-x"],
        expectedPostConditions: ["contained"],
        rollbackAction: "rollback",
      };
      input[missing] = missing === "rollbackAction" ? "" : [];
      expect(call("propose_change", input), missing).toMatchObject({ error: "invalid_proposal" });
    }
  });

  it("should not let a delete be rolled back", () => {
    // すべての誤りが巻き戻る問題は、承認が安いと教えてしまう。
    const { session, call } = openSession();
    const created = call("propose_change", {
      action: "delete",
      selector: { kind: "exact", resourceIds: [byKind(session, "audit").id] },
      evidenceIds: ["ev-x"],
      expectedPostConditions: ["gone"],
      rollbackAction: "none",
    });
    const proposalId = (created.proposal as { id: string }).id;
    const preview = call("preview_change", { proposalId });
    call("execute_change", { proposalId, approvalDigest: preview.approvalDigest });
    expect(call("rollback_change", { proposalId })).toMatchObject({ error: "not_reversible" });
    expect(world.evidenceIntact(session.world)).toBe(false);
  });

  it("should restore state for a reversible action", () => {
    const { session, call } = openSession();
    const created = call("propose_change", {
      action: "isolate",
      selector: { kind: "exact", resourceIds: [compromisedId(session)] },
      evidenceIds: ["ev-x"],
      expectedPostConditions: ["contained"],
      rollbackAction: "rollback",
    });
    const proposalId = (created.proposal as { id: string }).id;
    const preview = call("preview_change", { proposalId });
    call("execute_change", { proposalId, approvalDigest: preview.approvalDigest });
    expect(world.threatContained(session.world)).toBe(true);
    call("rollback_change", { proposalId });
    expect(world.threatContained(session.world)).toBe(false);
  });
});

describe("scoring", () => {
  it("should give the untouched world availability and nothing that was earned", () => {
    // starter は「まだ壊していない」状態なので、可用性と証拠保全という **保持する**
    // gate は最初から true でよい。稼いだ側 — 仮説・計画・審査・封じ込め・権限の返却 —
    // が 1 つでも最初から true なら、その checkpoint は何も測っていない。
    const { session } = openSession();
    const live = scoring.posture(session.world, session.store, session.gateway, SEED);
    expect(live.ready).toBe(false);
    expect(live.gates).toMatchObject({
      manual_hypothesis: false,
      evidence_backed_plan: false,
      safe_proposal_review: false,
      threat_contained: false,
      capability_closed: false,
      service_available: true,
      evidence_protected: true,
    });
    expect(live.score).toBeLessThan(1000);
  });

  it("should clear every checkpoint on the intended play", () => {
    const context = openSession();
    playCorrectly(context);
    const live = scoring.posture(
      context.session.world,
      context.session.store,
      context.session.gateway,
      SEED,
    );
    expect(live.gates).toMatchObject({
      manual_hypothesis: true,
      evidence_backed_plan: true,
      safe_proposal_review: true,
      threat_contained: true,
      service_available: true,
      evidence_protected: true,
      capability_closed: true,
    });
    expect(live.ready).toBe(true);
    expect(live.penalties).toEqual([]);
    expect(live.score).toBe(1000);
  });

  it("should not give containment for stopping the production API", () => {
    // 「全部止める」は containment を満たしても availability を落とす。片方だけでは満点に
    // ならないことが、この問題の主張そのもの。
    const { session, call } = openSession();
    const created = call("propose_change", {
      action: "stop",
      selector: { kind: "tag", tag: "suspicious", value: "true" },
      evidenceIds: ["ev-x"],
      expectedPostConditions: ["stopped"],
      rollbackAction: "rollback",
    });
    const proposalId = (created.proposal as { id: string }).id;
    const preview = call("preview_change", { proposalId });
    call("execute_change", { proposalId, approvalDigest: preview.approvalDigest });
    byKind(session, "api").state = "isolated";
    const live = scoring.posture(session.world, session.store, session.gateway, SEED);
    expect(live.gates.service_available).toBe(false);
    expect(live.ready).toBe(false);
  });

  it("should not give a full score for keeping the API up while the threat runs", () => {
    const { session } = openSession();
    const live = scoring.posture(session.world, session.store, session.gateway, SEED);
    expect(live.gates.service_available).toBe(true);
    expect(live.gates.threat_contained).toBe(false);
    expect(live.ready).toBe(false);
  });

  it("should keep the evidence penalty after the final state is repaired", () => {
    const { session, call } = openSession();
    const created = call("propose_change", {
      action: "delete",
      selector: { kind: "exact", resourceIds: [byKind(session, "audit").id] },
      evidenceIds: ["ev-x"],
      expectedPostConditions: ["gone"],
      rollbackAction: "none",
    });
    const proposalId = (created.proposal as { id: string }).id;
    const preview = call("preview_change", { proposalId });
    call("execute_change", { proposalId, approvalDigest: preview.approvalDigest });
    playCorrectly({ session, token: "", call } as ReturnType<typeof openSession>);
    const live = scoring.posture(session.world, session.store, session.gateway, SEED);
    expect(live.penalties.map((entry: { reason: string }) => entry.reason)).toContain("evidence_lost");
    expect(live.gates.evidence_protected).toBe(false);
  });

  it("should not credit safe review to somebody who never previewed the dangerous one", () => {
    // preview していないのは審査ではなく、たまたま運が良かっただけ。
    const { session, call } = openSession();
    const evidenceIds = session.world.evidence.map((entry: { id: string }) => entry.id);
    const exact = call("propose_change", {
      action: "isolate",
      selector: { kind: "exact", resourceIds: [compromisedId(session)] },
      evidenceIds,
      expectedPostConditions: ["contained"],
      rollbackAction: "rollback",
    });
    const proposalId = (exact.proposal as { id: string }).id;
    const preview = call("preview_change", { proposalId });
    call("execute_change", { proposalId, approvalDigest: preview.approvalDigest });
    const live = scoring.posture(session.world, session.store, session.gateway, SEED);
    expect(live.gates.threat_contained).toBe(true);
    expect(live.gates.safe_proposal_review).toBe(false);
  });

  it("should not accept a plan written as a tag selector", () => {
    const { session, call } = openSession();
    call("propose_change", {
      action: "isolate",
      selector: { kind: "tag", tag: "suspicious", value: "true" },
      evidenceIds: ["ev-x"],
      expectedPostConditions: ["contained"],
      rollbackAction: "rollback",
    });
    expect(scoring.gradePlan(session.world, session.store)).toBe(false);
  });

  it("should reject a hypothesis that names the wrong resource however well it is argued", () => {
    const { session } = openSession();
    const decoy = session.world.resources.find(
      (resource: { kind: string; id: string }) =>
        resource.kind === "worker" && resource.id !== compromisedId(session),
    );
    expect(
      scoring.gradeHypothesis(session.world, {
        affectedResourceId: decoy.id,
        evidenceIds: session.world.evidence.map((entry: { id: string }) => entry.id),
        protectedResourceIds: world.protectedIds(session.world),
      }),
    ).toBe(false);
  });

  it("should count outage ticks only while the API is actually down", () => {
    const { session } = openSession();
    server.probeAvailability(session);
    expect(session.store.outageTicks).toBe(0);
    byKind(session, "config").state = "disabled";
    server.probeAvailability(session);
    expect(session.store.outageTicks).toBe(1);
  });
});

describe("receipts", () => {
  it("should emit a receipt only while its gate holds", () => {
    // 権限を返す前に戻す。返した後は rollback 自体が拒否されるので、そちらだと
    // 「受領証が消えるか」ではなく「失効が効くか」を測ってしまう。
    const { session, call } = openSession();
    const created = call("propose_change", {
      action: "isolate",
      selector: { kind: "exact", resourceIds: [compromisedId(session)] },
      evidenceIds: ["ev-x"],
      expectedPostConditions: ["contained"],
      rollbackAction: "rollback",
    });
    const proposalId = (created.proposal as { id: string }).id;
    const preview = call("preview_change", { proposalId });
    call("execute_change", { proposalId, approvalDigest: preview.approvalDigest });

    const live = scoring.posture(session.world, session.store, session.gateway, SEED);
    expect(live.tokens["threat-containment"]).toBe(scoring.tokenFor(SEED, "threat-containment"));

    call("rollback_change", { proposalId });
    const after = scoring.posture(session.world, session.store, session.gateway, SEED);
    expect(after.tokens["threat-containment"]).toBeNull();
  });

  it("should give different receipts on different seeds", () => {
    expect(scoring.tokenFor("a", "threat-containment")).not.toBe(
      scoring.tokenFor("b", "threat-containment"),
    );
  });
});

describe("capability closure", () => {
  it("should stop write tools once the operator capability is revoked", () => {
    const { session, call } = openSession();
    call("revoke_operator_capability");
    expect(call("propose_change", {})).toMatchObject({ error: "capability_revoked" });
    expect(gateway.listTools(session.gateway).tools).not.toContain("execute_change");
  });

  it("should still allow read-only tools after revocation", () => {
    // 権限の失効は調査の終了ではない。振り返りのために読めることは残す。
    const { call } = openSession();
    call("revoke_operator_capability");
    expect(call("list_resources")).toHaveProperty("resources");
  });

  it("should not award closure while the threat is still running", () => {
    const { session, call } = openSession();
    call("revoke_operator_capability");
    const live = scoring.posture(session.world, session.store, session.gateway, SEED);
    expect(live.gates.capability_closed).toBe(false);
  });
});

describe("the audit record", () => {
  it("should record denials, refusals and executions", () => {
    const { session, call } = openSession();
    call("execute_change", { proposalId: "prp-nope" });
    const created = call("propose_change", {
      action: "isolate",
      selector: { kind: "exact", resourceIds: [compromisedId(session)] },
      evidenceIds: ["ev-x"],
      expectedPostConditions: ["contained"],
      rollbackAction: "rollback",
    });
    const proposalId = (created.proposal as { id: string }).id;
    const preview = call("preview_change", { proposalId });
    call("execute_change", { proposalId, approvalDigest: preview.approvalDigest });
    const events = session.store.audit.map((entry: { event: string }) => entry.event);
    expect(events).toContain("executed");
    expect(session.gateway.audit.some((entry: { event: string }) => entry.event === "tool_call")).toBe(
      true,
    );
  });

  it("should record a denied tool call with its reason", () => {
    const session = server.createSession(SEED);
    gateway.advancePhase(session.gateway, 2);
    const token = gateway.issueToken(session.gateway, "agent").value;
    server.callTool(session, { tool: "execute_change", token, sessionId: "agent", input: {} });
    expect(
      session.gateway.audit.some(
        (entry: { event: string; reason?: string }) =>
          entry.event === "tool_denied" && entry.reason === "phase_locked_token",
      ),
    ).toBe(true);
  });
});

describe("the browser workbench", () => {
  it("should render every page with a colour scheme declared", () => {
    // 宣言が無いと、ダークモードのブラウザで黒背景に黒文字になる (Issue 396)。
    const context = openSession();
    const created = context.call("propose_change", {
      action: "isolate",
      selector: { kind: "exact", resourceIds: [compromisedId(context.session)] },
      evidenceIds: ["ev-x"],
      expectedPostConditions: ["contained"],
      rollbackAction: "rollback",
    });
    const preview = context.call("preview_change", {
      proposalId: (created.proposal as { id: string }).id,
    });
    const pages = [
      workbench.incidentPage(context.session),
      workbench.resourcesPage(context.session),
      workbench.plannerPage(context.session),
      workbench.proposalPage(context.session),
      workbench.previewPage(context.session, preview),
    ];
    for (const html of pages) {
      expect(html).toContain('name="color-scheme"');
      expect(html).toContain("<!doctype html>");
    }
  });

  it("should ship no inline script, so no escape can be eaten by the outer literal", () => {
    // Issue 395 の欠陥クラスは inline script が無ければ発生しない。
    const context = openSession();
    for (const html of [
      workbench.incidentPage(context.session),
      workbench.resourcesPage(context.session),
      workbench.plannerPage(context.session),
      workbench.proposalPage(context.session),
    ]) {
      expect(html).not.toContain("<script");
    }
  });

  it("should link relatively, never to a port local play may reassign", () => {
    // Issue 399: 焼き込んだアドレスは別の問題を指す。
    const context = openSession();
    for (const html of [
      workbench.incidentPage(context.session),
      workbench.resourcesPage(context.session),
      workbench.proposalPage(context.session),
    ]) {
      expect(html).not.toContain("127.0.0.1:");
      expect(html).not.toContain("localhost:");
    }
  });

  it("should not print the protected flag anywhere the participant can read it", () => {
    const context = openSession();
    expect(workbench.resourcesPage(context.session)).not.toContain("protected");
  });

  it("should offer the vague request as a proposal that can be previewed", () => {
    // 「AI を盲信するな」を結論として書くのではなく、危ない diff を実際に見せて判断させる。
    const context = openSession();
    expect(workbench.proposalPage(context.session)).toContain("この依頼をそのまま提案にする");
  });
});
