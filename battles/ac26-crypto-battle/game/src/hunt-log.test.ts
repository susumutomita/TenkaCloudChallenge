import { huntKey } from "./hunt-key.ts";
import { expandSuccessfulHunts } from "./hunt-success.ts";
import { expect, test } from "bun:test";
import { createMatch, submitOp } from "../../dev/host.ts";
import { appendRsaHunt, decodeHuntLog } from "./hunt-log.ts";
import { buildReplay } from "./replay.ts";
import { applyOp, initialState, migrateState, projectForTeam, tick } from "./reducer.ts";
import type { CryptoBattleState, HuntLogEntry } from "./types.ts";

const checkpoint = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("real RSA successes retain identities, generation and exact times through two ROTATEs and replay", () => {
  const host = createMatch({
    eventId: "rsa-replay",
    teamIds: ["a|b", "a", "b"],
    matchSecret: "synthetic-rsa-replay",
  });
  const start = 61 * 60_000;
  host.state = tick(host.state, start);
  const expected: HuntLogEntry[] = [];
  for (let generation = 1; generation <= 3; generation++) {
    const at = start + (generation - 1) * 180_001;
    const key = projectForTeam(host.state, "a").publicRsaKeys!.find((k) => k.teamId === "b")!;
    const p = [3, 5, 7, 11, 13].find((n) => key.n % n === 0)!;
    for (const [attacker, offset] of [
      ["a", 0],
      ["a|b", 64_001],
    ] as const) {
      const op = {
        kind: "hunt-rsa" as const,
        targetTeamId: "b",
        generation,
        p: String(p),
        q: String(key.n / p),
      };
      expect(submitOp(host, attacker, op, at + offset).kind).toBe("ok");
      expected.push({
        attackerTeamId: attacker,
        targetTeamId: "b",
        generation,
        atMs: at + offset,
        via: "rsa",
      });
      const before = checkpoint(host.state);
      expect(submitOp(host, attacker, op, at + offset).kind).toBe("rejected");
      expect(host.state).toEqual(before);
    }
    host.state = checkpoint(host.state);
    if (generation < 3)
      expect(submitOp(host, "b", { kind: "rotate" }, at + 64_002).kind).toBe("ok");
  }
  expect(host.state.successfulHunts).not.toContain("r2:1");
  expect(decodeHuntLog(host.state)).toEqual(expected);
  const replay = buildReplay(checkpoint(host.state)).filter((e) => e.kind === "hunt-success");
  expect(replay.map((e) => ({ atMs: e.atMs, attackerTeamId: e.teamId, ...e.detail }))).toEqual(
    expected,
  );
  for (const event of replay) {
    expect(event.summary.en).toContain("RSA modulus");
    expect(event.summary.ja).toContain("RSA の公開 n");
  }
  const publicView = JSON.stringify(projectForTeam(host.state, "a"));
  expect(publicView).not.toContain('"huntLog"');
  expect(publicView).not.toContain('"rsa":[');
});

test("packed timestamps expand sparse roster slots and width changes without losing legacy audit entries", () => {
  let state = initialState({
    eventId: "log-codec",
    teamIds: ["😀", "a|b", "a", "z"],
    matchSecret: "synthetic",
  });
  const legacy: HuntLogEntry[] = [
    { attackerTeamId: "a", targetTeamId: "z", generation: 1, atMs: 1 },
    { attackerTeamId: "z", targetTeamId: "a", generation: 1, atMs: 2, via: "sudoku" },
  ];
  state = { ...state, huntLog: legacy };
  const expected = [...legacy];
  for (const [attacker, atMs] of [
    ["😀", 1_788_595_200_100],
    ["a|b", 1_788_595_463_101],
    ["a", 1_788_595_200_099],
  ] as const) {
    state = { ...state, nowMs: atMs };
    state = { ...state, huntLog: appendRsaHunt(state, attacker, "z", 7) };
    expected.push({ attackerTeamId: attacker, targetTeamId: "z", generation: 7, atMs, via: "rsa" });
  }
  state = checkpoint({
    ...state,
    teams: Object.fromEntries(Object.entries(state.teams).reverse()),
  });
  expect(decodeHuntLog(state)).toEqual(expected.sort((a, b) => a.atMs - b.atMs));
  expect(state.huntLog.slice(0, 2)).toEqual(legacy);
  expect(() => appendRsaHunt(state, "a", "z", 7)).toThrow("already recorded");
  const block = state.huntLog.at(-1)!;
  if (!("rsa" in block)) throw new Error("expected packed RSA log");
  expect(block.rsa[3]).toBe(4);
  expect(() => decodeHuntLog({ ...state, huntLog: [{ rsa: [3, 7, 0, 1, "!"] }] })).toThrow();
});

