/**
 * [Issue #645 Phase 3] The MPC slice, from the protocol up to the judge.
 *
 * Two properties carry the Order, and both are executed here rather than
 * asserted in prose: the masks cancel, so the three partials really do add up
 * to the total nobody published; and one partial is consistent with every
 * possible input, so publishing it reveals nothing.
 *
 * The third thing under test is the boundary. A team's own number reaches that
 * team's projection and nowhere else — not another team's projection, and not
 * the Public Ledger.
 */

import { describe, expect, test } from "bun:test";
import { add, mod, P, sub } from "./field.ts";
import {
  allPartials,
  computePartial,
  deriveMpcPrivateInputs,
  expectedMpcPartial,
  expectedMpcTotal,
  MPC_PARTY_COUNT,
  sumInField,
} from "./mpc.ts";
import { buildMpcOp, startedMatch } from "./playtest.ts";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import type { ContractProjection, CryptoBattleState } from "./types.ts";

const CTX = { eventId: "mpc-tests", teamIds: ["teamA", "teamB"] } as const;
const SEED = "mpc-tests";
const ORDER = "teamA-c3";

function mpcOrder(teamId = "teamA"): { state: CryptoBattleState; order: ContractProjection } {
  let state = tick(startedMatch(CTX), 0);
  for (let issued = 0; issued < 20; issued += 1) {
    const order = projectForTeam(state, teamId).myContracts.find(
      (c) => c.status === "open" && c.task.kind === "masked-total",
    );
    if (order) return { state, order };
    state = tick(state, (issued + 1) * DEFAULT_CONFIG.contractIntervalMs);
  }
  throw new Error(`no open masked-total order for ${teamId} within 20 issuance rounds`);
}

describe("the protocol", () => {
  /**
   * The reason the protocol exists: the client adds the published partials and
   * gets the true total, without any office ever publishing its own number.
   */
  test("the partials sum to the total, so the client learns it without any input being published", () => {
    for (const orderId of [ORDER, "teamB-c7", "teamA-c11"]) {
      const partials = allPartials(SEED, orderId, P);
      expect(partials).toHaveLength(MPC_PARTY_COUNT);
      expect(sumInField(partials, P)).toBe(expectedMpcTotal(SEED, orderId, P));
    }
  });

  /**
   * Executes the hiding argument: for ANY candidate input there is a set of
   * masks producing the same published partial, so the partial constrains the
   * input not at all.
   */
  test("a published partial is consistent with every possible input", () => {
    const inputs = deriveMpcPrivateInputs(SEED, ORDER, P);
    const published = computePartial(inputs, P);

    for (const candidate of [0n, 1n, 7n, P - 3n]) {
      // Keep the outgoing masks; solve for one incoming mask that reproduces
      // the same partial from the candidate input.
      const sent = inputs.outgoingMasks.reduce((acc, m) => add(acc, m, P), 0n);
      const otherIncoming = inputs.incomingMasks.slice(1).reduce((acc, m) => add(acc, m, P), 0n);
      const solvedMask = sub(sub(add(published, sent, P), candidate, P), otherIncoming, P);
      const alternative = {
        myInput: candidate,
        incomingMasks: [solvedMask, ...inputs.incomingMasks.slice(1)],
        outgoingMasks: inputs.outgoingMasks,
      };
      expect(computePartial(alternative, P)).toBe(mod(published, P));
    }
  });

  test("the mask one office sends is independent of the one it receives back", () => {
    // If m[i][j] and m[j][i] were the same value they would cancel inside a
    // single partial instead of across two, and the protocol would hide nothing.
    const inputs = deriveMpcPrivateInputs(SEED, ORDER, P);
    expect(inputs.incomingMasks).not.toEqual(inputs.outgoingMasks);
    expect(inputs.incomingMasks).toHaveLength(MPC_PARTY_COUNT - 1);
    expect(inputs.outgoingMasks).toHaveLength(MPC_PARTY_COUNT - 1);
  });

  test("each Order gets its own inputs and masks", () => {
    expect(deriveMpcPrivateInputs(SEED, "teamA-c3", P)).not.toEqual(
      deriveMpcPrivateInputs(SEED, "teamA-c7", P),
    );
  });
});

