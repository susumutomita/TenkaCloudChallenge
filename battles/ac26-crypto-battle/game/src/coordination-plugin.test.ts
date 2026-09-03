/**
 * Coordination plugin wiring test (Issue #486 PR3, revised for the PR3
 * independent review).
 *
 * `../../coordination/crypto-battle.ts` is the file the platform dispatcher
 * actually loads (see its header for the full investigation into how). This
 * test drives its default export through the SDK's own host utilities
 * (`dispatchOp` / `runTick`, mocked below -- see this file's "stub" comment)
 * exactly as the dispatcher Lambda would, on top of the 121+ existing
 * `game/src` tests that already cover the underlying reducer/Shamir/Schnorr
 * logic exhaustively. It intentionally does not re-derive that coverage
 * (e.g. HUNT below reconstructs straight from `state.teams.red.shares`, the
 * same shortcut `reducer.test.ts`'s `initialState` "shares reconstruct the
 * secret" test uses -- ledger-sourced reconstruction already has its own
 * dedicated `reducer.test.ts` "hunt" coverage via its `leakThreshold`
 * helper).
 *
 * Two properties this file specifically pins down (Issue #486 PR3 review
 * findings, see reducer.ts / types.ts's "JSON-SAFETY INVARIANT" / "WIRE
 * BOUNDARY" comments for the underlying fix):
 *   - `CryptoBattleState` survives a real `JSON.stringify` / `JSON.parse`
 *     round-trip byte-for-byte, and stays usable afterward -- simulating the
 *     Turso / DynamoDB persistence the dispatcher actually round-trips state
 *     through between calls (a raw `bigint` anywhere in state would either
 *     throw on `JSON.stringify` (Turso) or silently lose precision through
 *     `Number` (DynamoDB)).
 *   - HUNT's `recoveredSecret` works when it arrives in its REAL wire shape
 *     (parsed out of a JSON request body, not hand-constructed with "the
 *     right" JS type by test code) and is rejected -- not thrown out of an
 *     uncaught `mod()` -- when it arrives as a JSON number or a
 *     non-canonical string.
 *
 * `@tenkacloud/coordination-plugin-sdk` is not an installed dependency here
 * (TenkaCloudChallenge owns problem content, not platform packages -- see
 * this repo's `AGENTS.md`), so it is stubbed via `bun:test`'s `mock.module`
 * before `crypto-battle.ts` (which imports it) is loaded. SOURCE OF TRUTH
 * for this stub's shape: TenkaCloud's
 * `packages/coordination-plugin-sdk/src/index.ts` -- if that package's
 * `CoordinationPlugin` / `defineCoordinationPlugin` / `dispatchOp` /
 * `runTick` contract changes, this stub (and
 * `coordination/coordination-plugin-sdk.d.ts`) must be updated to match.
 * `dispatchOp` / `runTick` below are real (if minimal) reimplementations of
 * the SDK's own validate-then-apply / optional-tick composition, not dead
 * code -- every test in this file drives the plugin through them, the same
 * way `TenkaCloud/infrastructure/test/problem-pack/reference-coordination-battle-coordination.test.ts`
 * drives the reference plugin through the real SDK's versions.
 * `mock.module` must run before the mocked specifier is first imported
 * anywhere in the process, so `crypto-battle.ts` is loaded via a dynamic
 * `import()` below rather than a static import (which the module loader
 * would otherwise resolve immediately, before this file's own top-level
 * code -- including the `mock.module` call -- has a chance to run).
 */
import { describe, expect, it, mock } from "bun:test";
import { decodeLedger, migrateStateV1 } from "./ledger-codec.ts";
import { LOCAL_PLAY_SEED_PREFIX } from "./reducer.ts";
import { createProof } from "./schnorr-prover.ts";
import { reconstruct } from "./shamir.ts";
import { startedMatch } from "./playtest.ts";
import type { CryptoBattleOp, CryptoBattleProjection, CryptoBattleState, StoredShare } from "./types.ts";
// Type-only: resolved via ../../coordination/coordination-plugin-sdk.d.ts's
// ambient declaration (see that file), not a real installed dependency.
import type { CoordinationPlugin, DispatchResult } from "@tenkacloud/coordination-plugin-sdk";

