import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMatch, readProjection, submitOp } from "../../dev/host.ts";
import { buildScenario } from "../../dev/scenarios.ts";
import HintBooster from "../../portal/HintBooster.tsx";
import { ageProjection } from "../../portal/FastMovePanel.tsx";
import { isCryptoBattleProjection } from "../../portal/coordination.ts";
import { submitRevealHint } from "../../portal/RegistrationPanelCore.tsx";
import { HINT_BOOSTER_MS } from "./booster.ts";
import { applyOp, initialState, migrateState, projectForTeam, tick, validateOp } from "./reducer.ts";
import type { CryptoBattleOp, CryptoBattleState } from "./types.ts";

const BOUNDARY = 5 * 60_000;
const config = { phaseBoundaries: { buildToPressureMs: 60_000, pressureToEndgameMs: BOUNDARY } };
function match(scores: Record<string, number> = { alpha: 100, bravo: 200 }) {
  const host = createMatch({ eventId: "booster", teamIds: Object.keys(scores), matchSecret: "booster-test" }, config);
  host.state = { ...host.state, teams: Object.fromEntries(Object.entries(host.state.teams).map(([id, team]) => [id, { ...team, score: scores[id]! }])) };
  return host;
}
const copy = (state: CryptoBattleState): CryptoBattleState => JSON.parse(JSON.stringify(state));
const withoutBooster = ({ endgameBooster: _booster, ...state }: CryptoBattleState) => state;
const oldRow = (state: CryptoBattleState) => copy(withoutBooster(state) as CryptoBattleState);
function orderAt(state: CryptoBattleState, team = "alpha") {
  const order = projectForTeam(state, team).myContracts.find(c => c.status === "open" && c.remainingMs > 0);
  if (!order) throw new Error("setup: expected an open Order");
  return order;
}
function move(state: CryptoBattleState, team: string, op: CryptoBattleOp) {
  expect(validateOp(state, team, op)).toEqual({ ok: true });
  return applyOp(state, team, op);
}

test("waits for shared READY; a shifted match uses its own endgame boundary", () => {
  let state = initialState({ eventId: "wait", teamIds: ["alpha", "bravo"] }, config);
  state = tick(state, 40 * 60_000);
  expect(state.endgameBooster).toEqual({ status: "pending" });
  expect(projectForTeam(state, "alpha").hintBooster).toMatchObject({ status: "waiting", startAfterMs: BOUNDARY });
  state = move(state, "alpha", { kind: "ready" }); state = move(state, "bravo", { kind: "ready" });
  expect(tick(state, state.startedAtMs! + BOUNDARY - 1).endgameBooster).toEqual({ status: "pending" });
  expect(tick(state, state.startedAtMs! + BOUNDARY).endgameBooster).toEqual({ status: "awarded", teamIds: ["alpha", "bravo"] });
});

for (const [scores, expected] of [
  [{ alpha: 100, bravo: 200 }, ["alpha"]],
  [{ alpha: 100, bravo: 100 }, ["alpha", "bravo"]],
  [{ alpha: 100, bravo: 100, charlie: 200 }, ["alpha", "bravo"]],
  [{ alpha: 100 }, []],
] as const) test(`lowest tied teams only: ${JSON.stringify(scores)}`, () => {
  const state = tick(match(scores).state, BOUNDARY);
  expect(state.endgameBooster).toEqual({ status: "awarded", teamIds: expected });
  for (const id of Object.keys(scores)) {
    expect(projectForTeam(state, id).hintBooster?.status).toBe((expected as readonly string[]).includes(id) ? "active" : "ineligible");
    expect(JSON.stringify(projectForTeam(state, id).hintBooster)).not.toContain("teamIds");
  }
});

test("late tick fixes boundary ranking while preserving the previous issuance, expiry and ledger transition", () => {
  const host = match({ alpha: 200, bravo: 210 });
  host.state = tick(host.state, 60_000);
  for (const c of host.state.contracts.filter(c => c.teamId === "bravo" && c.allowedMethods.includes("leak"))) {
    host.state = move(host.state, "bravo", { kind: "leak", contractId: c.id });
  }
  const atBoundary = tick(copy(host.state), BOUNDARY);
  for (const now of [BOUNDARY, BOUNDARY + 1, BOUNDARY + 120_000, BOUNDARY + HINT_BOOSTER_MS + 1, 90 * 60_000]) {
    const late = tick(copy(host.state), now);
    const previousPath = tick({ ...copy(host.state), endgameBooster: { status: "awarded", teamIds: [] } }, now);
    expect(late.endgameBooster).toEqual(atBoundary.endgameBooster);
    expect(withoutBooster(late)).toEqual(withoutBooster(previousPath));
    expect(tick(copy(late), now)).toEqual(late);
  }
});

