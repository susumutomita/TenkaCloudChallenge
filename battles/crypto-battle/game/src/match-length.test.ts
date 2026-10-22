import { describe, expect, test } from "bun:test";
import { applyOp, initialState, migrateState, projectForTeam, STREAMING_ORDER_CONFIG, tick, validateOp } from "./reducer.ts";
import { buildReplay } from "./replay.ts";
import type { CoordinationContext, CryptoBattleState } from "./types.ts";

const MIN = 60_000;
const TEAMS = ["alpha", "bravo"];
const ctx = (extra: Partial<CoordinationContext> = {}): CoordinationContext =>
  ({ eventId: "match-length", teamIds: TEAMS, matchSecret: "match-length-secret", ...extra });
const create = (extra: Partial<CoordinationContext> = {}) => initialState(ctx(extra), STREAMING_ORDER_CONFIG);
const start = (state: CryptoBattleState) => applyOp(state, "alpha", { kind: "start" });
const view = (state: CryptoBattleState) => [state.phase, projectForTeam(state, "alpha").matchRemainingMs];
const openOrders = (state: CryptoBattleState) => state.contracts.filter((c) => c.status === "open");

function leakAll(state: CryptoBattleState, teamId: string): CryptoBattleState {
  for (const order of openOrders(state).filter((c) => c.teamId === teamId)) {
    const op = { kind: "leak" as const, contractId: order.id };
    if (validateOp(state, teamId, op).ok) state = applyOp(state, teamId, op);
  }
  return state;
}

