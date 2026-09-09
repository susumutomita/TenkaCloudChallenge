import { describe, expect, test } from "bun:test";
import {
  initialState,
  tick,
  applyOp,
  validateOp,
  projectForTeam,
  migrateState,
  STATE_SCHEMA_VERSION,
  STREAMING_ORDER_CONFIG,
} from "./reducer.ts";
import { scoreReasons } from "./score-reasons.ts";
import { scoreItemInputs } from "./score-steal.fixture.ts";
import { isCryptoBattleProjection } from "../../portal/coordination.ts";
import type { CryptoBattleState, CryptoBattleOp } from "./types.ts";
const ids = ["a", "b", "c"];
const inputs = scoreItemInputs(ids);
function match(seed = "item-test"): CryptoBattleState {
  let state = initialState(
    { eventId: "items", teamIds: ids, matchSecret: seed, deploymentInputs: inputs },
    STREAMING_ORDER_CONFIG,
  );
  state = applyOp(state, "a", { kind: "start" });
  for (let t = 0; t <= 550_000; t += 10_000) {
    state = tick(state, t);
    if (
      ids.every((id) =>
        state.contracts.some(
          (c) => c.teamId === id && c.status === "open" && c.task.kind === "ssm-decrypt",
        ),
      )
    )
      break;
  }
  return {
    ...state,
    teams: Object.fromEntries(
      Object.entries(state.teams).map(([id, t]) => [id, { ...t, score: 30 }]),
    ),
  };
}
function claim(state: CryptoBattleState, id = "a"): CryptoBattleOp {
  const c = state.contracts.find(
    (c) => c.teamId === id && c.status === "open" && c.task.kind === "ssm-decrypt",
  )!;
  if (c?.task.kind !== "ssm-decrypt") throw Error("No real issued item Order");
  const material = inputs[id]!.CoordinationPrivateItem;
  return {
    kind: "claim-steal",
    contractId: c.id,
    nonce: c.task.nonce,
    material,
    answer: (c.task.ciphertext - JSON.parse(material).key + 10) % 10,
  };
}
const use = (s: CryptoBattleState, actor: string, targetTeamId: string): CryptoBattleOp => ({
  kind: "use-steal",
  nonce: projectForTeam(s, actor).scoreSteal!.nonce,
  targetTeamId,
});
describe("deployment-backed optional score item", () => {
  test("default and v22 saved matches remain disabled", () => {
    const old = initialState(
      { eventId: "off", teamIds: ids, matchSecret: "off" },
      STREAMING_ORDER_CONFIG,
    );
    expect(old.scoreSteal).toBeUndefined();
    expect(migrateState(old, 22).scoreSteal).toBeUndefined();
    expect(STATE_SCHEMA_VERSION).toBe(23);
  });
  test("requires consistent trusted deployment inputs", () => {
    expect(() =>
      initialState({ eventId: "x", teamIds: ids, deploymentInputs: { a: inputs.a! } }),
    ).toThrow();
  });
  test("accepts the longest template-valid parameter name and rejects names beyond it", () => {
    const prefix = `tc-${"p".repeat(77)}`;
    const parameterName = `/${prefix}/score-item`;
    expect(prefix.length).toBe(80);
    expect(parameterName.length).toBe(92);
    const material = {
      ...inputs.a!,
      CoordinationParameterName: parameterName,
      CoordinationParameterConsoleUrl: `https://ap-northeast-1.console.aws.amazon.com/systems-manager/parameters/${prefix}/score-item/description`,
    };
    const context = { eventId: "length", teamIds: ["a"], deploymentInputs: { a: material } };
    expect(initialState(context).scoreSteal?.players.a?.parameterName).toBe(parameterName);
    expect(() => initialState({ ...context, deploymentInputs: {
      a: { ...material, CoordinationParameterName: `${parameterName}x` },
    } })).toThrow("Invalid score item resource location");
  });
  test("a real arrival replaces a normal slot, stays within cap, never exposes receipt or key", () => {
    const s = match();
    for (const id of ids) {
      const p = projectForTeam(s, id);
      expect(p.myContracts.filter((c) => c.status === "open").length).toBeLessThanOrEqual(3);
      expect(p.myContracts.filter((c) => c.task.kind === "ssm-decrypt")).toHaveLength(1);
      expect(isCryptoBattleProjection(p)).toBe(true);
      for (const value of Object.values(inputs))
        expect(JSON.stringify(p)).not.toContain(JSON.parse(value.CoordinationPrivateItem).receipt);
    }
  });
  test("malformed item projections fail closed before rendering", () => {
    const p = projectForTeam(match(), "a");
    expect(isCryptoBattleProjection({ ...p, scoreSteal: { held: true } })).toBe(false);
    for (const bad of [{ ciphertext: 10 }, { nonce: 7 }, { consoleUrl: "javascript:void(0)" }]) {
      expect(
        isCryptoBattleProjection({
          ...p,
          myContracts: p.myContracts.map((c) =>
            c.task.kind === "ssm-decrypt" ? { ...c, task: { ...c.task, ...bad } } : c,
          ),
        }),
      ).toBe(false);
    }
  });
  test("rejects another team, stale run nonce, bad receipt and wrong arithmetic; no reward for self-report", () => {
    const s = match();
    const op = claim(s);
    if (op.kind !== "claim-steal") throw Error();
    expect(validateOp(s, "b", op).ok).toBe(false);
    expect(validateOp(match("other-run"), "a", op).ok).toBe(false);
    for (const bad of [
      { ...op, material: inputs.b!.CoordinationPrivateItem },
      { ...op, answer: (op.answer + 1) % 10 },
      { ...op, material: "{}" },
    ]) {
      const next = applyOp(s, "a", bad);
      expect(projectForTeam(next, "a").scoreSteal!.held).toBe(false);
      expect(next.teams.a!.score).toBeLessThan(s.teams.a!.score);
    }
  });
  test("claim once, transfer actual amount atomically, forbid repeated claims/use/victim", () => {
    let s = match();
    const op = claim(s);
    s = applyOp(s, "a", op);
    expect(s.teams.a!.score).toBe(30);
    expect(validateOp(s, "a", op).ok).toBe(false);
    const action = use(s, "a", "b");
    const next = applyOp(s, "a", action);
    expect(next.teams.a!.score).toBe(40);
    expect(next.teams.b!.score).toBe(20);
    expect(scoreReasons(s, next, { kind: "op", teamId: "a", op: action })).toEqual({
      a: "item-steal",
      b: "item-stolen",
    });
    expect(validateOp(next, "a", action).ok).toBe(false);
    expect(applyOp(next, "a", action)).toEqual(next);
    s = applyOp(next, "c", claim(next, "c"));
    expect(validateOp(s, "c", use(s, "c", "b")).ok).toBe(false);
    expect(projectForTeam(s, "b").scoreSteal!.notices[0]?.points).toBe(10);
  });
  test("use is bound to this run, rejects self/zero/ended and caps at current target balance", () => {
    let s = match();
    s = applyOp(s, "a", claim(s));
    expect(validateOp(s, "a", use(s, "a", "a")).ok).toBe(false);
    expect(validateOp(s, "a", use(s, "a", "__proto__")).ok).toBe(false);
    const wrong = { ...use(s, "a", "b"), nonce: "old" } as CryptoBattleOp;
    expect(validateOp(s, "a", wrong).ok).toBe(false);
    s = {
      ...s,
      teams: { ...s.teams, b: { ...s.teams.b!, score: 3 }, c: { ...s.teams.c!, score: 0 } },
    };
    expect(validateOp(s, "a", use(s, "a", "c")).ok).toBe(false);
    const next = applyOp(s, "a", use(s, "a", "b"));
    expect(next.teams.a!.score).toBe(33);
    expect(next.teams.b!.score).toBe(0);
    expect(validateOp({ ...s, phase: "ended" }, "a", use(s, "a", "b")).ok).toBe(false);
  });
  test("expiry charges once, rotation preserves the independent item Order, no second issuance", () => {
    const s = match();
    const op = claim(s);
    if (op.kind !== "claim-steal") throw Error();
    const order = s.contracts.find((c) => c.id === op.contractId)!;
    const rotated = applyOp(s, "a", { kind: "rotate" });
    expect(rotated.contracts.find((c) => c.id === order.id)?.status).toBe("open");
    let next = tick(s, order.expiresAtMs);
    expect(validateOp(next, "a", op).ok).toBe(false);
    expect(tick(next, order.expiresAtMs).teams.a!.score).toBe(next.teams.a!.score);
    for (let t = order.expiresAtMs; t < 1_500_000; t += 10_000) next = tick(next, t);
    expect(
      next.contracts.filter(
        (c) => c.teamId === "a" && c.task.kind === "ssm-decrypt" && c.status === "open",
      ),
    ).toHaveLength(0);
  });
});
