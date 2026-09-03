/**
 * Issue #644: the deterministic starting positions the harness can jump to.
 *
 * A UI change is usually about ONE moment of the match — an empty board, a
 * ledger with shares on it, the instant after a ROTATE, the read-only end
 * screen. Waiting 25 minutes of wall clock to reach each one is why UI work on
 * this Battle was slow.
 *
 * Every scenario below is reached by REPLAYING REAL OPS through the real
 * reducer, never by hand-assembling a `CryptoBattleState`. That is the whole
 * design constraint: a hand-built state can express a position the game's own
 * rules can never produce, and then the UI gets tuned against a board that
 * cannot happen. Here, if the rules cannot reach a position, the scenario
 * cannot either — {@link buildScenario} throws rather than fake it.
 *
 * Ops are built through `../game/src/playtest.ts`'s `buildLeakOp` /
 * `buildProveOp` / `buildHuntOp`, the same builders the committed vertical
 * playtest fixture uses. `buildHuntOp` in particular takes only a
 * `CryptoBattleProjection`, so even the HUNT that seeds the "after a successful
 * hunt" position is built from public information — the harness cannot
 * shortcut through `state.teams[target].secret` even when setting itself up.
 *
 * The clock is scenario time in ms since match start (the reducer's
 * `eventNowMs`), never wall clock — so the same scenario name always produces
 * byte-identical state.
 */

import { mod } from "../game/src/field.ts";
import { groupPow, RFC3526_GROUP14 } from "../game/src/group.ts";
import {
  buildFheOp,
  buildHuntOp,
  buildLeakOp,
  buildMpcOp,
  buildProveOp,
  buildRotateOp,
} from "../game/src/playtest.ts";
import { computeChallenge } from "../game/src/schnorr-transcript.ts";
import { deriveWitness } from "../game/src/schnorr-witness.ts";
import { initialState, projectForTeam, tick } from "../game/src/reducer.ts";
import type {
  CryptoBattleConfig,
  CryptoBattleOp,
  CryptoBattleState,
} from "../game/src/types.ts";
import { createMatch, dispatch, type MatchHost } from "./host.ts";

export const DEV_EVENT_ID = "local-dev-644";
export const DEV_TEAMS: readonly [string, string] = ["alpha", "bravo"];

/**
 * A 25-minute match, same scaling as the committed vertical playtest fixture
 * (`../game/src/vertical-playtest-fixture.ts`'s `VERTICAL_CONFIG`): the clock
 * and contract cadence shrink, `threshold` / `shareCount` / `scores` do not,
 * because neither the Shamir math nor the scoring is time-scaled.
 *
 * Deliberately the same numbers as that fixture rather than a third set: a
 * harness that ran on its own private tuning would give UI work a different
 * board from the one the committed playtest reasons about.
 */
export const DEV_CONFIG: Partial<CryptoBattleConfig> = {
  matchDurationMs: 25 * 60_000,
  phaseBoundaries: {
    buildToPressureMs: 8 * 60_000,
    pressureToEndgameMs: 18 * 60_000,
  },
  contractIntervalMs: 60_000,
  contractTtlMs: 4 * 60_000,
  rushContractTtlMs: 2 * 60_000,
  rotateCooldownMs: 3 * 60_000,
};

export const SCENARIO_IDS = [
  "waiting",
  "fresh",
  "ledger-filling",
  "fhe-order",
  "mpc-order",
  "hunt-reachable",
  "nonce-reuse",
  "after-rotate",
  "ended",
] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

export interface ScenarioCopy {
  readonly ja: string;
  readonly en: string;
}

