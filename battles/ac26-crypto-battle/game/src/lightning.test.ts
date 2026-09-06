import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMatch, readProjection, submitOp, type MatchHost } from "../../dev/host.ts";
import { buildScenario } from "../../dev/scenarios.ts";
import Lightning from "../../portal/Lightning.tsx";
import { ageProjection, proveFeedback, cipherFeedback } from "../../portal/FastMovePanel.tsx";
import { submitDeclareLightning } from "../../portal/RegistrationPanelCore.tsx";
import { isCryptoBattleProjection } from "../../portal/coordination.ts";
import { buildFheOp, buildMpcOp, buildProveSudokuOp } from "./playtest.ts";
import { DEFAULT_CONFIG, initialState, migrateState, projectForTeam, tick, validateOp } from "./reducer.ts";
import { scoreReasons } from "./score-reasons.ts";
import type { ContractProjection, CryptoBattleOp, CryptoBattleState } from "./types.ts";

const MINUTE = 60_000, BOUNDARY = 5 * MINUTE;
const config = { phaseBoundaries: { buildToPressureMs: MINUTE, pressureToEndgameMs: BOUNDARY }, rushContractTtlMs: 5 * MINUTE };
function match(scores: Record<string, number> = { alpha: 200, bravo: 400 }): MatchHost {
  const host = createMatch({ eventId: "lightning", teamIds: Object.keys(scores), matchSecret: "lightning-test" }, config);
  host.state = { ...host.state, teams: Object.fromEntries(Object.entries(host.state.teams).map(([id, team]) => [id, { ...team, score: scores[id]! }])) };
  return host;
}
function awarded() { const host = match(); readProjection(host, "alpha", BOUNDARY); return host; }
const copy = (s: CryptoBattleState): CryptoBattleState => JSON.parse(JSON.stringify(s));
const withoutItems = ({ endgameLightning: _l, endgameBooster: _b, ...s }: CryptoBattleState) => s;
function order(host: MatchHost, method: "prove" | "cipher" | "fhe" | "mpc" | "duel" = "prove", team = "alpha") {
  const found = projectForTeam(host.state, team).myContracts.find(c => c.status === "open" && c.allowedMethods.includes(method));
  if (!found) throw new Error(`fixture missing ${method} Order for ${team}`);
  return found;
}
function answer(host: MatchHost, c: ContractProjection, method: "prove" | "cipher" | "fhe" | "mpc"): CryptoBattleOp {
  const p = projectForTeam(host.state, "alpha");
  if (method === "prove") return buildProveSudokuOp(p.vault, c.id);
  if (method === "fhe" || method === "mpc") {
    const op = method === "fhe" ? buildFheOp(c, p.prime) : buildMpcOp(c, p.prime);
    if (!op) throw new Error(`fixture cannot build ${method} from this Order`);
    return op;
  }
  if (c.task.kind !== "caesar-shift") throw new Error("fixture needs cipher task");
  const task = c.task;
  return { kind: "cipher", contractId: c.id, answer: task.plaintext.map((n, i) => {
    const key = typeof task.myKey === "number" ? task.myKey : task.myKey[((task.keyPosition ?? 0) + i) % 3]!;
    const sum = n + key; return String(sum >= 6 ? sum - 6 : sum);
  }) };
}
function arm(host: MatchHost, c: ContractProjection, now = BOUNDARY) {
  expect(submitOp(host, "alpha", { kind: "declare-lightning", contractId: c.id }, now).kind).toBe("ok");
  expect(validateOp(host.state, "alpha", { kind: "declare-lightning", contractId: c.id }).ok).toBe(false);
}

