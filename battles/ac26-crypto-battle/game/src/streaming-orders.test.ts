import { expect, test } from "bun:test";
import { initialState, applyOp, tick, projectForTeam, validateOp, migrateState, STREAMING_ORDER_CONFIG } from "./reducer.ts";
const create = () => tick(applyOp(initialState({ eventId: "streaming", teamIds: ["a", "b"], matchSecret: "streaming-test" }, { ...STREAMING_ORDER_CONFIG, orderArrivalJitterMs: 0 }), "a", { kind: "start" }), 0);
test("orders arrive individually every 30s, have 180s deadlines and expire exactly once", () => {
  let state = create();
  expect(projectForTeam(state, "a").myContracts).toHaveLength(1);
  state = tick(state, 29_999);
  expect(projectForTeam(state, "a").myContracts).toHaveLength(1);
  state = tick(state, 30_000);
  expect(projectForTeam(state, "a").myContracts).toHaveLength(2);
  const first = state.contracts.find(c => c.teamId === "a")!;
  expect(first.expiresAtMs - first.issuedAtMs).toBe(180_000);
  expect(validateOp(tick(state, 179_999), "a", { kind: "leak", contractId: first.id })).toEqual({ ok: true });
  state = tick(state, 180_000);
  expect(validateOp(state, "a", { kind: "leak", contractId: first.id }).ok).toBe(false);
  expect(tick(state, 179_000)).toBe(state);
  expect(JSON.stringify(tick(state, 180_000))).toBe(JSON.stringify(state));
  expect(projectForTeam(state, "a").clockMs).toBe(180_000);
  expect(state.contracts.filter(c => c.teamId === "a" && c.status === "open")).toHaveLength(3);
});
test("long-running order rotation preserves earned points apart from explicit expiry penalties", () => {
  let state = create();
  // Isolate the reported loss-on-pruning claim from the explicit missed-order penalty.
  state = { ...state, config: { ...state.config, scores: { ...state.config.scores, expiredOrder: 0 } } };
  state = applyOp(state, "a", { kind: "leak", contractId: "a-c0" });
  const earned = state.teams.a!.score;
  for (let time = 30_000; time <= 30 * 60_000; time += 30_000) state = tick(state, time);
  expect(state.contracts.some(c => c.id === "a-c0")).toBe(false);
  expect(state.teams.a!.score).toBe(earned);
});
test("99-team streaming match retains accepted history within the declared SQL budget", () => {
  const teamIds = Array.from({length: 99}, (_, i) => `team-${i}`);
  let state = applyOp(initialState({ eventId: "streaming-capacity", teamIds, matchSecret: "streaming-test" }, STREAMING_ORDER_CONFIG), teamIds[0]!, {kind: "start"});
  let peak = 0;
  for (let time = 0; time <= 90 * 60_000; time += 30_000) {
    state = tick(state, time);
    for (const contract of state.contracts.filter(c => c.status === "open")) {
      const op = {kind: "leak" as const, contractId: contract.id};
      if (validateOp(state, contract.teamId, op).ok) state = applyOp(state, contract.teamId, op);
    }
    peak = Math.max(peak, new TextEncoder().encode(JSON.stringify(state)).length);
  }
  expect(peak).toBeLessThan(3 * 1024 * 1024);
  expect(state.teams[teamIds[0]!]!.score).toBeGreaterThanOrEqual(0);
}, 120_000);