export const SCENARIO_LABELS: Readonly<Record<ScenarioId, ScenarioCopy>> = {
  waiting: {
    ja: "デプロイ直後 — まだ誰も始めていない",
    en: "Just deployed — nobody has started it",
  },
  fresh: {
    ja: "開始直後 — Order が出たところ",
    en: "Just started — first Orders issued",
  },
  "ledger-filling": {
    ja: "中盤 — LEAK と PROVE が Ledger に並ぶ",
    en: "Midgame — LEAK and PROVE side by side on the Ledger",
  },
  "fhe-order": {
    ja: "暗号文のまま足す Order が開いている状態",
    en: "An encrypted-addition Order is open",
  },
  "mpc-order": {
    ja: "覆面つき小計の Order が開いている状態",
    en: "A masked-subtotal Order is open",
  },
  "hunt-reachable": {
    ja: "alpha の share が threshold 枚そろった状態",
    en: "alpha has leaked threshold-many shares",
  },
  "nonce-reuse": {
    ja: "alpha が同じ nonce で2回証明した — witness が復元できる",
    en: "alpha proved twice with one nonce — the witness is recoverable",
  },
  "after-rotate": {
    ja: "alpha が ROTATE した直後 — 世代が変わる",
    en: "Right after alpha ROTATEd — the generation changed",
  },
  ended: {
    ja: "試合終了 — read-only",
    en: "Match over — read-only",
  },
};

/**
 * Deliberately NOT surfaced to the player-facing panels.
 *
 * `hunt-reachable` is a scenario an author picks in the dev toolbar; the
 * participant UI still must never announce "you can hunt now" (Issue #486's
 * rule, restated in #646's non-goals). Keeping the check in this file — harness
 * chrome, never a panel — is what stops a convenience for developers turning
 * into a hint for participants.
 */
function distinctCurrentGenerationShareCount(
  state: CryptoBattleState,
  targetTeamId: string,
): number {
  const target = state.teams[targetTeamId];
  if (!target) return 0;
  // [Issue #679] `state.publicLedger` holds the compact persisted form
  // (`StoredArtifact`, see ../game/src/ledger-codec.ts) -- `k`/`tm`/`g`/`i`
  // below are that form's own field names.
  const indices = new Set<number>();
  for (const artifact of state.publicLedger) {
    if (artifact.k !== "share") continue;
    if (artifact.tm !== targetTeamId) continue;
    if (artifact.g !== target.generation) continue;
    indices.add(artifact.i);
  }
  return indices.size;
}

/** The team's own open contracts, oldest first. */
function openContractIds(state: CryptoBattleState, teamId: string): readonly string[] {
  return state.contracts
    .filter((contract) => contract.teamId === teamId && contract.status === "open")
    .map((contract) => contract.id);
}

interface Driver {
  readonly host: MatchHost;
  nowMs: number;
  advance(byMs: number): void;
  play(teamId: string, op: CryptoBattleOp): boolean;
}

function makeDriver(): Driver {
  const host = createMatch({ eventId: DEV_EVENT_ID, teamIds: DEV_TEAMS }, DEV_CONFIG);
  const driver: Driver = {
    host,
    nowMs: 0,
    advance(byMs) {
      driver.nowMs += byMs;
      host.state = tick(host.state, driver.nowMs);
    },
    /**
     * Returns whether the reducer accepted the op. Callers that REQUIRE the op
     * check the result and throw — a scenario that silently skipped a move it
     * meant to make would hand the UI a position it does not describe, which is
     * the same class of lie as a hand-built state.
     */
    play(teamId, op) {
      const result = dispatch(host.state, teamId, op);
      if (!result.ok) return false;
      host.state = result.state;
      host.version += 1;
      return true;
    },
  };
  host.state = tick(host.state, 0);
  return driver;
}

function mustPlay(driver: Driver, teamId: string, op: CryptoBattleOp, what: string): void {
  if (!driver.play(teamId, op)) {
    throw new Error(`scenario setup could not ${what}: the reducer rejected the op`);
  }
}

/** LEAK every currently-open contract for `teamId`. Returns how many landed. */
function leakOpenContracts(driver: Driver, teamId: string): number {
  let leaked = 0;
  for (const contractId of openContractIds(driver.host.state, teamId)) {
    if (driver.play(teamId, buildLeakOp(contractId))) leaked += 1;
  }
  return leaked;
}

/**
 * [Issue #645] Serve any open FHE / MPC Orders for `teamId`.
 *
 * Uses the same `buildFheOp` / `buildMpcOp` a participant's script would, off
 * the team's own projection — so a scenario reaches its position by playing the
 * game rather than by writing a state that looks like it was played.
 */