for (const [scores, recipients] of [
  [{ alpha: 100 }, []],
  [{ alpha: 100, bravo: 200 }, ["alpha"]],
  [{ alpha: 100, bravo: 100 }, ["alpha", "bravo"]],
  [{ alpha: 100, bravo: 200, charlie: 300 }, ["alpha", "bravo"]],
  [{ alpha: 100, bravo: 100, charlie: 300 }, ["alpha", "bravo"]],
  [{ alpha: 100, bravo: 200, charlie: 200, delta: 400 }, ["alpha", "bravo", "charlie"]],
  [{ alpha: 100, bravo: 100, charlie: 100 }, ["alpha", "bravo", "charlie"]],
] as const) test(`once-only endgame distribution: ${JSON.stringify(scores)}`, () => {
  const before = match(scores), source = copy(before.state);
  expect(projectForTeam(tick(source, BOUNDARY - 1), "alpha").lightning?.status).toBe("scheduled");
  before.state = tick(source, BOUNDARY);
  const allocated = before.state.endgameLightning;
  expect(allocated?.status).toBe("awarded");
  if (allocated?.status !== "awarded") throw new Error("missing distribution");
  expect(Object.keys(allocated.cards).sort()).toEqual([...recipients].sort());
  const changedRank = { ...copy(before.state), teams: Object.fromEntries(Object.entries(before.state.teams).map(([id, t]) => [id, { ...t, score: 999 - t.score }])) };
  expect(tick(changedRank, BOUNDARY + 1).endgameLightning).toEqual(allocated);
  for (const team of Object.keys(scores)) {
    const mine = projectForTeam(before.state, team).lightning;
    expect(mine?.status).toBe((recipients as readonly string[]).includes(team) ? "available" : "ineligible");
    expect(JSON.stringify(mine)).not.toContain("cards");
  }
});

test("READY shifts the public boundary; late tick uses boundary ranking without changing ordinary time advancement", () => {
  let state = tick(initialState({ eventId: "waiting", teamIds: ["alpha", "bravo"] }, config), 20 * MINUTE);
  expect(projectForTeam(state, "alpha").lightning).toMatchObject({ status: "waiting", startAfterMs: BOUNDARY });
  const host = { ...match(), state };
  expect(submitOp(host, "alpha", { kind: "ready" }, 20 * MINUTE).kind).toBe("ok");
  expect(submitOp(host, "bravo", { kind: "ready" }, 20 * MINUTE).kind).toBe("ok");
  state = tick(host.state, 24 * MINUTE);
  expect(state.endgameLightning?.status).toBe("pending");
  expect(tick(state, 25 * MINUTE).endgameLightning?.status).toBe("awarded");
  const source = match().state, atBoundary = tick(copy(source), BOUNDARY);
  for (const now of [BOUNDARY, BOUNDARY + 1, BOUNDARY + 10 * MINUTE, 90 * MINUTE]) {
    const late = tick(copy(source), now);
    const previous = tick({ ...copy(source), endgameLightning: { status: "awarded", cards: {} }, endgameBooster: { status: "awarded", teamIds: [] } }, now);
    expect(withoutItems(late)).toEqual(withoutItems(previous));
    if (now < 90 * MINUTE) expect(late.endgameLightning).toEqual(atBoundary.endgameLightning);
    expect(tick(copy(late), now)).toEqual(late);
  }
});

for (const method of ["prove", "cipher", "fhe", "mpc"] as const) test(`${method} calculation doubles only the declared Order's existing reward and scores once`, () => {
  const host = awarded(), target = order(host, method), before = copy(host.state);
  arm(host, target);
  expect(host.state.teams.alpha!.score).toBe(before.teams.alpha!.score);
  expect(scoreReasons(before, host.state, { kind: "op", teamId: "alpha", op: { kind: "declare-lightning", contractId: target.id } })).toEqual({});
  const own = projectForTeam(host.state, "alpha"), other = projectForTeam(host.state, "bravo");
  expect(own.lightning).toMatchObject({ status: "armed", contractId: target.id, points: target.points * 2, remainingMs: target.remainingMs });
  expect(JSON.stringify(other.lightning)).not.toContain(target.id);
  expect(own.myContracts.find(c => c.id === target.id)?.points).toBe(target.points * 2);
  const op = answer(host, target, method);
  const score = host.state.teams.alpha!.score;
  expect(submitOp(host, "alpha", op, BOUNDARY + 1000).kind).toBe("ok");
  expect(host.state.teams.alpha!.score - score).toBe(target.points * 2);
  const completed = projectForTeam(host.state, "alpha");
  expect(completed.lightning).toMatchObject({ status: "spent", outcome: "hit", points: target.points * 2 });
  if (method === "prove") expect(proveFeedback(completed, target.id, target.points, "ja").reward).toBe(target.points * 2);
  if (method === "cipher") expect(cipherFeedback(completed, target.id, "ja").reward).toBe(target.points * 2);
  expect(submitOp(host, "alpha", op, BOUNDARY + 1001).kind).toBe("rejected");
  const follow = order(host, method === "prove" ? "cipher" : "prove");
  expect(submitOp(host, "alpha", { kind: "declare-lightning", contractId: follow.id }, BOUNDARY + 1002).kind).toBe("rejected");
  const beforeFollow = host.state.teams.alpha!.score;
  expect(submitOp(host, "alpha", answer(host, follow, method === "prove" ? "cipher" : "prove"), BOUNDARY + 1003).kind).toBe("ok");
  expect(host.state.teams.alpha!.score - beforeFollow).toBe(follow.points);
});

