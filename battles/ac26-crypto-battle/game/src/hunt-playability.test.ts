/**
 * [Issue #645 Phase 5] Can a HUMAN actually perform the nonce-reuse HUNT?
 *
 * §12c says a playability claim must come from what a participant can see, and
 * that play which reads repository internals "proves nothing about human
 * playability and must not be cited as if it did". `nonce-reuse.test.ts` calls
 * `computeChallenge` and `buildNonceReuseHuntOp` — shipped code. It proves the
 * HUNT is *implementable*. It cannot prove it is *playable*, and in fact it
 * passed while two of the five values a challenge binds — the Order id and the
 * target's public value Y — reached no participant surface at all.
 *
 * So this file imports NO transcript, prover or hunt helper. It:
 *
 *  1. renders the participant's own Status panel to HTML;
 *  2. scrapes the transcripts out of that HTML, and nothing else;
 *  3. solves `w = (s1 - s2) / (e1 - e2)` exactly as the statement says;
 *  4. submits it and expects the judge to accept.
 *
 * [Issue #701] Step 3 used to be "recompute both challenges from the rule the
 * Help Drawer publishes". It cannot be, any more, and that is the point of the
 * rebuild: the challenge is bound to the match seed, so a participant CANNOT
 * derive it -- they read it, off the transcript on the Public Ledger. Which
 * makes this test's own premise stricter rather than looser: if the challenge
 * ever stops being rendered, this attack stops being available to a human at
 * all, and this file is what notices.
 */

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusPanelBody } from "../../portal/StatusPanel.tsx";
import { inv, mod } from "./field.ts";
import { groupPow, HAND_GROUP as PROVE_GROUP } from "./group.ts";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import { deriveWitness } from "./schnorr-witness.ts";
import { startedMatch } from "./playtest.ts";
import type { Contract, CryptoBattleState, SchnorrProof } from "./types.ts";

const CTX = { eventId: "hunt-playability", teamIds: ["victim", "attacker"] } as const;
const VICTIM = "victim";
const ATTACKER = "attacker";
const FIXED_NONCE = 123_456_789n;

function carelessExchange(
  state: CryptoBattleState,
  contractId: string,
): CryptoBattleState {
  const group = PROVE_GROUP;
  const vault = projectForTeam(state, VICTIM).vault;
  const witness = deriveWitness(BigInt(vault.secret), vault.generation, VICTIM, group);
  const commitmentR = groupPow(group.generator, FIXED_NONCE, group);
  const committed = applyOp(state, VICTIM, {
    kind: "prove-commit",
    contractId,
    commitment: commitmentR.toString(),
  });
  const order = projectForTeam(committed, VICTIM).myContracts.find((c) => c.id === contractId);
  if (!order?.proveChallenge) throw new Error(`no challenge on ${contractId}`);
  const op = {
    kind: "prove-respond" as const,
    contractId,
    response: mod(FIXED_NONCE + BigInt(order.proveChallenge) * witness, group.order).toString(),
  };
  // The proofs VERIFY. Reuse does not make a proof invalid -- it makes the
  // pair leak.
  expect(validateOp(committed, VICTIM, op)).toEqual({ ok: true });
  return applyOp(committed, VICTIM, op);
}

function stateAfterCarelessProofs(): CryptoBattleState {
  let state = tick(startedMatch(CTX), 0);
  let open: Contract[] = [];
  // Both Orders must be open in the SAME state the proofs are submitted
  // against -- collecting across ticks would let the first one expire.
  for (let round = 0; round < 20; round += 1) {
    open = state.contracts.filter(
      (c) => c.teamId === VICTIM && c.status === "open" && c.task.kind === "reveal-share",
    );
    if (open.length >= 2) break;
    state = tick(state, (round + 1) * DEFAULT_CONFIG.contractIntervalMs);
  }
  expect(open.length).toBeGreaterThanOrEqual(2);

  for (const order of open.slice(0, 2)) {
    state = carelessExchange(state, order.id);
  }
  return state;
}

/* ------------------------------------------------------------------ *
 * Reading the screen -- the only channel this test is allowed to use.
 * ------------------------------------------------------------------ */

interface ScreenProofRow {
  readonly teamId: string;
  readonly generation: string;
  readonly contractId: string;
  readonly commitment: string;
  /** [Issue #701] Read, never derived -- see this file's header. */
  readonly challenge: string;
  readonly response: string;
}