function serveComputationOrders(driver: Driver, teamId: string): number {
  let served = 0;
  const prime = driver.host.state.config.prime;
  for (const order of projectForTeam(driver.host.state, teamId).myContracts) {
    if (order.status !== "open") continue;
    const op =
      order.task.kind === "homomorphic-sum"
        ? buildFheOp(order, prime)
        : order.task.kind === "masked-total"
          ? buildMpcOp(order, prime)
          : undefined;
    if (op && driver.play(teamId, op)) served += 1;
  }
  return served;
}

/**
 * [Issue #645 Phase 5] Make `teamId` prove twice with ONE nonce.
 *
 * The careless prover is written out here rather than imported, for the same
 * reason `nonce-reuse.test.ts` keeps its own: the package must not ship a
 * prover that reuses nonces. This is a dev-harness fixture whose whole purpose
 * is to let an author see the consequence on screen.
 */
function proveTwiceWithOneNonce(driver: Driver, teamId: string): boolean {
  const group = RFC3526_GROUP14;
  const FIXED_NONCE = 424_242n;
  let proved = 0;
  for (let round = 0; round < 12 && proved < 2; round += 1) {
    const vault = projectForTeam(driver.host.state, teamId).vault;
    for (const order of projectForTeam(driver.host.state, teamId).myContracts) {
      if (proved >= 2) break;
      if (order.status !== "open" || order.task.kind !== "reveal-share") continue;
      if (!order.allowedMethods.includes("prove")) continue;
      const witness = deriveWitness(BigInt(vault.secret), vault.generation, teamId, group);
      const publicY = groupPow(group.generator, witness, group);
      const commitmentR = groupPow(group.generator, FIXED_NONCE, group);
      const e = computeChallenge(
        {
          teamId,
          contractId: order.id,
          generation: vault.generation,
          commitmentR,
          publicY,
        },
        group,
      );
      const op: CryptoBattleOp = {
        kind: "prove",
        contractId: order.id,
        proof: {
          commitment: commitmentR.toString(),
          response: mod(FIXED_NONCE + e * witness, group.order).toString(),
        },
      };
      if (driver.play(teamId, op)) proved += 1;
    }
    if (proved < 2) driver.advance(60_000);
  }
  return proved >= 2;
}

/** PROVE the oldest open contract for `teamId`, building a real Schnorr proof. */
function proveOldestContract(driver: Driver, teamId: string): boolean {
  const [contractId] = openContractIds(driver.host.state, teamId);
  if (!contractId) return false;
  const vault = projectForTeam(driver.host.state, teamId).vault;
  return driver.play(teamId, buildProveOp(vault, contractId));
}

/**
 * Advance minute by minute, leaking alpha's contracts and proving bravo's,
 * until `stop` is satisfied or the budget runs out.
 *
 * Iterating rather than scripting fixed moves is what keeps the scenarios
 * honest against `fixtures.ts`: which share index a contract asks for is
 * derived from the seed, so "leak three contracts" does not reliably produce
 * three DISTINCT indices. The loop asks the state, it does not assume.
 */
/**
 * [Issue #645] Advance the clock WITHOUT anyone serving their Orders.
 *
 * The Order-showcase scenarios need a belt with an unserved Order on it; using
 * `playUntil` would clear the very Order they exist to display.
 */
function playUntilRaw(
  driver: Driver,
  stop: (state: CryptoBattleState) => boolean,
  budgetMinutes: number,
): boolean {
  for (let minute = 0; minute < budgetMinutes; minute += 1) {
    if (stop(driver.host.state)) return true;
    driver.advance(60_000);
  }
  return stop(driver.host.state);
}

function playUntil(
  driver: Driver,
  stop: (state: CryptoBattleState) => boolean,
  budgetMinutes: number,
): boolean {
  for (let minute = 0; minute < budgetMinutes; minute += 1) {
    leakOpenContracts(driver, "alpha");
    proveOldestContract(driver, "bravo");
    // [Issue #645] Both teams also serve their FHE / MPC Orders, so a mid-match
    // scenario shows the ledger every method actually produces.
    serveComputationOrders(driver, "alpha");
    serveComputationOrders(driver, "bravo");
    if (stop(driver.host.state)) return true;
    driver.advance(60_000);
  }
  return stop(driver.host.state);
}