test("a recorded answer forbids late declaration; malformed input does not, and a declared PROVE can retry after a miss", () => {
  const host = awarded(), target = order(host);
  const wrong: CryptoBattleOp = { kind: "prove-sudoku", contractId: target.id, grid: Array(16).fill(1) };
  const invalid: CryptoBattleOp = { kind: "prove-sudoku", contractId: target.id, grid: [] };
  expect(submitOp(host, "alpha", invalid, BOUNDARY).kind).toBe("rejected");
  expect(projectForTeam(host.state, "alpha").myContracts.find(c => c.id === target.id)?.lightningEligible).toBe(true);
  const noCard = { ...host, state: copy(host.state) };
  expect(submitOp(noCard, "alpha", wrong, BOUNDARY).kind).toBe("ok");
  expect(submitOp(noCard, "alpha", { kind: "declare-lightning", contractId: target.id }, BOUNDARY).kind).toBe("rejected");
  expect(projectForTeam(noCard.state, "alpha").lightning?.status).toBe("available");
  arm(host, target);
  const declaration = host.state.endgameLightning, before = host.state.teams.alpha!.score;
  expect(submitOp(host, "alpha", invalid, BOUNDARY).kind).toBe("rejected");
  expect(host.state.endgameLightning).toEqual(declaration);
  expect(submitOp(host, "alpha", wrong, BOUNDARY + 1).kind).toBe("ok");
  expect(host.state.teams.alpha!.score).toBe(before - DEFAULT_CONFIG.scores.wrongProve);
  expect(projectForTeam(host.state, "alpha").lightning?.status).toBe("armed");
  expect(submitOp(host, "alpha", { kind: "declare-lightning", contractId: order(host, "cipher").id }, BOUNDARY + 2).kind).toBe("rejected");
  host.state = copy(host.state);
  expect(submitOp(host, "alpha", answer(host, target, "prove"), BOUNDARY + 3).kind).toBe("ok");
  expect(host.state.teams.alpha!.score).toBe(before - DEFAULT_CONFIG.scores.wrongProve + target.points * 2);
});

test("Vigenere forfeiture remains 0 when doubled, including declaration before the first miss and reload", () => {
  const host = awarded(), target = order(host, "cipher"), correct = answer(host, target, "cipher");
  if (correct.kind !== "cipher") throw new Error("missing cipher answer");
  const wrong: CryptoBattleOp = { ...correct, answer: [String((Number(correct.answer[0]) + 1) % 6)] };
  const beforeArm = { ...host, state: copy(host.state) };
  expect(submitOp(beforeArm, "alpha", wrong, BOUNDARY).kind).toBe("ok");
  expect(submitOp(beforeArm, "alpha", { kind: "declare-lightning", contractId: target.id }, BOUNDARY).kind).toBe("rejected");
  arm(host, target);
  const before = host.state.teams.alpha!.score;
  expect(submitOp(host, "alpha", wrong, BOUNDARY + 1).kind).toBe("ok");
  expect(projectForTeam(host.state, "alpha").lightning).toMatchObject({ status: "armed", points: 0 });
  expect(host.state.teams.alpha!.score).toBe(before - 6);
  host.state = copy(host.state);
  expect(submitOp(host, "alpha", correct, BOUNDARY + 2).kind).toBe("ok");
  expect(projectForTeam(host.state, "alpha").lightning).toMatchObject({ status: "spent", outcome: "hit", points: 0 });
  expect(projectForTeam(host.state, "alpha").lastCipher?.points).toBe(0);
  expect(host.state.teams.alpha!.score).toBe(before - 6);
});

