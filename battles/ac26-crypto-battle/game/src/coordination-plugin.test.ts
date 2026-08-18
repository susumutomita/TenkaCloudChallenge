/**
 * Coordination plugin wiring test (Issue #486 PR3).
 *
 * `../../coordination/crypto-battle.ts` is the file the platform dispatcher
 * actually loads (see its header for the full investigation into how). This
 * test drives its default export through the same shape the dispatcher uses
 * (`validateOp` -> `applyOp`, `tick`, `projectForTeam`) to prove the plugin
 * wiring itself works, on top of the 121 existing `game/src` tests that
 * already cover the underlying reducer/Shamir/Schnorr logic exhaustively.
 * It intentionally does not re-derive that coverage (e.g. HUNT below
 * reconstructs straight from `state.teams.red.shares`, the same shortcut
 * `reducer.test.ts`'s `initialState` "shares reconstruct the secret" test
 * uses -- ledger-sourced reconstruction already has its own dedicated
 * `reducer.test.ts` "hunt" coverage via its `leakThreshold` helper).
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
 * `mock.module` must run before the mocked specifier is first imported
 * anywhere in the process, so `crypto-battle.ts` is loaded via a dynamic
 * `import()` below rather than a static import (which the module loader
 * would otherwise resolve immediately, before this file's own top-level
 * code -- including the `mock.module` call -- has a chance to run).
 */
import { describe, expect, it, mock } from "bun:test";
import { createProof } from "./schnorr-prover.ts";
import { reconstruct } from "./shamir.ts";
import type { CryptoBattleOp, CryptoBattleProjection, CryptoBattleState } from "./types.ts";
// Type-only: resolved via ../../coordination/coordination-plugin-sdk.d.ts's
// ambient declaration (see that file), not a real installed dependency.
import type { CoordinationPlugin } from "@tenkacloud/coordination-plugin-sdk";

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

const CTX = { eventId: "evt-486-pr3-e2e", teamIds: ["blue", "red"] } as const;

describe("coordination/crypto-battle.ts plugin wiring (Issue #486 PR3)", () => {
  it("forwards all 5 CoordinationPlugin hooks from reducer.ts", () => {
    expect(typeof plugin.initialState).toBe("function");
    expect(typeof plugin.validateOp).toBe("function");
    expect(typeof plugin.applyOp).toBe("function");
    expect(typeof plugin.tick).toBe("function");
    expect(typeof plugin.projectForTeam).toBe("function");
  });

  it("derives a deterministic, per-event seed from ctx.eventId", () => {
    const a = plugin.initialState(CTX);
    const b = plugin.initialState(CTX);
    expect(a).toEqual(b); // same eventId -> byte-for-byte identical initial state
    expect(a.seed).toBe(CTX.eventId);

    const other = plugin.initialState({ eventId: "evt-486-pr3-e2e-other", teamIds: ["blue", "red"] });
    const aBlue = a.teams.blue;
    const otherBlue = other.teams.blue;
    if (!aBlue || !otherBlue) throw new Error("test setup: expected a blue team in both states");
    expect(otherBlue.secret).not.toBe(aBlue.secret); // different eventId -> different match
  });

  it("drives a full 2-team match through the plugin's own hooks: tick -> leak -> prove -> hunt", () => {
    let state = plugin.initialState(CTX);
    if (!plugin.tick) throw new Error("test setup: plugin.tick must be defined");
    state = plugin.tick(state, 0);

    // -- LEAK: blue completes its first open contract by revealing a share.
    const blueContract = state.contracts.find((c) => c.teamId === "blue" && c.status === "open");
    if (!blueContract) throw new Error("test setup: expected an open contract for blue after tick(0)");
    const leakOp: CryptoBattleOp = { kind: "leak", contractId: blueContract.id };
    expect(plugin.validateOp(state, "blue", leakOp)).toEqual({ ok: true });
    state = plugin.applyOp(state, "blue", leakOp);
    const blueAfterLeak = state.teams.blue;
    if (!blueAfterLeak) throw new Error("test setup: expected a blue team");
    expect(blueAfterLeak.score).toBe(blueContract.points);
    expect(state.publicLedger).toHaveLength(1);
    expect(state.publicLedger[0]?.kind).toBe("share");

    // -- PROVE: red completes its own open contract via a Schnorr proof,
    // built from red's own secret exactly as a participant's own tooling
    // (schnorr-prover.ts's createProof) would from their own
    // projectForTeam(...).vault.secret -- read straight from state.teams
    // here since this test runs on the trusted side.
    const redTeamBeforeProve = state.teams.red;
    if (!redTeamBeforeProve) throw new Error("test setup: expected a red team");
    const redContract = state.contracts.find((c) => c.teamId === "red" && c.status === "open");
    if (!redContract) throw new Error("test setup: expected an open contract for red after tick(0)");
    const proof = createProof(redTeamBeforeProve.secret, redTeamBeforeProve.generation, "red", redContract.id);
    const proveOp: CryptoBattleOp = { kind: "prove", contractId: redContract.id, proof };
    expect(plugin.validateOp(state, "red", proveOp)).toEqual({ ok: true });
    state = plugin.applyOp(state, "red", proveOp);
    const redAfterProve = state.teams.red;
    if (!redAfterProve) throw new Error("test setup: expected a red team");
    expect(redAfterProve.score).toBe(redContract.points);
    expect(state.publicLedger).toHaveLength(2);
    expect(state.publicLedger[1]?.kind).toBe("proof");

    // -- HUNT: blue reconstructs red's secret from `threshold` of red's
    // shares (see this file's header on why this reads state.teams directly
    // rather than re-deriving reducer.test.ts's ledger-sourced hunt
    // coverage) and submits it.
    const redShares = redAfterProve.shares.slice(0, state.config.threshold);
    const recoveredSecret = reconstruct(redShares, state.config.prime);
    const huntOp: CryptoBattleOp = {
      kind: "hunt",
      targetTeamId: "red",
      generation: redAfterProve.generation,
      recoveredSecret,
    };
    expect(plugin.validateOp(state, "blue", huntOp)).toEqual({ ok: true });
    state = plugin.applyOp(state, "blue", huntOp);
    const blueAfterHunt = state.teams.blue;
    const redAfterHunt = state.teams.red;
    if (!blueAfterHunt || !redAfterHunt) throw new Error("test setup: expected both teams");
    expect(blueAfterHunt.score).toBe(blueContract.points + state.config.scores.huntBonus);
    expect(redAfterHunt.huntedGenerations).toContain(1);

    // -- projectForTeam: blue's own projection is safe to hand to blue's
    // participants -- it shows blue's own vault, never red's secret.
    const blueProjection = plugin.projectForTeam(state, "blue");
    expect(blueProjection.vault.teamId).toBe("blue");
    expect(JSON.stringify(blueProjection)).not.toContain(redAfterHunt.secret.toString());
  });
});
