/**
 * [Issue #679] Tests for `ledger-codec.ts`'s persisted-ledger encoding.
 *
 * Design doc's required test list (see the PR this lands with):
 *   1. codec round trip -- `decodeLedger(encodeLedger(x))` deep-equals `x`,
 *      `id` included, for every kind.
 *   2. id derivation matches real reducer-constructed data -- run real
 *      matches through the real reducer and confirm every ledger entry's
 *      derived id agrees with the id the reducer actually built, with NO
 *      entry needing the `d` escape hatch.
 *   3. `migrateState` lifts a v1 state to v2 without losing any ledger
 *      content, and `decodeLedger` recovers it.
 *   4. HUNT still works -- covered by the existing suite (pi-reuse.test.ts,
 *      reducer.test.ts's "hunt" describe block), not re-derived here.
 *   5. `state-size.test.ts` passes with re-measured numbers -- that file's own
 *      concern, not this one's.
 */

import { describe, expect, test } from "bun:test";
import {
  decodeArtifact,
  decodeLedger,
  encodeArtifact,
  encodeLedger,
  migrateStateV1,
  type StoredArtifact,
} from "./ledger-codec.ts";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import { buildFheOp, buildLeakOp, buildMpcOp, buildProveSudokuOp, startedMatch } from "./playtest.ts";
import type { CryptoBattleOp, CryptoBattleState, PublicArtifact } from "./types.ts";

// ---------------------------------------------------------------------------
// Test 1: codec round trip, one hand-built fixture per kind.
// ---------------------------------------------------------------------------

const FIXTURES: readonly PublicArtifact[] = [
  {
    id: "contract-1-share2",
    teamId: "teamA",
    generation: 1,
    kind: "share",
    method: "leak",
    shareIndex: 2,
    value: "123456789012345678901234567890",
    contractId: "contract-1",
    postedAtMs: 1000,
  },
  {
    id: "contract-2-pair",
    teamId: "teamA",
    generation: 1,
    kind: "cipher-pair",
    method: "leak",
    contractId: "contract-2",
    rung: "caesar",
    plaintext: [0, 1, 2, 3],
    ciphertext: [4, 5, 6, 7],
    postedAtMs: 2000,
  },
  {
    id: "contract-3-proof",
    teamId: "teamB",
    generation: 2,
    kind: "proof",
    method: "prove",
    contractId: "contract-3",
    commitment: "987654321098765432109876543210",
    response: "112233445566778899001122334455",
    postedAtMs: 3000,
  },
  {
    // [Issue #709] The PROVE artifact the sudoku Order writes today; "proof"
    // above is what a match persisted before #709 still holds.
    id: "contract-6-sudoku",
    teamId: "teamB",
    generation: 2,
    kind: "sudoku-reveal",
    method: "prove",
    contractId: "contract-6",
    group: 5,
    cells: [3, 1, 4, 2],
    tag: "a1b2c3d4e5f6",
    postedAtMs: 3500,
  },
  {
    id: "contract-4-ciphertext",
    teamId: "teamB",
    generation: 1,
    kind: "ciphertext",
    method: "fhe",
    contractId: "contract-4",
    r: "111111111111111111",
    y: "222222222222222222",
    postedAtMs: 4000,
  },
  {
    id: "contract-5-partial",
    teamId: "teamA",
    generation: 3,
    kind: "partial",
    method: "mpc",
    contractId: "contract-5",
    partial: "333333333333",
    peerPartials: ["444444444444", "555555555555"],
    total: "1333333333332",
    postedAtMs: 5000,
  },
];

describe("ledger-codec: round trip (test 1)", () => {
  test("decodeLedger(encodeLedger(x)) deep-equals x, id included, for every PublicArtifact kind", () => {
    const stored = encodeLedger(FIXTURES);
    const roundTripped = decodeLedger(stored);
    expect(roundTripped).toEqual([...FIXTURES]);
  });

  test("each fixture round trips individually through encodeArtifact/decodeArtifact too", () => {
    for (const fixture of FIXTURES) {
      expect(decodeArtifact(encodeArtifact(fixture))).toEqual(fixture);
    }
  });

  test("none of the hand-built fixtures needed the `d` escape hatch (their ids all match the derived template)", () => {
    for (const fixture of FIXTURES) {
      const stored = encodeArtifact(fixture);
      expect("d" in stored).toBe(false);
    }
  });

  test("the `d` escape hatch itself round-trips when an id does NOT match the derived template", () => {
    // Synthetic: an id that could never come from reducer.ts's own template
    // (`${contractId}-share${shareIndex}`) for this contractId/shareIndex.
    const oddball: PublicArtifact = { ...FIXTURES[0]!, id: "totally-unrelated-id" } as PublicArtifact;
    const stored = encodeArtifact(oddball);
    expect((stored as { d?: string }).d).toBe("totally-unrelated-id");
    expect(decodeArtifact(stored)).toEqual(oddball);
  });
});