for (const method of ["fhe", "mpc"] as const) test(`rejected ${method} input keeps the declaration and follows the unchanged verifier contract`, () => {
  const host = awarded(), target = order(host, method); arm(host, target);
  const state = copy(host.state), correct = answer(host, target, method);
  const wrong: CryptoBattleOp = correct.kind === "fhe" ? { ...correct, ciphertext: { r: "0", y: "0" } }
    : correct.kind === "mpc" ? { ...correct, partial: "-1" } : (() => { throw new Error("wrong fixture"); })();
  expect(submitOp(host, "alpha", wrong, BOUNDARY).kind).toBe("rejected");
  expect(host.state).toEqual(state);
  expect(submitOp(host, "alpha", correct, BOUNDARY + 1).kind).toBe("ok");
  expect(host.state.teams.alpha!.score - state.teams.alpha!.score).toBe(target.points * 2);
});

for (const ending of ["leak", "rotate", "deadline"] as const) test(`${ending} spends the targeted card without multiplying a penalty or LEAK reward`, () => {
  const host = awarded(), target = order(host, "cipher"); arm(host, target);
  const before = copy(host.state), reference = { ...host, state: { ...copy(host.state), endgameLightning: { status: "awarded" as const, cards: {} } } };
  const now = ending === "deadline" ? BOUNDARY + target.remainingMs : BOUNDARY + 1;
  if (ending === "deadline") { readProjection(host, "alpha", now); readProjection(reference, "alpha", now); }
  else {
    const op: CryptoBattleOp = ending === "leak" ? { kind: "leak", contractId: target.id } : { kind: "rotate" };
    expect(submitOp(host, "alpha", op, now).kind).toBe("ok");
    expect(submitOp(reference, "alpha", op, now).kind).toBe("ok");
  }
  expect(withoutItems(host.state)).toEqual(withoutItems(reference.state));
  expect(projectForTeam(host.state, "alpha").lightning).toMatchObject({ status: "spent", outcome: ending });
  if (ending === "leak") expect(host.state.teams.alpha!.score - before.teams.alpha!.score).toBe(target.leakPoints);
  const card = host.state.endgameLightning;
  host.state = tick(copy(host.state), now + 20 * MINUTE);
  expect(host.state.contracts.some(c => c.id === target.id)).toBe(false);
  expect(host.state.endgameLightning).toEqual(card);
  expect(submitOp(host, "alpha", { kind: "declare-lightning", contractId: order(host).id }, now + 20 * MINUTE).kind).toBe("rejected");
});

test("end of match expires unused cards and armed targets even if their Order deadline is later", () => {
  for (const declare of [false, true]) {
    const host = awarded();
    if (declare) arm(host, order(host));
    host.state = { ...host.state, config: { ...host.state.config, matchDurationMs: BOUNDARY + 10 } };
    readProjection(host, "alpha", BOUNDARY + 10);
    expect(projectForTeam(host.state, "alpha").lightning?.status).toBe(declare ? "spent" : "unused-expired");
    expect(validateOp(host.state, "alpha", { kind: "declare-lightning", contractId: "alpha-c1" }).ok).toBe(false);
    expect(tick(copy(host.state), BOUNDARY + 1000).endgameLightning).toEqual(host.state.endgameLightning);
  }
});

test("a boundary operation fixes recipients before its score change; a DUEL is excluded while its boundary result still affects rank", () => {
  const host = match({ alpha: 200, bravo: 210 }); readProjection(host, "alpha", MINUTE);
  const target = order(host, "cipher"), atBoundary = tick(copy(host.state), BOUNDARY);
  expect(submitOp(host, "alpha", answer(host, target, "cipher"), BOUNDARY).kind).toBe("ok");
  expect(host.state.endgameLightning).toEqual(atBoundary.endgameLightning);
  expect(projectForTeam(host.state, "alpha").lightning?.status).toBe("available");
  const source = buildScenario("rps-reuse").host.state;
  const duel = source.contracts.find(c => c.status === "open" && c.task.kind === "rps-duel")!;
  const boundary = duel.expiresAtMs;
  const state = { ...source, config: { ...source.config, phaseBoundaries: { ...source.config.phaseBoundaries, pressureToEndgameMs: boundary - source.startedAtMs! } }, endgameLightning: { status: "pending" as const } };
  const direct = tick(state, boundary), late = tick(copy(state), boundary + 30_000);
  expect(late.endgameLightning).toEqual(direct.endgameLightning);
  const minimum = Math.min(...Object.values(direct.teams).map(t => t.score));
  const actual = direct.endgameLightning;
  expect(actual?.status).toBe("awarded");
  if (actual?.status !== "awarded") throw new Error("not awarded");
  expect(Object.keys(actual.cards).sort()).toEqual(Object.values(direct.teams).filter(t => t.score === minimum).map(t => t.teamId).sort());
  const normal = awarded(), liveDuel = order(normal, "duel");
  expect(submitOp(normal, "alpha", { kind: "declare-lightning", contractId: liveDuel.id }, BOUNDARY).kind).toBe("rejected");
});