test("old reservations alone never invent an RSA timestamp during migration or replay", () => {
  const base = initialState({ eventId: "old-rsa", teamIds: ["a", "b"], matchSecret: "synthetic" });
  const legacy = { ...base, successfulHunts: ["r1:1"], huntLog: [] };
  expect(buildReplay(checkpoint(legacy))).toEqual([]);
  const lifted = migrateState(checkpoint(legacy), 9);
  expect(expandSuccessfulHunts(lifted)).toEqual(legacy.successfulHunts);
  expect(lifted.huntLog).toEqual([]);
});

test("schema11 compacts timestamped share and sudoku successes while preserving an unknown-time legacy guard", async () => {
  const { huntKey } = await import("./hunt-key.ts");
  const { hasRecordedHunt, compactRecordedHunts } = await import("./hunt-log.ts");
  const base = applyOp(tick(initialState({ eventId: "mixed-hunt-log", teamIds: ["a|b", "a", "b"], matchSecret: "synthetic" }), 0), "a", { kind: "start" });
  const known: HuntLogEntry[] = [
    { attackerTeamId: "a", targetTeamId: "b", generation: 1, atMs: 100 },
    { attackerTeamId: "a|b", targetTeamId: "b", generation: 1, atMs: 262245 },
    { attackerTeamId: "a", targetTeamId: "b", generation: 1, atMs: 262246, via: "sudoku" },
  ];
  const unknown = huntKey("b", "a", 1);
  const legacy = { ...base, huntLog: known, successfulHunts: [unknown, huntKey("a", "b", 1), huntKey("a|b", "b", 1), JSON.stringify(["sudoku", "a", "b", 1])] };
  const before = checkpoint(legacy);
  const lifted = migrateState(checkpoint(legacy), 10);
  expect(decodeHuntLog(lifted)).toEqual(known);
  expect(expandSuccessfulHunts(lifted)).toEqual([unknown]);
  expect(compactRecordedHunts(lifted)).toEqual({ huntLog: lifted.huntLog, successfulHunts: lifted.successfulHunts });
  expect(hasRecordedHunt(lifted, "a", "b", 1, "share")).toBe(true);
  expect(hasRecordedHunt(lifted, "a", "b", 1, "sudoku")).toBe(true);
  expect(hasRecordedHunt(lifted, "a|b", "b", 1, "sudoku")).toBe(false);
  expect(hasRecordedHunt(lifted, "a", "b", 1, "rotor")).toBe(false);
  expect(hasRecordedHunt(lifted, "b", "a", 1, "share")).toBe(false);
  expect(legacy).toEqual(before);
  const reversed = checkpoint({ ...lifted, teams: Object.fromEntries(Object.entries(lifted.teams).reverse()) });
  expect(decodeHuntLog(reversed)).toEqual(known);
  expect(projectForTeam(reversed, "a").completedHunts).toContainEqual({ targetTeamId: "b", generation: 1, via: "share" });
  expect(projectForTeam(reversed, "b").completedHunts).toContainEqual({ targetTeamId: "a", generation: 1, via: "share" });
  const { validateOp } = await import("./reducer.ts");
  const running = tick(reversed, 262246);
  // Both a timestamped success and an old guard-only success retain replay rejection.
  const knownOp = { kind: "hunt" as const, targetTeamId: "b", generation: 1, recoveredSecret: running.teams.b!.secret };
  expect(validateOp(running, "a", knownOp).ok).toBe(false);
  expect(validateOp({ ...running, huntLog: [], successfulHunts: [] }, "a", knownOp).ok).toBe(true);
  expect(validateOp(running, "b", { kind: "hunt", targetTeamId: "a", generation: 1, recoveredSecret: running.teams.a!.secret }).ok).toBe(false);
});


test("arbitrary legacy ties keep the exact replay insertion order instead of being silently reordered", () => {
  const base = initialState({eventId:"audit-ties",teamIds:["a","b","c"],matchSecret:"synthetic"});
  const huntLog = [
    {attackerTeamId:"a",targetTeamId:"b",generation:1,atMs:1},
    {attackerTeamId:"b",targetTeamId:"a",generation:1,atMs:1},
    {attackerTeamId:"c",targetTeamId:"a",generation:1,atMs:2},
    {attackerTeamId:"c",targetTeamId:"b",generation:1,atMs:2},
  ];
  const old = {...base,huntLog,successfulHunts:huntLog.map(e=>huntKey(e.attackerTeamId,e.targetTeamId,e.generation))};
  const lifted=migrateState(checkpoint(old),10);
  expect(decodeHuntLog(lifted)).toEqual(huntLog);
  expect(buildReplay(lifted)).toEqual(buildReplay(old));
  expect(lifted.huntLog).toEqual(old.huntLog);
  expect(lifted.successfulHunts).toEqual([]);
});