// ---------------------------------------------------------------------------
// Test 2: id derivation matches what the REAL reducer constructs, at scale,
// across all 5 reducer-written kinds, with no entry needing the `d` escape hatch.
// ---------------------------------------------------------------------------

/**
 * Plays a small match exercising all 5 reducer-written `PublicArtifact` kinds
 * through the REAL reducer (leak-on-share -> "share", leak-on-ladder ->
 * "cipher-pair", prove -> "sudoku-reveal", fhe -> "ciphertext", mpc ->
 * "partial"; the legacy "proof" kind is decode-only since #709), the same way
 * `adversarial.test.ts`'s "adversarial 9" plays a multi-method match, but
 * covering LEAK on both Order shapes (share and ladder) so "cipher-pair"
 * appears too, which that test does not need.
 *
 * [Issue #677/#688-#692] Built via `startedMatch`, not `tick(initialState(...),
 * 0)`: `initialState` now returns a match in `waiting`, where `tick` issues
 * nothing and the clock does not advance until the roster starts it (see
 * `playtest.ts`'s `startedMatch` doc comment). A bare `tick(initialState(...),
 * 0)` therefore never issues a single Order -- every other fixture in this
 * package already builds through `startedMatch` for the same reason.
 */
function playMultiMethodMatch(teamCount: number, rounds: number): CryptoBattleState {
  const teamIds = Array.from({ length: teamCount }, (_, i) => `team-${i}`);
  let state = startedMatch({ eventId: "ledger-codec-multi-method", teamIds, matchSecret: "m".repeat(64) });
  for (let round = 0; round < rounds; round += 1) {
    for (const teamId of teamIds) {
      for (const order of projectForTeam(state, teamId).myContracts) {
        if (order.status !== "open") continue;
        let op: CryptoBattleOp | undefined;
        if (order.task.kind === "zk-sudoku") {
          // [Issue #709] PROVE is its own Order now, so "sudoku-reveal" lands
          // without any team having to choose PROVE over LEAK on a share Order.
          op = buildProveSudokuOp(projectForTeam(state, teamId).vault, order.id);
        } else if (order.task.kind === "reveal-share" || order.task.kind === "caesar-shift") {
          // LEAK on both Order shapes so "share" and, via the ladder Order,
          // "cipher-pair" land on the ledger.
          op = buildLeakOp(order.id);
        } else if (order.task.kind === "homomorphic-sum") {
          op = buildFheOp(order, state.config.prime);
        } else if (order.task.kind === "masked-total") {
          op = buildMpcOp(order, state.config.prime);
        }
        if (!op) continue;
        if (!validateOp(state, teamId, op).ok) continue;
        state = applyOp(state, teamId, op);
      }
    }
    state = tick(state, (round + 1) * state.config.contractIntervalMs);
  }
  return state;
}

/** Same template reducer.ts's 5 construction sites use -- see ledger-codec.ts's `deriveArtifactId` doc comment. */
function expectedIdFor(artifact: PublicArtifact): string {
  switch (artifact.kind) {
    case "rps-commit": return `${artifact.contractId}-rps-commit`;
    case "rps-open": return `${artifact.contractId}-rps-open`;
    case "share":
      return `${artifact.contractId}-share${artifact.shareIndex}`;
    case "cipher-pair":
      return `${artifact.contractId}-pair`;
    case "proof":
      return `${artifact.contractId}-proof`;
    case "sudoku-reveal":
      return `${artifact.contractId}-sudoku`;
    case "ciphertext":
      return `${artifact.contractId}-ciphertext`;
    case "partial":
      return `${artifact.contractId}-partial`;
  }
}