type CryptoBattlePlugin = CoordinationPlugin<CryptoBattleState, CryptoBattleOp, CryptoBattleProjection>;

mock.module("@tenkacloud/coordination-plugin-sdk", () => ({
  defineCoordinationPlugin: (plugin: unknown) => plugin,
  dispatchOp: (
    plugin: { validateOp: (...a: unknown[]) => { ok: boolean; error?: string }; applyOp: (...a: unknown[]) => unknown },
    state: unknown,
    teamId: string,
    op: unknown,
  ) => {
    const verdict = plugin.validateOp(state, teamId, op);
    if (!verdict.ok) return { ok: false, error: verdict.error };
    return { ok: true, state: plugin.applyOp(state, teamId, op) };
  },
  runTick: (plugin: { tick?: (...a: unknown[]) => unknown }, state: unknown, eventNowMs: number) =>
    plugin.tick ? plugin.tick(state, eventNowMs) : state,
}));

const pluginModule = (await import("../../coordination/crypto-battle.ts")) as {
  default: CryptoBattlePlugin;
};
const plugin = pluginModule.default;

// Same mocked specifier, now imported for its `dispatchOp` / `runTick` host
// utilities -- see this file's header on why these are exercised, not dead
// stub code.
const sdk = (await import("@tenkacloud/coordination-plugin-sdk")) as {
  dispatchOp: (
    plugin: CryptoBattlePlugin,
    state: CryptoBattleState,
    teamId: string,
    op: CryptoBattleOp,
  ) => DispatchResult<CryptoBattleState>;
  runTick: (plugin: CryptoBattlePlugin, state: CryptoBattleState, eventNowMs: number) => CryptoBattleState;
};
const { dispatchOp, runTick } = sdk;

/**
 * [Issue #652] A match context WITH a platform secret, which is what production
 * always has — the coordination dispatcher issues one before `initialState`
 * runs. Tests drive this rather than the secretless fallback so they exercise
 * the real path, and so the Order belt (derived from the seed) is pinned to one
 * known shape instead of moving whenever the seed changes.
 */
const CTX = {
  eventId: "evt-486-pr3-e2e",
  teamIds: ["blue", "red"],
  matchSecret: "test-match-secret-0",
} as const;
/** The same event with no secret issued — the local-play / unit-test path. */
const CTX_NO_SECRET = { eventId: "evt-486-pr3-e2e", teamIds: ["blue", "red"] } as const;

/**
 * [Issue #677] A started match, through the same dispatch seam production uses.
 *
 * `initialState` returns a match in `waiting`: the belt issues nothing and the
 * clock does not run until a team sends START, so a deployed match that nobody
 * has opened stays as deployed. These wiring tests are about a match under way,
 * so they start it the way a participant does rather than reaching into state.
 */
function startedThroughPlugin(ctx: typeof CTX | typeof CTX_NO_SECRET): CryptoBattleState {
  return expectDispatched(dispatchOp(plugin, plugin.initialState(ctx), "blue", { kind: "start" }));
}

/** `TeamState.shares` (stringified bigints) -> `shamir.ts`'s bigint `Share[]`, for `reconstruct`. */
function bigintShares(shares: readonly StoredShare[]): { readonly index: number; readonly value: bigint }[] {
  return shares.map((s) => ({ index: s.index, value: BigInt(s.value) }));
}

/** Unwraps a `DispatchResult`, failing loudly (not silently) if the dispatch was rejected. */
function expectDispatched(result: DispatchResult<CryptoBattleState>): CryptoBattleState {
  if (!result.ok) throw new Error(`test setup: dispatchOp was rejected: ${result.error}`);
  return result.state;
}