test("RPS expiry at the boundary counts toward the rank, later expiry does not", () => {
  const source = buildScenario("rps-reuse").host.state;
  const duel = source.contracts.find(c => c.task.kind === "rps-duel" && c.status === "open")!;
  const boundary = duel.expiresAtMs;
  const state = { ...source, config: { ...source.config, phaseBoundaries: { ...source.config.phaseBoundaries, pressureToEndgameMs: boundary - source.startedAtMs! } }, endgameBooster: { status: "pending" as const } };
  const direct = tick(state, boundary), delayed = tick(copy(state), boundary + 30_000);
  expect(delayed.endgameBooster).toEqual(direct.endgameBooster);
  const min = Math.min(...Object.values(direct.teams).map(t => t.score));
  expect(direct.endgameBooster).toEqual({ status: "awarded", teamIds: Object.values(direct.teams).filter(t => t.score === min).map(t => t.teamId).sort() });
});

test("host opens three hints without penalty, reload retains allocation, fixed expiry restores prices without extending Order TTL", () => {
  const host = match(); readProjection(host, "alpha", BOUNDARY);
  const order = orderAt(host.state), before = host.state.teams.alpha!.score, ledger = host.state.publicLedger;
  for (let level = 0; level < 3; level++) {
    expect(submitOp(host, "alpha", { kind: "reveal-hint", contractId: order.id, expectedCost: 0 }, BOUNDARY + level * 5000).kind).toBe("ok");
    expect(host.state.teams.alpha!.score).toBe(before);
    expect(projectForTeam(host.state, "alpha").myContracts.find(c => c.id === order.id)!.hints.filter(h => h.text)).toHaveLength(level + 1);
  }
  expect(host.state.publicLedger).toEqual(ledger);
  expect(projectForTeam(host.state, "bravo").myContracts.every(c => c.hints[0]?.cost === 2)).toBe(true);
  host.state = copy({ ...host.state, teams: { ...host.state.teams, alpha: { ...host.state.teams.alpha!, score: 999 } } });
  readProjection(host, "alpha", BOUNDARY + HINT_BOOSTER_MS - 1);
  expect(host.state.endgameBooster).toEqual({ status: "awarded", teamIds: ["alpha"] });
  const endingOrder = orderAt(host.state), score = host.state.teams.alpha!.score;
  expect(submitOp(host, "alpha", { kind: "reveal-hint", contractId: endingOrder.id, expectedCost: 0 }, BOUNDARY + HINT_BOOSTER_MS).kind).toBe("rejected");
  expect(host.state.teams.alpha!.score).toBe(score);
  expect(projectForTeam(host.state, "alpha").hintBooster).toMatchObject({ status: "expired", remainingMs: 0 });
  expect(submitOp(host, "alpha", { kind: "reveal-hint", contractId: endingOrder.id, expectedCost: 2 }, BOUNDARY + HINT_BOOSTER_MS + 1).kind).toBe("ok");
  expect(host.state.teams.alpha!.score).toBe(score - 2);
  expect(orderAt(host.state).remainingMs).toBe(endingOrder.remainingMs - 2);
});

test("v5 migration preserves compact RPS reservations; a past legacy ranking is explicitly unavailable", () => {
  let state = buildScenario("rps-reuse").host.state;
  const target = projectForTeam(state, "alpha").rpsHunt!.targets[0]!;
  state = move(state, "alpha", { kind: "hunt-rps", targetTeamId: "bravo", duelId: target.duelId, predictedHand: 2 });
  const legacy = oldRow(state), before = JSON.stringify(legacy), migrated = migrateState(legacy, 5);
  expect(migrated.huntAttempts).toEqual(state.huntAttempts);
  expect(migrated.contracts).toEqual(state.contracts); expect(migrated.publicLedger).toEqual(state.publicLedger);
  expect(projectForTeam(migrated, "alpha").rpsHunt!.pending).toEqual(projectForTeam(state, "alpha").rpsHunt!.pending);
  expect(JSON.stringify(legacy)).toBe(before);
  let restored = copy(migrated), original = copy(state);
  const a = state.contracts.find(c => c.teamId === "alpha" && c.task.kind === "rps-duel" && c.task.duelId === target.duelId)!;
  const b = state.contracts.find(c => c.teamId === "bravo" && c.task.kind === "rps-duel" && c.task.duelId === target.duelId)!;
  for (const [team, op] of [
    ["alpha", { kind: "rps-commit", contractId: a.id, commitment: 13 }],
    ["bravo", { kind: "rps-open", contractId: b.id, hand: 2, randomness: 2 }],
    ["alpha", { kind: "rps-open", contractId: a.id, hand: 1, randomness: 1 }],
  ] as const) {
    restored = move(restored, team, op); original = move(original, team, op);
    expect(restored).toEqual(original);
  }
  expect(projectForTeam(restored, "alpha").rpsHunt!.lastResult).toMatchObject({ outcome: "hit", points: 25 });
  expect(tick(migrated, 60 * 60_000).endgameBooster?.status).toBe("awarded");
  const past = oldRow(tick(state, 60 * 60_000 + 1)), upgraded = migrateState(past, 5);
  expect(upgraded.endgameBooster).toEqual({ status: "unavailable" });
  expect(withoutBooster(upgraded)).toEqual(withoutBooster(past));
  expect(tick(copy(upgraded), 60 * 60_000 + 2).endgameBooster).toEqual({ status: "unavailable" });
  expect(projectForTeam(upgraded, "alpha").hintBooster?.status).toBe("unavailable");
});