test("v8 migration preserves Vigenere failures, compact HUNT/RPS state and booster; unknown old answers stay ineligible", () => {
  const live = awarded(), target = order(live, "cipher"), correct = answer(live, target, "cipher");
  if (correct.kind !== "cipher") throw new Error("missing cipher");
  expect(submitOp(live, "alpha", { ...correct, answer: [String((Number(correct.answer[0]) + 1) % 6)] }, BOUNDARY).kind).toBe("ok");
  const old = (state: CryptoBattleState) => {
    const { endgameLightning: _l, ...rest } = copy(state);
    return { ...rest, contracts: rest.contracts.map(({ answerAttempted: _a, ...c }) => c) } as CryptoBattleState;
  };
  const original = old(live.state), bytes = JSON.stringify(original), lifted = migrateState(original, 8);
  expect(JSON.stringify(original)).toBe(bytes);
  expect(lifted.endgameLightning).toEqual({ status: "unavailable" });
  expect(lifted.endgameBooster).toEqual(original.endgameBooster);
  expect(lifted.publicLedger).toEqual(original.publicLedger);
  expect(lifted.huntAttempts).toEqual(original.huntAttempts);
  expect(lifted.contracts).toEqual(original.contracts);
  expect(lifted.teams).toEqual(original.teams);
  expect(projectForTeam(lifted, "alpha").lastCipher?.outcome).toBe("miss");
  live.state = lifted;
  expect(submitOp(live, "alpha", correct, BOUNDARY + 1).kind).toBe("ok");
  expect(projectForTeam(live.state, "alpha").lastCipher?.points).toBe(0);
  const pre = match(); readProjection(pre, "alpha", MINUTE);
  pre.state = migrateState(old(pre.state), 8);
  const ids = pre.state.contracts.map(c => c.id);
  readProjection(pre, "alpha", BOUNDARY);
  expect(projectForTeam(pre.state, "alpha").lightning?.status).toBe("available");
  for (const c of projectForTeam(pre.state, "alpha").myContracts.filter(c => ids.includes(c.id))) expect(c.lightningEligible).toBe(false);
  readProjection(pre, "alpha", BOUNDARY + MINUTE);
  expect(projectForTeam(pre.state, "alpha").myContracts.some(c => c.lightningEligible)).toBe(true);
  const rps = buildScenario("rps-reuse").host;
  const pending = projectForTeam(rps.state, "alpha").rpsHunt!.targets[0]!;
  expect(submitOp(rps, "alpha", { kind: "hunt-rps", targetTeamId: "bravo", duelId: pending.duelId, predictedHand: 2 }, rps.state.nowMs!).kind).toBe("ok");
  const legacyRps = old(rps.state), migratedRps = migrateState(legacyRps, 8);
  expect(Object.keys(legacyRps.huntAttempts).length).toBeGreaterThan(0);
  expect(migratedRps.huntAttempts).toEqual(legacyRps.huntAttempts);
  expect(migratedRps.contracts).toEqual(legacyRps.contracts);
  expect(projectForTeam(migratedRps, "alpha").rpsHunt?.pending).toEqual(projectForTeam(legacyRps, "alpha").rpsHunt?.pending);
});