describe("ledger-codec: id derivation matches real reducer-constructed data (test 2)", () => {
  test("a small multi-method match reaches all 5 reducer-written PublicArtifact kinds, and none of them needed the `d` escape hatch", () => {
    const state = playMultiMethodMatch(6, 10);
    const kindsSeen = new Set(state.publicLedger.map((a) => a.k));
    expect(kindsSeen).toEqual(new Set(["share", "cipher-pair", "sudoku-reveal", "ciphertext", "partial"]));
    expect(state.publicLedger.length).toBeGreaterThan(20);

    // `encodeArtifact` (called by reducer.ts on every write) already compared
    // its derivation against the REAL id reducer.ts built and would have kept
    // `d` on any mismatch -- so "no stored entry carries `d`" is proof every
    // one of these matched, not merely this test's own opinion of the formula.
    for (const stored of state.publicLedger) {
      expect("d" in stored).toBe(false);
    }

    // Independently recompute the expected id from each DECODED entry's own
    // fields (a second, separately-written implementation of the same
    // template, not a call into ledger-codec.ts's own derivation) and confirm
    // it matches what decode produced.
    for (const artifact of decodeLedger(state.publicLedger)) {
      expect(artifact.id).toBe(expectedIdFor(artifact));
    }
  });

  test("a share/cipher-pair-heavy match (state-size.test.ts's own worst-case shape, at a smaller team count) also needs no `d`", () => {
    // Mirrors state-size.test.ts's playFullMatch: every open Order LEAKed,
    // every hint bought first -- the scenario that worst-case measurement
    // actually runs, just at 12 teams instead of 99 so this stays fast. Same
    // construction sites (reducer.ts's applyLeak / applyLadderLeak), so this
    // is genuine evidence about the same code path at scale, not a
    // duplicate of the multi-method test above.
    //
    // [Issue #677/#688-#692] `startedMatch`, not bare `initialState` -- see
    // `playMultiMethodMatch`'s doc comment above; `state-size.test.ts`'s own
    // `playFullMatch` builds the same way now.
    const teamIds = Array.from({ length: 12 }, (_, i) => `w-team-${i}`);
    let state = startedMatch({ eventId: "ledger-codec-worst-case-shape", teamIds, matchSecret: "w".repeat(64) });
    for (let atMs = 0; atMs <= DEFAULT_CONFIG.matchDurationMs; atMs += DEFAULT_CONFIG.contractIntervalMs) {
      state = tick(state, atMs);
      for (const teamId of teamIds) {
        const leakable = state.contracts.filter(
          (c) => c.teamId === teamId && c.status === "open" && c.allowedMethods.includes("leak"),
        );
        for (const contract of leakable) {
          const op = buildLeakOp(contract.id);
          if (validateOp(state, teamId, op).ok) state = applyOp(state, teamId, op);
        }
      }
    }
    expect(state.publicLedger.length).toBeGreaterThan(100);
    for (const stored of state.publicLedger) {
      expect("d" in stored).toBe(false);
    }
    for (const artifact of decodeLedger(state.publicLedger)) {
      expect(artifact.id).toBe(expectedIdFor(artifact));
    }
  });
});

// ---------------------------------------------------------------------------
// Test 3: migrateState lifts a v1 row to v2 without losing any ledger
// content, and decodeLedger recovers it exactly.
// ---------------------------------------------------------------------------

/**
 * [Issue #679] Codex review: `method` は #650 で入ったので、 それ以前に書かれた行の share /
 * proof は持っていない。 portal は `entry.method === "leak" && entry.kind === "share"` で
 * 「晒された share」を判定するため、 `undefined` だと **晒したはずの share が守られているように
 * 見える**。 行の TTL は 7 日なので #650 直後しばらくはこの形の行が実在する。
 */
describe("ledger-codec: pre-#650 artifacts keep their participant-visible meaning", () => {
  const legacyShare = {
    id: "team-0-c0-share3",
    teamId: "team-0",
    generation: 1,
    kind: "share",
    shareIndex: 3,
    value: "12345",
    contractId: "team-0-c0",
    postedAtMs: 0,
  } as unknown as PublicArtifact;
  const legacyProof = {
    id: "team-0-c1-proof",
    teamId: "team-0",
    generation: 1,
    kind: "proof",
    contractId: "team-0-c1",
    commitment: "7",
    response: "9",
    postedAtMs: 0,
  } as unknown as PublicArtifact;

  test("migration restores `leak` on a share written before the field existed", () => {
    const migrated = migrateStateV1({ publicLedger: [legacyShare] }, 1);
    const entries = decodeLedger(migrated.publicLedger);
    expect(entries).toHaveLength(1);
    const entry = entries[0] as PublicArtifact;
    expect(entry.method).toBe("leak");
    expect(entry.kind).toBe("share");
    expect(entry.id).toBe("team-0-c0-share3");
    // portal (GameBoard.tsx) の分類がここで反転しないことが要点。
    expect(entry.method === "leak" && entry.kind === "share").toBe(true);
  });

  test("migration restores `prove` on a proof written before the field existed", () => {
    const migrated = migrateStateV1({ publicLedger: [legacyProof] }, 1);
    const entries = decodeLedger(migrated.publicLedger);
    expect(entries).toHaveLength(1);
    const entry = entries[0] as PublicArtifact;
    expect(entry.method).toBe("prove");
    expect(entry.id).toBe("team-0-c1-proof");
  });

  test("an artifact that already declares a method is left exactly as it is", () => {
    const explicit = { ...(legacyShare as object), method: "cipher" } as unknown as PublicArtifact;
    const migrated = migrateStateV1({ publicLedger: [explicit] }, 1);
    expect(decodeLedger(migrated.publicLedger)[0]?.method).toBe("cipher");
  });

  test("encodeArtifact itself stays faithful -- interpreting old shapes is migration's job", () => {
    expect(decodeLedger([encodeArtifact(legacyShare)])[0]?.method).toBeUndefined();
  });
});