describe("the MPC Order's trust boundary", () => {
  test("the owning team sees its number and masks; the Order's stored payload does not carry them", () => {
    const { state, order } = mpcOrder();
    if (order.task.kind !== "masked-total") throw new Error("unreachable");

    expect(order.task.myInput).toBeDefined();
    expect(order.task.incomingMasks).toHaveLength(MPC_PARTY_COUNT - 1);

    // The stored Order — what every other read path sees — has the party count
    // and nothing else.
    const stored = state.contracts.find((c) => c.id === order.id);
    expect(stored?.task).toEqual({ kind: "masked-total", partyCount: MPC_PARTY_COUNT });
    expect(JSON.stringify(stored)).not.toContain(order.task.myInput);
  });

  test("another team's projection never contains this team's number or masks", () => {
    const { state, order } = mpcOrder();
    if (order.task.kind !== "masked-total") throw new Error("unreachable");

    const otherView = JSON.stringify(projectForTeam(state, "teamB"));
    expect(otherView).not.toContain(order.task.myInput);
    for (const mask of [...order.task.incomingMasks, ...order.task.outgoingMasks]) {
      expect(otherView).not.toContain(mask);
    }
  });

  test("a correct partial is accepted and scores the Order's points", () => {
    const { state, order } = mpcOrder();
    const op = buildMpcOp(order, state.config.prime);
    if (!op) throw new Error("expected buildMpcOp to construct an op");

    expect(validateOp(state, "teamA", op)).toEqual({ ok: true });
    const next = applyOp(state, "teamA", op);
    expect(next.teams.teamA?.score).toBe(order.points);
    expect(next.contracts.find((c) => c.id === order.id)?.resolution).toBe("mpc");
  });

  test("the published partial lands on the ledger, and the team's own number does not", () => {
    const { state, order } = mpcOrder();
    if (order.task.kind !== "masked-total") throw new Error("unreachable");
    const op = buildMpcOp(order, state.config.prime);
    if (!op) throw new Error("expected buildMpcOp to construct an op");
    const next = applyOp(state, "teamA", op);

    const entry = next.publicLedger.find((a) => a.k === "partial");
    expect(entry).toBeDefined();
    expect(entry?.m).toBe("mpc");
    expect(entry?.k === "partial" ? entry.v : "").toBe(
      expectedMpcPartial(next.seed, order.id, BigInt(next.config.prime)).toString(),
    );

    const serialized = JSON.stringify(next.publicLedger);
    expect(serialized).not.toContain(order.task.myInput);
    for (const mask of [...order.task.incomingMasks, ...order.task.outgoingMasks]) {
      expect(serialized).not.toContain(mask);
    }
  });

  /**
   * The Order's story finishing, not just its arithmetic being checked.
   *
   * Before this, the runtime recorded one office's partial, scored it, and
   * stopped — the total the client wanted, and that the statement promises,
   * was produced nowhere outside the tests. A participant did the work and
   * never saw the point of it.
   */
  test("completing the Order produces the total, and the participant can reproduce it by adding the row", () => {
    const { state, order } = mpcOrder();
    const op = buildMpcOp(order, state.config.prime);
    if (!op) throw new Error("expected buildMpcOp to construct an op");
    const next = applyOp(state, "teamA", op);

    const entry = next.publicLedger.find((a) => a.k === "partial");
    if (entry?.k !== "partial") throw new Error("expected a partial artifact");

    expect(entry.pp).toHaveLength(MPC_PARTY_COUNT - 1);

    const prime = BigInt(next.config.prime);
    // The four published numbers are self-consistent: adding the three
    // partials gives the total, which is what the ledger row invites the
    // participant to check by hand.
    expect(sumInField([entry.v, ...entry.pp].map(BigInt), prime).toString()).toBe(
      entry.s,
    );
    // And it is the REAL total -- the sum of the three private inputs, which
    // nobody published.
    expect(entry.s).toBe(expectedMpcTotal(next.seed, order.id, prime).toString());
  });

  test("the total is published, but no input and no mask is", () => {
    const { state, order } = mpcOrder();
    if (order.task.kind !== "masked-total") throw new Error("unreachable");
    const op = buildMpcOp(order, state.config.prime);
    if (!op) throw new Error("expected buildMpcOp to construct an op");
    const next = applyOp(state, "teamA", op);

    // The whole point: the client learns the total while every office's own
    // number stays private. Adding the aggregate to the ledger must not have
    // quietly added anything else.
    const serialized = JSON.stringify(next.publicLedger);
    expect(serialized).not.toContain(order.task.myInput);
    for (const mask of [...order.task.incomingMasks, ...order.task.outgoingMasks]) {
      expect(serialized).not.toContain(mask);
    }
    const inputs = deriveMpcPrivateInputs(next.seed, order.id, BigInt(next.config.prime));
    expect(serialized).not.toContain(inputs.myInput.toString());
  });

  test("publishing the raw input instead of the masked partial is refused", () => {
    const { state, order } = mpcOrder();
    if (order.task.kind !== "masked-total") throw new Error("unreachable");

    const verdict = validateOp(state, "teamA", {
      kind: "mpc",
      contractId: order.id,
      partial: order.task.myInput,
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.error).toContain("does not match this office's masked total");
  });

  test("a malformed partial is rejected, not thrown on", () => {
    const { state, order } = mpcOrder();
    for (const partial of ["", "-4", "nope", "1".repeat(701)]) {
      const verdict = validateOp(state, "teamA", { kind: "mpc", contractId: order.id, partial });
      expect(verdict.ok).toBe(false);
      if (verdict.ok) throw new Error("unreachable");
      expect(verdict.error).toContain("canonical");
    }
  });

  /**
   * Same hole the FHE branch had, and worse here: `applyMpc` puts the
   * submitted partial into the published `a + b + c` sum, so one unreduced
   * value makes the ledger's own arithmetic impossible to reproduce by hand —
   * which is the thing that row exists to make possible.
   */
  test("a partial shifted by the modulus is refused, so the remainder step cannot be skipped", () => {
    const { state, order } = mpcOrder();
    const op = buildMpcOp(order, state.config.prime);
    if (!op || op.kind !== "mpc") throw new Error("expected buildMpcOp to construct an op");
    const prime = BigInt(state.config.prime);

    const verdict = validateOp(state, "teamA", {
      kind: "mpc",
      contractId: order.id,
      partial: (BigInt(op.partial) + prime).toString(),
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.error).toContain("reduced");

    // The reduced answer still passes.
    expect(validateOp(state, "teamA", op)).toEqual({ ok: true });
  });

  test("every published partial and the total are field elements", () => {
    const { state, order } = mpcOrder();
    const op = buildMpcOp(order, state.config.prime);
    if (!op) throw new Error("expected buildMpcOp to construct an op");
    const next = applyOp(state, "teamA", op);
    const entry = next.publicLedger.find((a) => a.k === "partial");
    if (entry?.k !== "partial") throw new Error("expected a partial artifact");

    const prime = BigInt(next.config.prime);
    for (const value of [entry.v, ...entry.pp, entry.s]) {
      expect(BigInt(value) < prime).toBe(true);
      expect(BigInt(value) >= 0n).toBe(true);
    }
  });

  test("MPC cannot be used on an FHE Order", () => {
    const { state } = mpcOrder();
    const fheOrder = state.contracts.find(
      (c) => c.teamId === "teamA" && c.status === "open" && c.task.kind === "homomorphic-sum",
    );
    if (!fheOrder) throw new Error("expected an open FHE order");

    const verdict = validateOp(state, "teamA", {
      kind: "mpc",
      contractId: fheOrder.id,
      partial: "1",
    });
    expect(verdict.ok).toBe(false);
  });

  test("another team's MPC Order is refused even with a correct answer", () => {
    const { state, order } = mpcOrder("teamB");
    const op = buildMpcOp(order, state.config.prime);
    if (!op) throw new Error("expected buildMpcOp to construct an op");

    const verdict = validateOp(state, "teamA", op);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.error).toContain("belongs to another team");
  });
});
