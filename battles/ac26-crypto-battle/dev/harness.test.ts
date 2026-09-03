/**
 * Issue #644: what the local development harness has to keep true.
 *
 * These tests are not about the game — `../game/src/*.test.ts` owns that, and
 * duplicating it here would be the very thing this harness must not do. They
 * pin the three properties that make a preview trustworthy enough to develop
 * against:
 *
 *   1. it is the REAL reducer, not a lookalike;
 *   2. its scenarios are positions the game's own rules can actually reach,
 *      and reaching them is deterministic;
 *   3. it does not widen what a team can see, even though it has no auth.
 *
 * A harness that quietly diverged on any of those would send UI work down a
 * path production never takes, which costs more than having no harness at all.
 */

import { describe, expect, it } from "bun:test";
import { buildHuntOp } from "../game/src/playtest.ts";
import { DEFAULT_CONFIG, projectForTeam } from "../game/src/reducer.ts";
import type { CryptoBattleProjection } from "../game/src/types.ts";
import { createMatch, dispatch, projectSafely, readProjection, submitOp } from "./host.ts";
import { buildScenario, DEV_CONFIG, DEV_TEAMS, SCENARIO_IDS, SCENARIO_LABELS } from "./scenarios.ts";
import { buildNonceReuseHuntOp } from "../game/src/playtest.ts";

describe("dev host is the real reducer", () => {
  /**
   * The harness's read path must BE `projectForTeam`, not a re-derivation of
   * it. If it ever forked, the preview would show a team something the live
   * portal does not — including, in the worst case, data `projectForTeam`
   * redacts.
   */
  it("should project exactly what projectForTeam projects", () => {
    const scenario = buildScenario("hunt-reachable");
    for (const teamId of DEV_TEAMS) {
      expect(projectSafely(scenario.host.state, teamId, {})).toEqual(
        projectForTeam(scenario.host.state, teamId),
      );
    }
  });

  /**
   * `validateOp` before `applyOp`, always. A harness that applied first would
   * accept moves the live dispatcher rejects, which is the single most
   * misleading thing a preview can do.
   */
  it("should refuse an op the reducer rejects, and leave the state untouched", () => {
    const scenario = buildScenario("fresh");
    const before = JSON.stringify(scenario.host.state);

    const outcome = submitOp(
      scenario.host,
      "alpha",
      { kind: "leak", contractId: "no-such-contract" },
      scenario.nowMs,
    );

    expect(outcome.kind).toBe("rejected");
    expect(JSON.stringify(scenario.host.state)).toBe(before);
    expect(scenario.host.version).toBe(0);
  });

  it("should refuse a team that is not in the match", () => {
    const host = createMatch({ eventId: "e1", teamIds: DEV_TEAMS }, DEV_CONFIG);
    const result = dispatch(host.state, "intruder", { kind: "rotate" });
    expect(result.ok).toBe(false);
  });

  /**
   * The clock advances before the op is validated, matching production
   * ordering: a contract that expired while the participant was typing must
   * already be `expired` when their LEAK is checked.
   */
  it("should expire a contract before validating a late op against it", () => {
    const scenario = buildScenario("fresh");
    const [contract] = projectForTeam(scenario.host.state, "alpha").myContracts;
    if (!contract) throw new Error("fresh scenario issued no contract");

    const lateMs = scenario.nowMs + DEV_CONFIG.contractTtlMs! + 60_000;
    const outcome = submitOp(scenario.host, "alpha", { kind: "leak", contractId: contract.id }, lateMs);

    expect(outcome.kind).toBe("rejected");
  });

  it("should bump the optimistic-lock version only on an accepted op", () => {
    const scenario = buildScenario("fresh");
    const [contract] = projectForTeam(scenario.host.state, "alpha").myContracts;
    if (!contract) throw new Error("fresh scenario issued no contract");

    submitOp(scenario.host, "alpha", { kind: "leak", contractId: "nope" }, scenario.nowMs);
    expect(scenario.host.version).toBe(0);

    submitOp(scenario.host, "alpha", { kind: "leak", contractId: contract.id }, scenario.nowMs);
    expect(scenario.host.version).toBe(1);
  });

  it("should not write on the read path", () => {
    const scenario = buildScenario("ledger-filling");
    const before = scenario.host.version;
    readProjection(scenario.host, "alpha", scenario.nowMs);
    expect(scenario.host.version).toBe(before);
  });
});