test("real card uses the selected Order, submits through the host, and ages without claiming a local verdict", async () => {
  const host = awarded(), target = order(host, "cipher"), before = projectForTeam(host.state, "alpha");
  for (const locale of ["ja", "en"] as const) {
    const html = renderToStaticMarkup(createElement(Lightning, { projection: before, order: target, locale, onDeclare: () => {} }));
    expect(html).toContain(target.id.replace(/^.*-c/, "ORDER #"));
    expect(html).toContain(`+${target.points * 2}`);
    expect(html).toContain("PROVE・CIPHER・FHE・MPC".replaceAll("・", locale === "ja" ? "・" : ", "));
    expect(html).toContain(locale === "ja" ? "このお題へ指定" : "Declare for this Order");
  }
  const duelHtml = renderToStaticMarkup(createElement(Lightning, { projection: before, order: order(host, "duel"), locale: "ja", onDeclare: () => {} }));
  expect(duelHtml).toContain("じゃんけんの勝敗点");
  expect(duelHtml).not.toContain("<button");
  let submitted: unknown;
  const client = { submitOp: async (op: CryptoBattleOp) => { submitted = op; return submitOp(host, "alpha", op, BOUNDARY); } };
  await submitDeclareLightning(client as never, target.id);
  expect(submitted).toEqual({ kind: "declare-lightning", contractId: target.id });
  const armed = projectForTeam(host.state, "alpha");
  expect(isCryptoBattleProjection(armed)).toBe(true);
  const otherOrder = order(host, "fhe");
  const html = renderToStaticMarkup(createElement(Lightning, { projection: armed, order: otherOrder, locale: "ja", onSelect: () => {} }));
  expect(html).toContain("指定したお題へ戻る"); expect(html).toContain("誤答後も期限内");
  expect(html).not.toContain("このお題へ指定 ·");
  const aged = ageProjection(armed, target.remainingMs)!;
  expect(aged.lightning?.status).toBe("armed"); expect(aged.lightning?.remainingMs).toBe(0);
  const expiredHtml = renderToStaticMarkup(createElement(Lightning, { projection: aged, order: otherOrder, locale: "ja", onSelect: () => {} }));
  expect(expiredHtml).toContain("裁定結果を更新中"); expect(expiredHtml).toContain("disabled");
  for (const bad of [null, {}, { ...armed.lightning, status: "other" }, { ...armed.lightning, remainingMs: -1 }, { ...armed.lightning, contractId: null }, { ...armed.lightning, points: "60" }, { ...armed.lightning, status: "spent", outcome: "unknown" }]) expect(isCryptoBattleProjection({ ...armed, lightning: bad })).toBe(false);
  const { lightning: _mixed, ...mixed } = armed;
  expect(isCryptoBattleProjection(mixed)).toBe(true);
  expect(renderToStaticMarkup(createElement(Lightning, { projection: mixed, order: target, locale: "ja" }))).toBe("");
});

test("malformed stored cards fail closed and an opposing team cannot arm another team's Order", () => {
  const host = awarded(), target = order(host);
  expect(submitOp(host, "bravo", { kind: "declare-lightning", contractId: target.id }, BOUNDARY).kind).toBe("rejected");
  for (const distribution of [null, {}, { status: "awarded", cards: [] }, { status: "awarded", cards: { outsider: { status: "available" } } }, { status: "awarded", cards: { alpha: { status: "armed", contractId: "bravo-c1", points: 60, expiresAtMs: 1000 } } }]) {
    expect(() => projectForTeam({ ...host.state, endgameLightning: distribution } as never, "alpha")).toThrow();
  }
});


test("the multiplier follows configured standard and rush values, without changing the base prices", () => {
  const host = match();
  host.state = { ...host.state, config: { ...host.state.config, scores: { ...host.state.config.scores, contract: 41, rushContract: 59 } } };
  readProjection(host, "alpha", BOUNDARY);
  for (const kind of ["standard", "rush"] as const) {
    const fork = { ...host, state: copy(host.state) };
    const c = projectForTeam(fork.state, "alpha").myContracts.find(c => c.status === "open" && c.kind === kind && c.lightningEligible)!;
    expect(c).toBeDefined();
    const method = c.allowedMethods.find(m => ["prove", "cipher", "fhe", "mpc"].includes(m)) as "prove" | "cipher" | "fhe" | "mpc";
    arm(fork, c);
    const before = fork.state.teams.alpha!.score;
    expect(submitOp(fork, "alpha", answer(fork, c, method), BOUNDARY + 1).kind).toBe("ok");
    expect(fork.state.teams.alpha!.score - before).toBe((kind === "rush" ? 59 : 41) * 2);
    expect(fork.state.config.scores).toEqual(host.state.config.scores);
  }
});