test("new matches vary arrivals fairly and preserve the schedule across delayed ticks", () => {
  const start = () => tick(applyOp(initialState({eventId:"jitter",teamIds:["a","b"],matchSecret:"jitter-test"}, { ...STREAMING_ORDER_CONFIG, maxOpenOrdersPerTeam: undefined }), "a", {kind:"start"}), 0);
  let state = start();
  const gaps: number[] = [];
  for (let i=0;i<12;i++) {
    const at=state.nextContractAtMs!;
    const before=state.contracts.filter(c=>c.teamId==="a").at(-1)!;
    gaps.push(at-before.issuedAtMs);
    state=tick(state,at);
    const a=state.contracts.filter(c=>c.teamId==="a").at(-1)!;
    const b=state.contracts.filter(c=>c.teamId==="b").at(-1)!;
    expect(a.issuedAtMs).toBe(b.issuedAtMs);
    expect(a.expiresAtMs-a.issuedAtMs).toBe(180_000);
  }
  expect(gaps.every(gap=>gap>=20_000&&gap<=40_000)).toBe(true);
  expect(new Set(gaps).size).toBeGreaterThan(1);
  const delayed=tick(start(),state.nowMs!);
  expect(delayed.nextContractAtMs).toBe(state.nextContractAtMs);
  expect(delayed.contracts.map(c=>[c.id,c.issuedAtMs,c.expiresAtMs])).toEqual(state.contracts.map(c=>[c.id,c.issuedAtMs,c.expiresAtMs]));
});


test("three open Orders cap each team independently and skipped slots never create expiry debt", () => {
  let state = create();
  state = tick(state, 60_000);
  const open = (id: string) => state.contracts.filter(c => c.teamId === id && c.status === "open");
  expect(open("a")).toHaveLength(3);
  state = applyOp(state, "a", { kind: "leak", contractId: "a-c0" });
  const earned = state.teams.a!.score;
  state = tick(state, 90_000);
  expect(open("a")).toHaveLength(3);
  expect(open("b")).toHaveLength(3);
  expect(state.contracts.some(c => c.id === "a-c3")).toBe(true);
  expect(state.contracts.some(c => c.id === "b-c3")).toBe(false);
  state = tick(state, 120_000);
  expect(state.teams.a!.score).toBe(earned);
  expect(state.contracts.some(c => c.id === "a-c4" || c.id === "b-c4")).toBe(false);
  state = tick(state, 180_000);
  expect(open("a").length).toBeLessThanOrEqual(3);
  expect(open("b").length).toBeLessThanOrEqual(3);
  // Team a is still full, so a paired duel is not issued to team b alone.
  expect(state.contracts.some(c => c.task.kind === "rps-duel")).toBe(false);
  expect(state.teams.a!.score).toBe(earned);
  const snapshot = JSON.stringify(state);
  expect(JSON.stringify(tick(state, 180_000))).toBe(snapshot);
});

test("a delayed tick never overfills the queue and old unlimited configurations remain unlimited", () => {
  const capped = tick(create(), 150_000);
  expect(capped.contracts.filter(c => c.teamId === "a" && c.status === "open")).toHaveLength(3);
  const initial = create();
  const old = tick({ ...initial, config: { ...initial.config, maxOpenOrdersPerTeam: undefined } }, 150_000);
  expect(old.contracts.filter(c => c.teamId === "a" && c.status === "open")).toHaveLength(6);
});


test("batch Orders cannot consume a counterpart's reserved duel capacity",()=>{
 let state=create();const b=state.contracts.find(c=>c.teamId==='b')!;
 state={...state,config:{...state.config,contractsPerIssue:2},
   contracts:[...state.contracts,{...b,id:'b-c4'}],
   teams:{...state.teams,a:{...state.teams.a!,issuedOrderCount:5},b:{...state.teams.b!,issuedOrderCount:5}}};
 state=tick(state,30_000);
 expect(state.contracts.some(c=>c.task.kind==='rps-duel')).toBe(false);
 expect(state.contracts.filter(c=>c.teamId==='a'&&c.status==='open')).toHaveLength(2);
 expect(state.contracts.filter(c=>c.teamId==='b'&&c.status==='open')).toHaveLength(3);
});

test("v21 rows retain their unlimited queue during v22 migration",()=>{
 const initial=create();const old={...initial,config:{...initial.config,maxOpenOrdersPerTeam:undefined}};
 const upgraded=migrateState(JSON.parse(JSON.stringify(old)),21);
 expect(upgraded.config.maxOpenOrdersPerTeam).toBeUndefined();
 expect(upgraded.contracts).toEqual(old.contracts);
 expect(()=>migrateState(old,22)).toThrow();
});