test("real component and prices age together, while malformed/mixed-version projection data is safe", async () => {
  const projection = projectForTeam(tick(match().state, BOUNDARY), "alpha");
  expect(isCryptoBattleProjection(projection)).toBe(true);
  const html = renderToStaticMarkup(createElement(HintBooster, { projection, locale: "ja" }));
  expect(html).toContain("ヒントの減点なし · 残り 10:00"); expect(html).not.toContain("無料");
  const aged = ageProjection(projection, HINT_BOOSTER_MS)!;
  expect(aged.hintBooster?.status).toBe("expired");
  expect(aged.myContracts.flatMap(c => c.hints).every(h => h.cost === h.regularCost)).toBe(true);
  expect(renderToStaticMarkup(createElement(HintBooster, { projection: aged, locale: "ja" }))).toContain("期間は終了");
  for (const bad of [null, {}, { ...projection.hintBooster, remainingMs: -1 }, { ...projection.hintBooster, status: "other" }]) expect(isCryptoBattleProjection({ ...projection, hintBooster: bad })).toBe(false);
  const { hintBooster: _oldServer, ...oldProjection } = projection;
  expect(isCryptoBattleProjection(oldProjection)).toBe(true);
  expect(renderToStaticMarkup(createElement(HintBooster, { projection: oldProjection, locale: "ja" }))).toBe("");
  let submitted: unknown;
  await submitRevealHint({ submitOp: async (op: unknown) => { submitted = op; return { kind: "ok", projection }; } } as never, orderAt(tick(match().state, BOUNDARY)).id, 0);
  expect(submitted).toMatchObject({ kind: "reveal-hint", expectedCost: 0 });
});

test("an operation at the boundary fixes eligibility before its score change", () => {
  const host = match({ alpha: 100, bravo: 110 });
  // Equal deadlines isolate the operation/phase ordering from per-team rush rolls.
  host.state = { ...host.state, config: { ...host.state.config, rushContractTtlMs: host.state.config.contractTtlMs } };
  readProjection(host, "alpha", 60_000);
  const cipher = projectForTeam(host.state, "alpha").myContracts.find(c => c.task.kind === "caesar-shift")!;
  expect(submitOp(host, "alpha", { kind: "leak", contractId: cipher.id }, BOUNDARY).kind).toBe("ok");
  expect(host.state.endgameBooster).toEqual({ status: "awarded", teamIds: ["alpha"] });
  const bravoOrder = orderAt(host.state, "bravo");
  expect(submitOp(host, "bravo", { kind: "reveal-hint", contractId: bravoOrder.id, expectedCost: 2 }, BOUNDARY + 1).kind).toBe("ok");
  expect(host.state.teams.bravo!.score).toBeLessThan(host.state.teams.alpha!.score);
  expect(projectForTeam(host.state, "alpha").hintBooster?.status).toBe("active");
  expect(projectForTeam(host.state, "bravo").hintBooster?.status).toBe("ineligible");
});

test("malformed stored allocations fail without rewriting the input; regular prices cannot disappear from an active projection", () => {
  const state = tick(match().state, BOUNDARY);
  for (const allocation of [null, { status: "other" }, { status: "awarded", teamIds: null }, { status: "awarded", teamIds: ["outsider"] }, { status: "awarded", teamIds: ["alpha", "alpha"] }]) {
    const malformed = { ...state, endgameBooster: allocation }, before = JSON.stringify(malformed);
    expect(() => migrateState(malformed, 5)).toThrow();
    expect(JSON.stringify(malformed)).toBe(before);
  }
  const projection = projectForTeam(state, "alpha");
  expect(isCryptoBattleProjection({ ...projection, myContracts: projection.myContracts.map(c => ({ ...c, hints: c.hints.map(({ regularCost: _cost, ...h }) => h) })) })).toBe(false);
});