describe("ledger-codec: migrateStateV1 (test 3)", () => {
  /**
   * Builds a real v2 state (via the real reducer, exercising all 5 kinds),
   * then reverse-derives what that SAME match would have looked like as a
   * v1 row: full `PublicArtifact[]` where v2 has `StoredArtifact[]`.
   * `decodeLedger` is exactly the expansion v1 always held (it is v2's own
   * inverse of the encoding this Issue introduced), so this v1 fixture is
   * not circular with `migrateStateV1`'s own implementation -- it is the
   * historical shape `migrateStateV1` exists to accept.
   */
  function buildV1AndV2(): { v1: unknown; v2: CryptoBattleState } {
    const v2 = playMultiMethodMatch(4, 8);
    const v1 = { ...v2, publicLedger: decodeLedger(v2.publicLedger) };
    return { v1, v2 };
  }

  test("migrateStateV1(v1Row, 1) produces v2's own publicLedger exactly, with every other field untouched", () => {
    const { v1, v2 } = buildV1AndV2();
    const migrated = migrateStateV1(v1, 1);
    expect(migrated.publicLedger).toEqual(v2.publicLedger);
    expect(migrated).toEqual(v2);
  });

  test("nothing in the ledger is lost: decodeLedger(migrated.publicLedger) recovers the full v1 ledger content", () => {
    const { v1 } = buildV1AndV2();
    const v1Ledger = (v1 as { publicLedger: readonly PublicArtifact[] }).publicLedger;
    expect(v1Ledger.length).toBeGreaterThan(0);
    const migrated = migrateStateV1(v1, 1);
    expect(decodeLedger(migrated.publicLedger)).toEqual([...v1Ledger]);
  });

  test("an empty v1 ledger migrates to an empty v2 ledger (the pre-first-tick / no-activity row)", () => {
    const v1 = initialState({ eventId: "ledger-codec-empty-migrate", teamIds: ["a", "b"] });
    const migrated = migrateStateV1(v1, 1);
    expect(migrated.publicLedger).toEqual([]);
    expect(migrated).toEqual(v1);
  });

  test("throws (and does not silently repair) on fromVersion !== 1", () => {
    const { v1 } = buildV1AndV2();
    expect(() => migrateStateV1(v1, 2)).toThrow();
    expect(() => migrateStateV1(v1, 0)).toThrow();
  });

  test("throws on a non-object state", () => {
    expect(() => migrateStateV1(null, 1)).toThrow();
    expect(() => migrateStateV1("not a state", 1)).toThrow();
    expect(() => migrateStateV1(undefined, 1)).toThrow();
  });

  test("throws on a state missing a publicLedger array, rather than fabricating one", () => {
    const { v1 } = buildV1AndV2();
    const { publicLedger: _drop, ...withoutLedger } = v1 as { publicLedger: unknown } & Record<string, unknown>;
    expect(() => migrateStateV1(withoutLedger, 1)).toThrow();
    expect(() => migrateStateV1({ ...withoutLedger, publicLedger: "not an array" }, 1)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Exhaustiveness / defensive-throw sanity: an unrecognized `k`/`kind` throws
// rather than silently mis-encoding, matching the codebase's `exhaustive:
// never` convention (replay.ts, reducer.ts).
// ---------------------------------------------------------------------------

describe("ledger-codec: unrecognized kinds fail loudly, not silently", () => {
  test("encodeArtifact throws on an artifact with an unrecognized `kind`", () => {
    const bogus = { ...FIXTURES[0]!, kind: "not-a-real-kind" } as unknown as PublicArtifact;
    expect(() => encodeArtifact(bogus)).toThrow();
  });

  test("decodeArtifact throws on a stored entry with an unrecognized `k`", () => {
    const bogus = { ...encodeArtifact(FIXTURES[0]!), k: "not-a-real-kind" } as unknown as StoredArtifact;
    expect(() => decodeArtifact(bogus)).toThrow();
  });
});