describe("dev scenarios are reachable and deterministic", () => {
  it.each([...SCENARIO_IDS])("should build scenario %s from real ops", (id) => {
    const scenario = buildScenario(id);
    expect(scenario.id).toBe(id);
    expect(Object.keys(scenario.host.state.teams).sort()).toEqual([...DEV_TEAMS].sort());
  });

  /**
   * Same id, same board — every time. A scenario that drifted between reloads
   * would make "did my change do that?" unanswerable, which is the question
   * the whole harness exists to answer.
   */
  it.each([...SCENARIO_IDS])("should rebuild scenario %s byte-identically", (id) => {
    expect(JSON.stringify(buildScenario(id).host.state)).toBe(
      JSON.stringify(buildScenario(id).host.state),
    );
  });

  it("should label every scenario in both languages", () => {
    for (const id of SCENARIO_IDS) {
      expect(SCENARIO_LABELS[id].ja.length).toBeGreaterThan(0);
      expect(SCENARIO_LABELS[id].en.length).toBeGreaterThan(0);
    }
  });

  it("should reach a mixed ledger in 'ledger-filling'", () => {
    // `state.publicLedger` holds the compact persisted form (`StoredArtifact`,
    // see ../game/src/ledger-codec.ts): `k` is that form's own field name for
    // `PublicArtifact.kind`.
    const { publicLedger } = buildScenario("ledger-filling").host.state;
    expect(publicLedger.some((artifact) => artifact.k === "share")).toBe(true);
    expect(publicLedger.some((artifact) => artifact.k === "proof")).toBe(true);
  });

  /**
   * `hunt-reachable` claims the ledger holds enough of alpha's current
   * generation for a HUNT. Proving it with `buildHuntOp` — which takes only a
   * projection — is what makes the claim honest: if the shares were not really
   * public, the builder could not see them either.
   */
  it("should make 'hunt-reachable' huntable from public information alone", () => {
    const scenario = buildScenario("hunt-reachable");
    const bravoView: CryptoBattleProjection = projectForTeam(scenario.host.state, "bravo");

    const op = buildHuntOp(bravoView, "alpha", {
      prime: scenario.host.state.config.prime,
      threshold: scenario.host.state.config.threshold,
    });

    expect(op).toBeDefined();
    expect(submitOp(scenario.host, "bravo", op!, scenario.nowMs).kind).toBe("ok");
  });

  it("should leave 'after-rotate' on a new generation with the hunt already scored", () => {
    const { state } = buildScenario("after-rotate").host;
    expect(state.teams.alpha?.generation).toBe(2);
    expect(state.teams.alpha?.huntedGenerations).toContain(1);
    expect(state.huntLog.length).toBeGreaterThan(0);
  });

  it("should leave 'ended' read-only", () => {
    const scenario = buildScenario("ended");
    expect(scenario.host.state.phase).toBe("ended");
    expect(submitOp(scenario.host, "alpha", { kind: "rotate" }, scenario.nowMs).kind).toBe(
      "rejected",
    );
  });

  /**
   * Only the clock is scaled down for a fast dev loop. Scaling `threshold` or
   * `shareCount` would change how many LEAKs it takes to become huntable —
   * i.e. it would tune the UI against a different game.
   */
  it("should scale only the clock, never the crypto or scoring parameters", () => {
    const { config } = buildScenario("fresh").host.state;
    expect(config.threshold).toBe(DEFAULT_CONFIG.threshold);
    expect(config.shareCount).toBe(DEFAULT_CONFIG.shareCount);
    expect(config.prime).toBe(DEFAULT_CONFIG.prime);
    expect(config.scores).toEqual(DEFAULT_CONFIG.scores);
    expect(config.matchDurationMs).toBeLessThan(DEFAULT_CONFIG.matchDurationMs);
  });
});