export interface Scenario {
  readonly id: ScenarioId;
  readonly host: MatchHost;
  /** Scenario time (ms since match start) the position was reached at. */
  readonly nowMs: number;
}

export function buildScenario(id: ScenarioId): Scenario {
  const driver = makeDriver();

  switch (id) {
    // [Issue #677] The screen a deployed match shows before anyone plays: no
    // Orders, no clock, one button. `makeDriver` starts the match because every
    // other position here is a match in progress, so this one unwinds that.
    case "waiting":
      driver.host.state = initialState({ eventId: DEV_EVENT_ID, teamIds: DEV_TEAMS }, DEV_CONFIG);
      break;

    case "fresh":
      break;

    case "ledger-filling": {
      // One LEAK and one PROVE on the ledger is the minimum that shows the
      // contrast the UI exists to teach: a share went public, a proof did not.
      if (
        !playUntil(
          driver,
          (state) =>
            state.publicLedger.some((a) => a.k === "share") &&
            state.publicLedger.some((a) => a.k === "proof"),
          10,
        )
      ) {
        throw new Error("scenario 'ledger-filling' never reached a mixed ledger");
      }
      break;
    }

    case "fhe-order": {
      // Stop as soon as an encrypted-addition Order is on alpha's belt, without
      // serving it -- the point of this position is to SHOW the Order.
      if (
        !playUntilRaw(
          driver,
          (state) =>
            state.contracts.some(
              (c) => c.teamId === "alpha" && c.status === "open" && c.task.kind === "homomorphic-sum",
            ),
          10,
        )
      ) {
        throw new Error("scenario 'fhe-order' never saw an open homomorphic-sum Order");
      }
      break;
    }

    case "mpc-order": {
      if (
        !playUntilRaw(
          driver,
          (state) =>
            state.contracts.some(
              (c) => c.teamId === "alpha" && c.status === "open" && c.task.kind === "masked-total",
            ),
          10,
        )
      ) {
        throw new Error("scenario 'mpc-order' never saw an open masked-total Order");
      }
      break;
    }

    case "nonce-reuse": {
      if (!proveTwiceWithOneNonce(driver, "alpha")) {
        throw new Error("scenario 'nonce-reuse' could not get two proofs under one nonce");
      }
      break;
    }

    case "hunt-reachable": {
      const threshold = driver.host.state.config.threshold;
      if (
        !playUntil(
          driver,
          (state) => distinctCurrentGenerationShareCount(state, "alpha") >= threshold,
          20,
        )
      ) {
        throw new Error(
          `scenario 'hunt-reachable' never reached ${threshold} distinct alpha shares`,
        );
      }
      break;
    }

    case "after-rotate": {
      const threshold = driver.host.state.config.threshold;
      if (
        !playUntil(
          driver,
          (state) => distinctCurrentGenerationShareCount(state, "alpha") >= threshold,
          20,
        )
      ) {
        throw new Error("scenario 'after-rotate' could not reach a hunt-worthy ledger first");
      }
      // bravo actually hunts, so the board shows a real -penalty / +bonus and a
      // real `huntedGenerations` entry rather than a rotate out of nowhere.
      const bravoView = projectForTeam(driver.host.state, "bravo");
      const huntOp = buildHuntOp(bravoView, "alpha", {
        prime: driver.host.state.config.prime,
        threshold,
      });
      if (!huntOp) throw new Error("scenario 'after-rotate' could not build a HUNT from the ledger");
      mustPlay(driver, "bravo", huntOp, "land bravo's HUNT");

      // ROTATE has a cooldown measured from the match start, so the clock has to
      // move past it before alpha may re-key.
      driver.advance(driver.host.state.config.rotateCooldownMs);
      mustPlay(driver, "alpha", buildRotateOp(), "rotate alpha to a new generation");
      break;
    }

    case "ended": {
      playUntil(driver, () => false, 6);
      driver.advance(driver.host.state.config.matchDurationMs);
      if (driver.host.state.phase !== "ended") {
        throw new Error("scenario 'ended' did not reach the ended phase");
      }
      break;
    }
  }

  return { id, host: driver.host, nowMs: driver.nowMs };
}