describe("coordination/crypto-battle.ts plugin wiring (Issue #486 PR3)", () => {
  it("forwards all 5 CoordinationPlugin hooks from reducer.ts", () => {
    expect(typeof plugin.initialState).toBe("function");
    expect(typeof plugin.validateOp).toBe("function");
    expect(typeof plugin.applyOp).toBe("function");
    expect(typeof plugin.tick).toBe("function");
    expect(typeof plugin.projectForTeam).toBe("function");
  });

  /**
   * [Issue #679 / TenkaCloud#3150] The platform rejects a plugin at LOAD time
   * if it declares `stateSchemaVersion` without `migrateState` -- so both have
   * to be wired together, and `migrateState` has to be the SAME function
   * `ledger-codec.ts` exports (not a re-implementation crypto-battle.ts wrote
   * itself), or this file's own migration tests (below, and
   * `ledger-codec.test.ts`) would be proving something crypto-battle.ts does
   * not actually run in production.
   */
  it("declares stateSchemaVersion 2 with migrateStateV1 wired as its migrateState [Issue #679]", () => {
    expect(plugin.stateSchemaVersion).toBe(2);
    expect(plugin.migrateState).toBe(migrateStateV1);
  });

  /**
   * [Issue #652] The seed must come from the platform's per-match secret, not
   * from `ctx.eventId`.
   *
   * `eventId` is a routing key: it is in URLs and in the participant's own
   * browser via `PortalSlotProps.team.eventId`, and every derivation in this
   * public repository hangs off the seed. Seeding from it published every
   * team's secret and shares, so HUNT could be won without collecting one.
   */
  it("derives the match seed from the platform's per-match secret, never from ctx.eventId", () => {
    const a = plugin.initialState(CTX);
    const b = plugin.initialState(CTX);
    expect(a).toEqual(b); // same secret -> byte-for-byte identical initial state
    expect(a.seed).toBe(CTX.matchSecret);
    expect(a.seed).not.toBe(CTX.eventId);

    // Same event, different match secret -> a different match. This is the
    // property that makes the hidden material unobtainable: knowing the public
    // eventId tells an attacker nothing about the derivation.
    const other = plugin.initialState({ ...CTX, matchSecret: "b".repeat(64) });
    const aBlue = a.teams.blue;
    const otherBlue = other.teams.blue;
    if (!aBlue || !otherBlue) throw new Error("test setup: expected a blue team in both states");
    expect(otherBlue.secret).not.toBe(aBlue.secret);
  });

  it("falls back to a self-announcing non-secret seed when the platform issued none", () => {
    // Local play and unit tests have no dispatcher to issue a secret. The
    // fallback stays greppable so a dump of a match running without a real
    // secret cannot be mistaken for a real one.
    const state = plugin.initialState(CTX_NO_SECRET);
    expect(state.seed).toBe(`${LOCAL_PLAY_SEED_PREFIX}${CTX_NO_SECRET.eventId}`);
    expect(state.seed).not.toBe(CTX_NO_SECRET.eventId);
  });

  it("drives a full 2-team match through dispatchOp/runTick (the SDK's own validate->apply / tick composition): tick -> leak -> prove -> hunt", () => {
    let state = startedThroughPlugin(CTX);
    state = runTick(plugin, state, 0);

    // -- LEAK: blue completes its first open contract by revealing a share.
    const blueContract = state.contracts.find((c) => c.teamId === "blue" && c.status === "open");
    if (!blueContract) throw new Error("test setup: expected an open contract for blue after tick(0)");
    const leakOp: CryptoBattleOp = { kind: "leak", contractId: blueContract.id };
    state = expectDispatched(dispatchOp(plugin, state, "blue", leakOp));
    const blueAfterLeak = state.teams.blue;
    if (!blueAfterLeak) throw new Error("test setup: expected a blue team");
    // [Issue #659] LEAK pays the leak rate, not the full rate.
    expect(blueAfterLeak.score).toBe(blueContract.leakPoints);
    expect(state.publicLedger).toHaveLength(1);
    expect(decodeLedger(state.publicLedger)[0]?.kind).toBe("share");

    // A validateOp rejection must flow back through dispatchOp as `{ ok: false }`
    // WITHOUT changing state -- re-leaking the now-completed contract is illegal.
    const rejected = dispatchOp(plugin, state, "blue", leakOp);
    expect(rejected.ok).toBe(false);

    // -- PROVE: red completes its own open contract via a Schnorr proof,
    // built from red's own secret exactly as a participant's own tooling
    // (schnorr-prover.ts's createProof) would from their own
    // projectForTeam(...).vault.secret -- read straight from state.teams
    // here since this test runs on the trusted side.
    const redTeamBeforeProve = state.teams.red;
    if (!redTeamBeforeProve) throw new Error("test setup: expected a red team");
    const redContract = state.contracts.find((c) => c.teamId === "red" && c.status === "open");
    if (!redContract) throw new Error("test setup: expected an open contract for red after tick(0)");
    const proof = createProof(
      BigInt(redTeamBeforeProve.secret),
      redTeamBeforeProve.generation,
      "red",
      redContract.id,
    );
    const proveOp: CryptoBattleOp = { kind: "prove", contractId: redContract.id, proof };
    state = expectDispatched(dispatchOp(plugin, state, "red", proveOp));
    const redAfterProve = state.teams.red;
    if (!redAfterProve) throw new Error("test setup: expected a red team");
    expect(redAfterProve.score).toBe(redContract.points);
    expect(state.publicLedger).toHaveLength(2);
    expect(decodeLedger(state.publicLedger)[1]?.kind).toBe("proof");

    // -- HUNT: blue reconstructs red's secret from `threshold` of red's
    // shares (see this file's header on why this reads state.teams directly
    // rather than re-deriving reducer.test.ts's ledger-sourced hunt
    // coverage) and submits it as a wire-shaped (stringified) recoveredSecret.
    const redShares = bigintShares(redAfterProve.shares).slice(0, state.config.threshold);
    const recoveredSecret = reconstruct(redShares, BigInt(state.config.prime));
    const huntOp: CryptoBattleOp = {
      kind: "hunt",
      targetTeamId: "red",
      generation: redAfterProve.generation,
      recoveredSecret: recoveredSecret.toString(),
    };
    state = expectDispatched(dispatchOp(plugin, state, "blue", huntOp));
    const blueAfterHunt = state.teams.blue;
    const redAfterHunt = state.teams.red;
    if (!blueAfterHunt || !redAfterHunt) throw new Error("test setup: expected both teams");
    // [Issue #659] Blue's running total is what it EARNED: the leak rate for the
    // Order it passed on, plus the hunt bonus -- not the full PROVE rate it
    // declined to compute for.
    expect(blueAfterHunt.score).toBe(blueContract.leakPoints + state.config.scores.huntBonus);
    expect(redAfterHunt.huntedGenerations).toContain(1);

    // -- projectForTeam: blue's own projection is safe to hand to blue's
    // participants -- it shows blue's own vault, never red's secret.
    const blueProjection = plugin.projectForTeam(state, "blue");
    expect(blueProjection.vault.teamId).toBe("blue");
    // [Issue #696] Asserted STRUCTURALLY, not as a substring. A match now runs
    // in a field a participant can compute in (`HAND_PRIME`), so red's secret
    // is three digits and a substring search over this blob reports a hit on
    // any coincidence -- it stopped being able to tell a leak from a collision.
    // What the boundary actually says is that the projection carries exactly
    // one vault, the reader's own, and that a team summary is a summary: no
    // secret, no shares. That holds at any modulus and is the stronger claim.
    expect(blueProjection.vault.secret).toBe(blueAfterHunt.secret);
    for (const summary of Object.values(blueProjection.teams)) {
      expect(Object.keys(summary)).not.toContain("secret");
      expect(Object.keys(summary)).not.toContain("shares");
    }
    expect(Object.keys(blueProjection).filter((k) => k === "vault")).toHaveLength(1);
  });

  it("state survives a JSON round-trip (simulating Turso/DynamoDB persistence between calls) and stays usable afterward [PR3 review High #1/#2]", () => {
    let state = startedThroughPlugin(CTX);
    state = runTick(plugin, state, 0);
    // [Issue #652] Pick by what LEAK requires, not by belt position. The Order
    // belt derives from `state.seed`, so "the first open contract" changed shape
    // when the seed stopped being `ctx.eventId` — a test that assumes position
    // is really asserting a derivation, which is not what it is here to check.
    const blueContract = state.contracts.find(
      (c) => c.teamId === "blue" && c.status === "open" && c.allowedMethods.includes("leak"),
    );
    if (!blueContract) throw new Error("test setup: expected a LEAK-able open contract for blue");
    state = expectDispatched(dispatchOp(plugin, state, "blue", { kind: "leak", contractId: blueContract.id }));

    // What the dispatcher actually does between two calls: persist `state`
    // as JSON (Turso: a TEXT/JSON column; DynamoDB: a JSON-encoded attribute)
    // and read it back. No bigint may survive that -- Turso's
    // `JSON.stringify` throws on one outright, and DynamoDB round-trips
    // numbers through `Number`, silently losing precision above 2^53-1 (well
    // under field.ts's 61-bit `P` and this package's 2048-bit Schnorr group
    // elements).
    const roundTripped = JSON.parse(JSON.stringify(state)) as CryptoBattleState;
    expect(roundTripped).toEqual(state);

    // The round-tripped value must still be a fully working state, not just
    // a structurally-similar one -- tick and a further op both have to work
    // on it exactly as they would on the original in-memory state.
    const ticked = runTick(plugin, roundTripped, state.config.contractIntervalMs);
    expect(ticked.contracts.length).toBeGreaterThan(state.contracts.length);
    // [Issue #652] Any LEAK-able open Order proves the point — the claim under
    // test is "the round-tripped state still works", not "red's first Order is
    // a LEAK". Naming a team here re-coupled the test to the Order belt, which
    // derives from `state.seed` and legitimately reshuffled when the seed
    // stopped being `ctx.eventId`.
    // Dispatched against `ticked`, which came out of the round-tripped value —
    // so a working op here still proves the persisted state is usable, and the
    // freshly-issued batch guarantees there is an Order left to submit to.
    const leakable = ticked.contracts.find(
      (c) => c.status === "open" && c.allowedMethods.includes("leak"),
    );
    if (!leakable) throw new Error("test setup: expected a LEAK-able open contract");
    const scoreBefore = ticked.teams[leakable.teamId]?.score ?? 0;
    const afterLeak = expectDispatched(
      dispatchOp(plugin, ticked, leakable.teamId, {
        kind: "leak",
        contractId: leakable.id,
      }),
    );
    expect(afterLeak.teams[leakable.teamId]?.score).toBe(scoreBefore + leakable.leakPoints);
  });

  it("state with a NON-EMPTY huntLog (Issue #486 PR5) also survives a JSON round-trip, not only the empty-huntLog case", () => {
    // The round-trip test above never triggers a HUNT, so it only ever
    // round-trips `huntLog: []` -- that alone cannot back a claim that
    // `huntLog` entries themselves survive JSON.stringify/JSON.parse
    // (they are plain string/number fields, see HuntLogEntry in types.ts,
    // but "the array is empty either way" is a different, weaker fact than
    // "an actual entry round-trips intact"). This test drives a successful
    // HUNT first, so `huntLog` has a real `{ attackerTeamId, targetTeamId,
    // generation, atMs }` entry, THEN round-trips.
    let state = startedThroughPlugin(CTX);
    state = runTick(plugin, state, 0);
    const redTeam = state.teams.red;
    if (!redTeam) throw new Error("test setup: expected a red team");
    const redShares = bigintShares(redTeam.shares).slice(0, state.config.threshold);
    const recoveredSecret = reconstruct(redShares, BigInt(state.config.prime));
    const huntOp: CryptoBattleOp = {
      kind: "hunt",
      targetTeamId: "red",
      generation: redTeam.generation,
      recoveredSecret: recoveredSecret.toString(),
    };
    state = expectDispatched(dispatchOp(plugin, state, "blue", huntOp));
    expect(state.huntLog).toHaveLength(1);

    if (state.nowMs === undefined) throw new Error("test setup: expected state.nowMs to be set after tick()");
    const roundTripped = JSON.parse(JSON.stringify(state)) as CryptoBattleState;
    expect(roundTripped).toEqual(state);
    expect(roundTripped.huntLog).toEqual(state.huntLog);
    expect(roundTripped.huntLog[0]).toEqual({
      attackerTeamId: "blue",
      targetTeamId: "red",
      generation: redTeam.generation,
      atMs: state.nowMs,
    });

    // Round-tripped state must still be usable, same bar as the test above --
    // a further tick works on it exactly as it would on the original.
    const ticked = runTick(plugin, roundTripped, state.config.contractIntervalMs);
    expect(ticked.contracts.length).toBeGreaterThan(state.contracts.length);
  });

  it("HUNT works with recoveredSecret in its real wire shape, and rejects a JSON number or a non-canonical string [PR3 review High #1]", () => {
    let state = startedThroughPlugin(CTX);
    state = runTick(plugin, state, 0);
    const redTeam = state.teams.red;
    if (!redTeam) throw new Error("test setup: expected a red team");
    const redShares = bigintShares(redTeam.shares).slice(0, state.config.threshold);
    const recoveredSecretBig = reconstruct(redShares, BigInt(state.config.prime));

    // The real wire path: JSON-encode the op the way a participant's HTTP
    // request body would, then JSON.parse it back into `unknown` -- exactly
    // what `dispatchOp` receives in production (see reducer.ts's "WIRE
    // BOUNDARY" comment) -- rather than a hand-built object that has "the
    // right" JS type only because test code constructed it that way.
    const wireOp = JSON.parse(
      JSON.stringify({
        kind: "hunt",
        targetTeamId: "red",
        generation: 1,
        recoveredSecret: recoveredSecretBig.toString(),
      }),
    ) as CryptoBattleOp;
    expect(dispatchOp(plugin, state, "blue", wireOp).ok).toBe(true);

    // A JSON *number* recoveredSecret (`{ recoveredSecret: 123 }` instead of
    // `"123"` -- an easy mistake for a naive client, and exactly what a raw
    // bigint would have serialized to before this fix, had it not thrown
    // first) must be rejected, not silently coerced to a string and accepted.
    const numberOp = JSON.parse(
      JSON.stringify({
        kind: "hunt",
        targetTeamId: "red",
        generation: 1,
        recoveredSecret: Number(recoveredSecretBig),
      }),
    ) as unknown as CryptoBattleOp;
    expect(plugin.validateOp(state, "blue", numberOp).ok).toBe(false);

    // Non-canonical decimal strings -- a hex literal, an empty string, and an
    // absurdly long one -- are rejected too (same gate PROVE's proof fields
    // already went through; see schnorr-verifier.ts's parseCanonicalDecimal).
    for (const bad of ["0x10", "", "9".repeat(701)]) {
      const badOp: CryptoBattleOp = { kind: "hunt", targetTeamId: "red", generation: 1, recoveredSecret: bad };
      expect(plugin.validateOp(state, "blue", badOp).ok).toBe(false);
    }
  });
});