describe("dev harness does not widen what a team can see", () => {
  /**
   * The harness has no authentication — the seat selector switches teams
   * freely, which is exactly what the real portal never does. That makes this
   * the one property worth pinning hardest: whatever seat you pick, the bytes
   * that reach the browser are still only `projectForTeam`'s, so an author
   * cannot accidentally build UI against data a participant will never have.
   */
  /**
   * [Issue #696] Asserted as an IDENTITY, not as a substring sweep.
   *
   * This used to serialize the projection and search it for the opponent's
   * secret and un-leaked share values. That method reads as the stronger one --
   * it catches a leak through a field nobody thought of -- but it is only sound
   * while the forbidden values are long enough to be unique. A match now runs in
   * a field a participant can interpolate by hand (`HAND_PRIME`, 251), and at
   * three digits the sweep cannot tell a leak from a coincidence: it fires
   * because bravo's own share happens to equal alpha's secret, which is not a
   * leak and not a bug.
   *
   * What this file is uniquely placed to check is not `projectForTeam` -- that
   * has its own trust-boundary tests in `game/src`, run in a big field where a
   * value sweep still discriminates. It is the HOST: whether the harness's read
   * path hands the browser anything beyond what `projectForTeam` returned. So
   * that is the assertion, and it is exact rather than probabilistic. Anything
   * the host added, dropped or rewrote fails here, at any modulus.
   */
  it.each([...SCENARIO_IDS])(
    "should hand bravo exactly projectForTeam's bytes and nothing else (%s)",
    (id) => {
      const scenario = buildScenario(id);
      const outcome = readProjection(scenario.host, "bravo", scenario.nowMs);
      if (outcome.kind !== "ok") throw new Error("read path did not return a projection");
      // `SubmitOutcome.projection` is deliberately `unknown` -- the host hands
      // the browser bytes, not a type. Narrowing it here is this test's own job.
      const projection = outcome.projection as CryptoBattleProjection;

      // `readProjection` ticks before projecting, so the comparison is taken
      // against the state it actually projected from.
      expect(projection).toEqual(projectForTeam(scenario.host.state, "bravo"));

      // And the shape that identity is worth having: the reader's own vault,
      // and team summaries that are summaries.
      expect(projection.vault.teamId).toBe("bravo");
      for (const summary of Object.values(projection.teams)) {
        expect(Object.keys(summary)).not.toContain("secret");
        expect(Object.keys(summary)).not.toContain("shares");
      }
    },
  );
});

/**
 * [Issue #645] The positions the new Order kinds exist to show.
 *
 * The property tests above already run every scenario through "built from real
 * ops" and "rebuilds byte-identically". These add the part those cannot know:
 * that each new scenario actually reaches the position its label promises. A
 * scenario that silently produced an empty belt would still be deterministic
 * and still be built from real ops.
 */
describe("Issue #645 scenarios reach the position they advertise", () => {
  it("should leave an unserved encrypted-addition Order on the belt", () => {
    const { host } = buildScenario("fhe-order");
    const order = host.state.contracts.find(
      (c) => c.teamId === "alpha" && c.status === "open" && c.task.kind === "homomorphic-sum",
    );
    expect(order).toBeDefined();
    if (order?.task.kind !== "homomorphic-sum") throw new Error("unreachable");
    expect(order.task.inputs.length).toBeGreaterThan(1);
    expect(order.allowedMethods).toEqual(["fhe"]);
  });

  it("should leave an unserved masked-subtotal Order, with its private inputs visible only to its owner", () => {
    const { host } = buildScenario("mpc-order");
    const projected = projectForTeam(host.state, "alpha").myContracts.find(
      (c) => c.status === "open" && c.task.kind === "masked-total",
    );
    expect(projected).toBeDefined();
    if (projected?.task.kind !== "masked-total") throw new Error("unreachable");
    // [Issue #696] A field element, not a long number. This asserted
    // `.length > 4` when the field was 2^61 - 1; a match now runs in
    // `HAND_PRIME` so an office's number is at most three digits, which is the
    // point -- a participant adds these by hand.
    expect(BigInt(projected.task.myInput)).toBeLessThan(BigInt(host.state.config.prime));

    // [Issue #696] The other team's view carries none of it -- asserted
    // structurally rather than by searching a serialized projection for the
    // value. At three digits that search cannot tell a leak from a coincidence
    // (bravo's own number may simply equal alpha's). What "visible only to its
    // owner" MEANS is that the Order is not in the other team's belt at all,
    // and that holds at any modulus.
    const other = projectForTeam(host.state, "bravo");
    expect(other.myContracts.some((c) => c.id === projected.id)).toBe(false);
    expect(other.myContracts.every((c) => c.id.startsWith("bravo"))).toBe(true);
  });

  it("should produce two alpha transcripts sharing one commitment, and a recoverable witness", () => {
    const { host } = buildScenario("nonce-reuse");
    const proofs = host.state.publicLedger.filter(
      (a) => a.k === "proof" && a.tm === "alpha",
    );
    expect(proofs).toHaveLength(2);
    const commitments = new Set(proofs.map((a) => (a.k === "proof" ? a.o : "")));
    expect(commitments.size).toBe(1);

    // And the position is genuinely exploitable from bravo's public view.
    const op = buildNonceReuseHuntOp(projectForTeam(host.state, "bravo"), "alpha");
    expect(op).toBeDefined();
  });
});
