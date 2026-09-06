import { expect, test } from "bun:test";
import { createMatch, submitOp } from "../../dev/host.ts";
import { appendRsaHunt, decodeHuntLog } from "./hunt-log.ts";
import { buildReplay } from "./replay.ts";
import { initialState, migrateState, projectForTeam, tick } from "./reducer.ts";
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
  expect(lifted.successfulHunts).toEqual(legacy.successfulHunts);
  expect(lifted.huntLog).toEqual([]);
});
