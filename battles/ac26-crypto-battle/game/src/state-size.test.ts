/** Default-config storage acceptance. Real operations exercise all mechanisms;
 * each route measures every transition, not only the final checkpoint. Routes
 * retain different legal choices: LEAK, reused Sudoku PROVE, and a generation
 * held long enough for Vigenère. No forecast is called an exact global maximum.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  playCapacityTrace,
  type CapacityRoute,
} from "./capacity-trace.fixture.ts";
import { decodeHuntLog } from "./hunt-log.ts";
import { expandSuccessfulHunts } from "./hunt-success.ts";
import { decodeLedger, encodeLedger } from "./ledger-codec.ts";
import { buildReplay } from "./replay.ts";
import {
  DEFAULT_CONFIG,
  projectForTeam,
  TERMINAL_ORDER_RETENTION_BATCHES,
  validateOp,
} from "./reducer.ts";
import { deriveCipherKey } from "./fixtures.ts";

const DDB_LIMIT = 400 * 1024,
  SQL_LIMIT = 4 * 1024 * 1024,
  HEADROOM = 0.75,
  MAX_TEAMS = 99;
const metadata = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "..", "metadata.json"), "utf8"),
);
const declared: { bytesPerTeam: number; baseBytes: number } =
  metadata.interTeamCoordination.stateBudget;
const forecast = (n: number) => declared.baseBytes + declared.bytesPerTeam * n;
const routes: readonly CapacityRoute[] = ["rapid-leak", "rapid-prove", "reuse"];
const cache = new Map<string, ReturnType<typeof playCapacityTrace>>();
function measured(n: number, route: CapacityRoute) {
  const key = `${n}:${route}`;
  const old = cache.get(key);
  if (old) return old;
  const value = playCapacityTrace(n, route);
  cache.set(key, value);
  if (n === 12 || n === 99)
    console.info(
      JSON.stringify({
        teams: n,
        route,
        peak: value.peak,
        final: value.final,
        pendingPeak: value.pendingPeak,
        transitions: value.transitions,
        successes: value.successes,
      }),
    );
  return value;
}
// The maximum trace now validates roughly a million state transitions, including
// 31 all-to-all Shamir/Caesar generations, timed RSA, Sudoku and every Order/RPS.
// This bounds the author computation, not any runtime request latency contract.
const FULL_TRACE_TIMEOUT_MS = 30 * 60_000;
const checkpoint = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function verifyRestoration(result: ReturnType<typeof playCapacityTrace>) {
  const { state, peakState, successes } = result;
  const ids = Object.keys(state.teams).sort();
  const log = decodeHuntLog(state);
  for (const method of ["share", "sudoku", "rotor", "rsa"] as const)
    expect(log.filter((e) => (e.via ?? "share") === method).length).toBe(
      successes[method],
    );
  const guards = expandSuccessfulHunts(state);
  for (const method of ["caesar", "vigenere"] as const)
    expect(
      guards.filter((key) => {
        const a = JSON.parse(key);
        return a[0] === "cipher" && a[4] === method;
      }).length,
    ).toBe(successes[method]);
  expect(
    new Set(
      log.map((e) =>
        JSON.stringify([
          e.attackerTeamId,
          e.targetTeamId,
          e.generation,
          e.via ?? "share",
        ]),
      ),
    ).size,
  ).toBe(log.length);
  // Both the in-flight pending peak and completed checkpoint cross the real
  // serialization/projection boundary. Old literal team IDs and object artifacts
  // remain readable beside the new tuples, without changing public values/order.
  for (const before of [peakState, state]) {
    const restored = checkpoint(before);
    expect(decodeHuntLog(restored)).toEqual(decodeHuntLog(before));
    const oldLedger = {
      ...restored,
      publicLedger: encodeLedger(
        decodeLedger(restored.publicLedger, restored.teams),
      ),
    };
    for (const id of [ids[0]!, ids.at(-1)!]) {
      expect(projectForTeam(restored, id)).toEqual(projectForTeam(before, id));
      expect(projectForTeam(oldLedger, id)).toEqual(projectForTeam(before, id));
    }
    // The chronological public debrief must retain every timestamped success.
    const replay = buildReplay(restored);
    expect(replay.filter((e) => e.kind === "hunt-success").length).toBe(
      decodeHuntLog(before).length,
    );
    expect(replay.map((e) => [e.atMs, e.kind, e.teamId, e.detail])).toEqual(
      buildReplay(oldLedger).map((e) => [e.atMs, e.kind, e.teamId, e.detail]),
    );
  }
  const attacker = ids[0]!,
    target = ids[1]!,
    generation = state.teams[target]!.generation;
  const op = {
    kind: "hunt-cipher" as const,
    targetTeamId: target,
    generation,
    rung: "caesar" as const,
    recoveredKey: deriveCipherKey(state.seed, target, generation, "caesar"),
  };
  // Reuse rotates after its last batch, so only the rapid traces have a success
  // on the final current generation. Test the actual repeat refusal, not a phase
  // refusal: the controls stay in the live endgame and clear only that guard.
  if (successes.caesar === 31 * ids.length * (ids.length - 1)) {
    expect(state.phase).toBe("endgame");
    expect(validateOp(checkpoint(state), attacker, op).ok).toBe(false);
    expect(validateOp({ ...state, successfulHunts: [] }, attacker, op)).toEqual(
      { ok: true },
    );
  }
}

describe("declared deployment bounds and actual transition peaks", () => {
  test("keeps the existing DDB12 / SQL99 admission model without inventing a physical cliff at13", () => {
    expect(declared).toEqual({ bytesPerTeam: 31 * 1024, baseBytes: 1536 });
    expect(
      Math.floor((DDB_LIMIT - declared.baseBytes) / declared.bytesPerTeam),
    ).toBe(12);
    expect(
      Math.min(
        MAX_TEAMS,
        Math.floor((SQL_LIMIT - declared.baseBytes) / declared.bytesPerTeam),
      ),
    ).toBe(99);
    expect(forecast(MAX_TEAMS)).toBeLessThanOrEqual(SQL_LIMIT * HEADROOM);
  });
  for (const n of [12, MAX_TEAMS])
    for (const route of routes)
      test(
        `${n} teams / ${route}: all accepted histories survive and every transition fits`,
        () => {
          const result = measured(n, route),
            pairs = n * (n - 1);
          expect(result.peak).toBeGreaterThanOrEqual(result.final);
          expect(result.peak).toBeLessThan(
            (n === 12 ? DDB_LIMIT : SQL_LIMIT) * HEADROOM,
          );
          expect(forecast(n)).toBeGreaterThanOrEqual(result.peak);
          expect(result.pendingPeak).toBe((n - (n % 2)) * (n - 1));
          if (route !== "reuse") {
            expect(result.rotations).toBe(n * 30);
            expect(result.successes.share).toBe(31 * pairs);
            expect(result.successes.caesar).toBe(31 * pairs);
            expect(result.successes.rotor).toBe(3 * pairs);
            expect(result.successes.rsa).toBe(11 * pairs);
            expect(result.rsaGenerations).toEqual(
              Array.from({ length: 11 }, (_, i) => 21 + i),
            );
          }
          if (route !== "rapid-leak")
            expect(result.successes.sudoku).toBeGreaterThan(0);
          if (route === "reuse") expect(result.successes.vigenere).toBe(pairs);
          verifyRestoration(result);
        },
        FULL_TRACE_TIMEOUT_MS,
      );
  test(
    "the same forecast covers supported small rosters and the retained work queue",
    () => {
      for (const n of [2, 4, 8, 9, 10, 11, 13])
        for (const route of routes) {
          const result = measured(n, route);
          expect(forecast(n)).toBeGreaterThanOrEqual(result.peak);
          if (n <= 12) expect(result.peak).toBeLessThan(DDB_LIMIT * HEADROOM);
          for (const id of Object.keys(result.state.teams)) {
            const count = result.state.contracts.filter(
              (c) => c.teamId === id,
            ).length;
            expect(count).toBeGreaterThan(0);
            expect(count).toBeLessThanOrEqual(
              DEFAULT_CONFIG.contractsPerIssue *
                (TERMINAL_ORDER_RETENTION_BATCHES + 2),
            );
          }
        }
    },
    FULL_TRACE_TIMEOUT_MS,
  );
});