function renderParticipantScreen(state: CryptoBattleState): string {
  return renderToStaticMarkup(
    createElement(StatusPanelBody, {
      projection: projectForTeam(state, ATTACKER),
      locale: "en" as const,
      elapsedSincePollMs: 0,
    }),
  );
}

/** Ledger rows, straight off the rendered table: team | gen | kind | order | detail | when. */
function proofRowsOnScreen(html: string): ScreenProofRow[] {
  const rows: ScreenProofRow[] = [];
  for (const [, body] of html.matchAll(/<tr>((?:<td[^>]*>.*?<\/td>)+)<\/tr>/g)) {
    const cells = [...(body ?? "").matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(([, cell]) =>
      (cell ?? "").replace(/<[^>]+>/g, "").trim(),
    );
    if (cells.length < 5) continue;
    const [teamId, generation, kind, contractId, detail] = cells;
    if (!kind?.includes("proof") || !teamId || !generation || !contractId || !detail) continue;
    const [commitment, challenge, response] = detail.split("/").map((part) => part.trim());
    if (!commitment || !challenge || !response) continue;
    rows.push({ teamId, generation, contractId, commitment, challenge, response });
  }
  return rows;
}

/** Y, straight off the rendered public-commitments list. */
function publicYOnScreen(html: string, teamId: string): string | undefined {
  const list = html.split("Public commitments").at(1) ?? "";
  const entries = [...list.matchAll(/<dt[^>]*>(.*?)<\/dt><dd[^>]*>(.*?)<\/dd>/g)];
  for (const [, rawTeam, rawValue] of entries) {
    const name = (rawTeam ?? "").replace(/<[^>]+>/g, "").trim();
    if (name === teamId || name.startsWith(teamId)) return (rawValue ?? "").replace(/<[^>]+>/g, "").trim();
  }
  return undefined;
}

describe("the nonce-reuse HUNT is computable from the screen alone", () => {
  test("the whole transcript -- R, e and s -- is on the screen", () => {
    const html = renderParticipantScreen(stateAfterCarelessProofs());
    const rows = proofRowsOnScreen(html);

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.teamId).toContain(VICTIM);
      expect(row.contractId.length).toBeGreaterThan(0);
      expect(row.generation).toBe("1");
      expect(BigInt(row.commitment)).toBeGreaterThan(0n);
      // [Issue #701] The value a participant cannot compute, and therefore the
      // one that has to be rendered.
      expect(BigInt(row.challenge)).toBeGreaterThanOrEqual(0n);
      expect(BigInt(row.response)).toBeGreaterThanOrEqual(0n);
    }
    // The reuse is visible as the statement describes it: same team, same
    // generation, same commitment.
    expect(rows[0]?.commitment).toBe(rows[1]?.commitment ?? "");
    expect(publicYOnScreen(html, VICTIM)).toBeDefined();
  });

  test("a reader with only the screen recovers the key, and the judge accepts it", () => {
    const state = stateAfterCarelessProofs();
    const html = renderParticipantScreen(state);

    const rows = proofRowsOnScreen(html).filter((r) => r.teamId.startsWith(VICTIM));
    const [first, second] = rows;
    if (!first || !second) throw new Error("expected two proof rows on screen");
    const publicY = publicYOnScreen(html, VICTIM);
    if (!publicY) throw new Error("expected the victim's Y on screen");

    const group = PROVE_GROUP;
    // key = (s1 - s2) / (e1 - e2), exactly as the statement gives it, from the
    // two challenges the screen showed.
    const gap = mod(BigInt(first.challenge) - BigInt(second.challenge), group.order);
    expect(gap).not.toBe(0n);
    const recovered = mod(
      mod(BigInt(first.response) - BigInt(second.response), group.order) * inv(gap, group.order),
      group.order,
    );

    // It really is the discrete log behind the Y that was on screen.
    expect(groupPow(group.generator, recovered, group).toString()).toBe(publicY);

    const op = {
      kind: "hunt-nonce" as const,
      targetTeamId: VICTIM,
      generation: Number(first.generation),
      recoveredWitness: recovered.toString(),
    };
    expect(validateOp(state, ATTACKER, op)).toEqual({ ok: true });
    const before = state.teams[ATTACKER]?.score ?? 0;
    expect(applyOp(state, ATTACKER, op).teams[ATTACKER]?.score).toBe(
      before + state.config.scores.huntBonus,
    );
  });
});