describe("the platform's match length", () => {
  test("10 minutes run three equal phases and count down from 10:00", () => {
    let state = start(create({ matchDurationMs: 10 * MIN }));
    expect(view(state)).toEqual(["build", 600_000]);
    const at = (ms: number) => view((state = tick(state, ms, { matchDurationMs: 10 * MIN })));
    expect(at(199_999)).toEqual(["build", 400_001]);
    expect(at(200_000)).toEqual(["pressure", 400_000]);
    expect(at(400_000)).toEqual(["endgame", 200_000]);
    expect(projectForTeam(state, "alpha").hintBooster).toEqual({ status: "active", startAfterMs: 400_000, startsInMs: 0, remainingMs: 200_000 });
    expect(projectForTeam(state, "alpha").lightning?.startAfterMs).toBe(400_000);
    expect(at(600_000)).toEqual(["ended", 0]);
    expect(validateOp(state, "alpha", { kind: "rotate" })).toEqual({ ok: false, error: "match has ended" });
    expect(buildReplay(state).filter((e) => e.kind === "phase-change").map((e) => [e.atMs, e.detail])).toEqual([
      [200_000, { phase: "pressure" }],
      [400_000, { phase: "endgame" }],
      [600_000, { phase: "ended" }],
    ]);
  });

  test("90 minutes from the event start plays exactly like no report", () => {
    const length = { matchDurationMs: 90 * MIN };
    let plain = start(create());
    let timed = start(create(length));
    expect(timed.platformMatchDurationMs).toBe(5_400_000);
    for (let at = 0; at <= 91 * MIN; at += 20_000) {
      plain = tick(plain, at);
      timed = tick(timed, at, length);
      if (at % MIN === 0) {
        plain = leakAll(plain, "alpha");
        timed = leakAll(timed, "alpha");
      }
      const { platformMatchDurationMs: _reported, ...rest } = timed;
      expect(JSON.stringify(rest)).toBe(JSON.stringify(plain));
      for (const team of TEAMS) expect(projectForTeam(timed, team)).toEqual(projectForTeam(plain, team));
    }
    expect(plain.phase).toBe("ended");
  });

  test("no report keeps today's 90 minutes and adds nothing to the state", () => {
    const added = (state: CryptoBattleState) => Object.keys(state).filter((key) => key.startsWith("platform") || key.startsWith("matchDuration"));
    expect(added(create({ matchDurationMs: 10 * MIN }))).toEqual(["platformMatchDurationMs"]);
    const waiting = create();
    expect(added(waiting)).toEqual([]);
    expect(projectForTeam(waiting, "alpha").matchRemainingMs).toBe(5_400_000);
    const state = start(waiting);
    expect(JSON.stringify(tick(state, 30_000, {}))).toBe(JSON.stringify(tick(state, 30_000)));
    expect(JSON.stringify(tick(state, 30_000, { matchDurationMs: undefined }))).toBe(JSON.stringify(tick(state, 30_000)));
  });

  test("a length outside 5..240 minutes keeps the one in force and records why", () => {
    const state = create({ matchDurationMs: 10 * MIN });
    for (const [value, reason] of [
      [5 * MIN - 1, "out-of-range"],
      [240 * MIN + 1, "out-of-range"],
      [-1, "out-of-range"],
      [Number.NaN, "not-a-number"],
      [Number.POSITIVE_INFINITY, "not-a-number"],
      ["600000", "not-a-number"],
      [null, "not-a-number"],
    ] as const) {
      const next = tick(state, 0, { matchDurationMs: value as unknown as number });
      expect([next.config.matchDurationMs, next.platformMatchDurationMs, next.matchDurationRejection]).toEqual([600_000, 600_000, reason]);
      expect(JSON.stringify(projectForTeam(next, "alpha"))).not.toContain(reason);
    }
    expect(tick(state, 0, { matchDurationMs: 5 * MIN }).config.matchDurationMs).toBe(300_000);
    expect(tick(state, 0, { matchDurationMs: 240 * MIN }).config.matchDurationMs).toBe(14_400_000);
    const refused = tick(state, 0, { matchDurationMs: 0 });
    const accepted = tick(refused, 1_000, { matchDurationMs: 20 * MIN });
    expect([accepted.matchDurationRejection, accepted.config.matchDurationMs]).toEqual([undefined, 1_200_000]);
    const unknown = create({ matchDurationMs: 1 });
    expect([unknown.config.matchDurationMs, unknown.platformMatchDurationMs, unknown.matchDurationRejection]).toEqual([5_400_000, undefined, "out-of-range"]);
  });

  test("a length reported after creation ends the match on the platform's clock, however late START is", () => {
    let state = tick(create(), 0, {});
    expect(projectForTeam(state, "alpha").matchRemainingMs).toBe(5_400_000);
    state = tick(state, 20_000, { matchDurationMs: 10 * MIN });
    expect(projectForTeam(state, "alpha").matchRemainingMs).toBe(580_000);
    state = start(tick(state, 30_000, { matchDurationMs: 10 * MIN }));
    expect([state.config.matchDurationMs, state.config.phaseBoundaries]).toEqual([570_000, { buildToPressureMs: 190_000, pressureToEndgameMs: 380_000 }]);
    expect(view(state)).toEqual(["build", 570_000]);
    expect(view(tick(state, 599_999, { matchDurationMs: 10 * MIN }))).toEqual(["endgame", 1]);
    expect(view(tick(state, 600_000, { matchDurationMs: 10 * MIN }))).toEqual(["ended", 0]);
  });

  test("lengthening during the build phase moves the boundaries and the countdown from that tick", () => {
    let state = tick(start(create({ matchDurationMs: 10 * MIN })), 125_000, { matchDurationMs: 10 * MIN });
    expect(view(state)).toEqual(["build", 475_000]);
    state = tick(state, 130_000, { matchDurationMs: 20 * MIN });
    expect(view(state)).toEqual(["build", 1_070_000]);
    expect(state.config.phaseBoundaries).toEqual({ buildToPressureMs: 400_000, pressureToEndgameMs: 800_000 });
  });

  test("shortening past the endgame boundary starts the endgame at that tick and pulls deadlines in", () => {
    let state = start(create({ matchDurationMs: 90 * MIN }));
    for (let at = 0; at <= 8 * MIN; at += 10_000) state = tick(state, at, { matchDurationMs: 90 * MIN });
    const before = openOrders(state).map((c) => [c.id, c.issuedAtMs]);
    state = tick(state, 8 * MIN, { matchDurationMs: 10 * MIN });
    expect(view(state)).toEqual(["endgame", 120_000]);
    expect(state.config.phaseBoundaries).toEqual({ buildToPressureMs: 480_000, pressureToEndgameMs: 480_000 });
    expect(state.endgameBooster).toEqual({ status: "awarded", teamIds: ["alpha", "bravo"] });
    expect(openOrders(state).map((c) => [c.id, c.issuedAtMs])).toEqual(before);
    expect(openOrders(state).map((c) => c.expiresAtMs)).toEqual(before.map(([, issued]) => Math.min(Number(issued) + 180_000, 600_000)));
  });

  test("shortening to an end already passed ends the match at that tick, like any other end", () => {
    let state = start(create({ matchDurationMs: 90 * MIN }));
    for (let at = 0; at <= 8 * MIN; at += 10_000) {
      state = tick(state, at, { matchDurationMs: 90 * MIN });
      if (at % (2 * MIN) === 0) state = leakAll(state, "alpha");
    }
    expect([openOrders(state).map((c) => c.id), state.teams.alpha!.score]).toEqual([["alpha-c13", "bravo-c13", "bravo-c14", "bravo-c16"], 45]);
    state = tick(state, 8 * MIN, { matchDurationMs: 5 * MIN });
    expect(view(state)).toEqual(["ended", 0]);
    expect(openOrders(state)).toEqual([]);
    expect(state.teams.alpha!.score).toBe(30);
    expect(validateOp(state, "alpha", { kind: "rotate" })).toEqual({ ok: false, error: "match has ended" });
  });

  test("lengthening during the endgame keeps the endgame and gives Orders cut by the old end their full window", () => {
    let state = start(create({ matchDurationMs: 10 * MIN }));
    for (let at = 0; at <= 9 * MIN; at += 5_000) state = tick(state, at, { matchDurationMs: 10 * MIN });
    const cut = openOrders(state).find((c) => c.teamId === "alpha" && c.expiresAtMs === 600_000 && c.task.kind !== "rps-duel"
      && validateOp(state, "alpha", { kind: "declare-lightning", contractId: c.id }).ok);
    if (!cut) throw new Error("setup: expected an Order cut short by the end");
    state = applyOp(state, "alpha", { kind: "declare-lightning", contractId: cut.id });
    expect(projectForTeam(state, "alpha").hintBooster?.remainingMs).toBe(60_000);
    state = tick(state, 9 * MIN, { matchDurationMs: 20 * MIN });
    expect(view(state)).toEqual(["endgame", 660_000]);
    expect(state.config.phaseBoundaries).toEqual({ buildToPressureMs: 200_000, pressureToEndgameMs: 400_000 });
    expect(state.contracts.find((c) => c.id === cut.id)?.expiresAtMs).toBe(cut.issuedAtMs + 180_000);
    expect(state.endgameLightning?.status === "awarded" && state.endgameLightning.cards.alpha)
      .toEqual({ status: "armed", contractId: cut.id, points: cut.points * 2, expiresAtMs: cut.issuedAtMs + 180_000 });
    expect(projectForTeam(state, "alpha").hintBooster).toEqual({ status: "active", startAfterMs: 400_000, startsInMs: 0, remainingMs: 460_000 });
  });

  test("an ended match and a stale clock ignore the report", () => {
    const ended = tick(start(create({ matchDurationMs: 10 * MIN })), 600_000, { matchDurationMs: 10 * MIN });
    expect(JSON.stringify(tick(ended, 600_000, { matchDurationMs: 20 * MIN }))).toBe(JSON.stringify(tick(ended, 600_000)));
    const running = tick(start(create({ matchDurationMs: 10 * MIN })), 300_000, { matchDurationMs: 10 * MIN });
    expect(tick(running, 200_000, { matchDurationMs: 20 * MIN })).toBe(running);
  });

  test("the same timing history gives the same match at any polling cadence", () => {
    // The report changes at 9:00 to a length whose endgame boundary (8:00) a
    // sparse host's last earlier tick (7:30) has not reached yet.
    const changeAt = 9 * MIN, end = 12 * MIN;
    const lengthAt = (ms: number) => ({ matchDurationMs: ms < changeAt ? 20 * MIN : 12 * MIN });
    const gameplay = ({ nowMs: _clock, ...state }: CryptoBattleState) => state;
    const play = (times: readonly number[]) => {
      let state = start(create(lengthAt(0)));
      const checkpoints: ReturnType<typeof gameplay>[] = [];
      for (const at of times) {
        state = tick(state, at, lengthAt(at));
        if (at % (3 * MIN) === 0) {
          state = leakAll(leakAll(state, "alpha"), at % (6 * MIN) === 0 ? "bravo" : "alpha");
          checkpoints.push(gameplay(state));
        }
      }
      return checkpoints;
    };
    const every = (stepMs: number) => Array.from({ length: end / stepMs + 1 }, (_, i) => i * stepMs);
    let seed = 926;
    const irregular = new Set(every(3 * MIN));
    for (let at = 0; at < end; at += 1_000 + (seed % 60_000)) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      irregular.add(at);
    }
    const frequent = play(every(5_000));
    expect(play(every(90_000))).toEqual(frequent);
    expect(play([...irregular].sort((a, b) => a - b))).toEqual(frequent);
    const last = frequent.at(-1)!;
    expect([last.phase, last.config.matchDurationMs, last.config.phaseBoundaries]).toEqual(
      ["ended", 720_000, { buildToPressureMs: 400_000, pressureToEndgameMs: 540_000 }]);
  });

  test("a length change between two hosts' ticks gives the same match at any polling cadence", () => {
    // 9:01 is on the 5-second grid but not on the 90-second one.
    const changeAt = 9 * MIN + 1_000, end = 12 * MIN;
    const lengthAt = (ms: number) => ({ matchDurationMs: ms < changeAt ? 20 * MIN : 12 * MIN });
    const play = (stepMs: number) => {
      let state = start(create(lengthAt(0)));
      for (let at = 0; at <= end; at += stepMs) {
        state = tick(state, at, lengthAt(at));
        if (at % (3 * MIN) === 0) state = leakAll(leakAll(state, "alpha"), at % (6 * MIN) === 0 ? "bravo" : "alpha");
      }
      const { nowMs: _clock, ...gameplay } = state;
      return gameplay;
    };
    const frequent = play(5_000);
    expect(play(90_000)).toEqual(frequent);
    expect([frequent.phase, frequent.config.matchDurationMs]).toEqual(["ended", 720_000]);
  });

  test("an extension a sparse host first sees after the old end keeps the match open", () => {
    const lengthAt = (ms: number) => ({ matchDurationMs: ms < 9 * MIN + 30_000 ? 10 * MIN : 20 * MIN });
    const play = (stepMs: number) => {
      let state = start(create(lengthAt(0)));
      for (let at = 0; at <= 10 * MIN; at += stepMs) state = tick(state, at, lengthAt(at));
      return state;
    };
    const sparse = play(MIN);
    expect(view(sparse)).toEqual(["endgame", 600_000]);
    const { nowMs: _sparse, ...sparsePlay } = sparse;
    const { nowMs: _frequent, ...frequentPlay } = play(5_000);
    expect(sparsePlay).toEqual(frequentPlay);
  });

  test("a v23 row migrates unchanged and then follows a reported length", () => {
    const v23 = JSON.parse(JSON.stringify(tick(start(create()), 95_000)));
    const migrated = migrateState(v23, 23);
    expect(migrated).toEqual(v23);
    const followed = tick(migrated, 100_000, { matchDurationMs: 10 * MIN });
    expect([followed.config.matchDurationMs, projectForTeam(followed, "alpha").matchRemainingMs]).toEqual([600_000, 500_000]);
  });
});
