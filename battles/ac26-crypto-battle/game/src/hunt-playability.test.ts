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
 *  2. scrapes the five challenge inputs out of that HTML, and nothing else;
 *  3. recomputes both challenges from the rule the Help Drawer publishes,
 *     re-implemented here from that published text rather than imported;
 *  4. solves `w = (z1 - z2) / (e1 - e2)` exactly as the statement says;
 *  5. submits it and expects the judge to accept.
 *
 * If any of those values stops being rendered, or the shipped hash rule drifts
 * from the documented one, this fails — which the internals-based test cannot
 * notice.
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusPanelBody } from "../../portal/StatusPanel.tsx";
import { inv, mod } from "./field.ts";
import { groupPow, RFC3526_GROUP14 } from "./group.ts";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import { deriveWitness } from "./schnorr-witness.ts";
import { startedMatch } from "./playtest.ts";
import type { Contract, CryptoBattleState, SchnorrProof } from "./types.ts";

const CTX = { eventId: "hunt-playability", teamIds: ["victim", "attacker"] } as const;
const VICTIM = "victim";
const ATTACKER = "attacker";
const FIXED_NONCE = 123_456_789n;

/* ------------------------------------------------------------------ *
 * The documented rule, re-implemented from the Help Drawer's Python.
 *
 *   lp = lambda t: len(t.encode()).to_bytes(4, "big") + t.encode()
 *   fw = lambda v: v.to_bytes(n, "big")
 *   e  = int.from_bytes(sha256(lp("ac26-crypto-battle/prove/v1") + lp(team)
 *          + lp(contract) + lp(str(generation)) + fw(R) + fw(Y)).digest(),
 *          "big") % q
 *
 * Deliberately NOT imported from schnorr-transcript.ts: importing it would
 * make this test agree with the implementation by construction, and what needs
 * checking is that the implementation agrees with the DOCUMENTATION.
 * ------------------------------------------------------------------ */

function lengthPrefixed(text: string): Buffer {
  const bytes = Buffer.from(text, "utf8");
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([prefix, bytes]);
}

function fixedWidth(value: bigint, byteLength: number): Buffer {
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  const raw = Buffer.from(hex, "hex");
  return Buffer.concat([Buffer.alloc(byteLength - raw.length), raw]);
}

function challengeFromPublishedRule(row: {
  teamId: string;
  contractId: string;
  generation: string;
  commitment: bigint;
  publicY: bigint;
}): bigint {
  const group = RFC3526_GROUP14;
  const byteLength = (group.p.toString(2).length + 7) >> 3;
  const digest = createHash("sha256")
    .update(
      Buffer.concat([
        lengthPrefixed("ac26-crypto-battle/prove/v1"),
        lengthPrefixed(row.teamId),
        lengthPrefixed(row.contractId),
        lengthPrefixed(row.generation),
        fixedWidth(row.commitment, byteLength),
        fixedWidth(row.publicY, byteLength),
      ]),
    )
    .digest();
  let value = 0n;
  for (const byte of digest) value = (value << 8n) | BigInt(byte);
  return mod(value, group.order);
}

/* ------------------------------------------------------------------ *
 * A victim who reused one nonce. This is the mistake, not shipped code.
 * ------------------------------------------------------------------ */

function carelessProof(
  secret: bigint,
  generation: number,
  teamId: string,
  contractId: string,
): SchnorrProof {
  const group = RFC3526_GROUP14;
  const witness = deriveWitness(secret, generation, teamId, group);
  const publicY = groupPow(group.generator, witness, group);
  const commitmentR = groupPow(group.generator, FIXED_NONCE, group);
  const e = challengeFromPublishedRule({
    teamId,
    contractId,
    generation: String(generation),
    commitment: commitmentR,
    publicY,
  });
  return {
    commitment: commitmentR.toString(),
    response: mod(FIXED_NONCE + e * witness, group.order).toString(),
  };
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
    const vault = projectForTeam(state, VICTIM).vault;
    const op = {
      kind: "prove" as const,
      contractId: order.id,
      proof: carelessProof(BigInt(vault.secret), vault.generation, VICTIM, order.id),
    };
    // The proofs VERIFY. Reuse does not make a proof invalid -- it makes the
    // pair leak. (This also confirms the re-implemented challenge rule above
    // matches the shipped verifier: a mismatch would be rejected here.)
    expect(validateOp(state, VICTIM, op)).toEqual({ ok: true });
    state = applyOp(state, VICTIM, op);
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
    const [commitment, response] = detail.split("/").map((part) => part.trim());
    if (!commitment || !response) continue;
    rows.push({ teamId, generation, contractId, commitment, response });
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
  test("every value a challenge binds is rendered", () => {
    const html = renderParticipantScreen(stateAfterCarelessProofs());
    const rows = proofRowsOnScreen(html);

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.teamId).toContain(VICTIM);
      expect(row.contractId.length).toBeGreaterThan(0);
      expect(row.generation).toBe("1");
      expect(BigInt(row.commitment)).toBeGreaterThan(0n);
      expect(BigInt(row.response)).toBeGreaterThan(0n);
    }
    // The reuse is visible as the statement describes it: same team, same
    // generation, same commitment.
    expect(rows[0]?.commitment).toBe(rows[1]?.commitment ?? "");
    expect(publicYOnScreen(html, VICTIM)).toBeDefined();
  });

  test("a reader with only the screen and the published Python recovers the key, and the judge accepts it", () => {
    const state = stateAfterCarelessProofs();
    const html = renderParticipantScreen(state);

    const rows = proofRowsOnScreen(html).filter((r) => r.teamId.startsWith(VICTIM));
    const [first, second] = rows;
    if (!first || !second) throw new Error("expected two proof rows on screen");
    const publicY = publicYOnScreen(html, VICTIM);
    if (!publicY) throw new Error("expected the victim's Y on screen");

    const group = RFC3526_GROUP14;
    const challengeOf = (row: ScreenProofRow) =>
      challengeFromPublishedRule({
        teamId: row.teamId,
        contractId: row.contractId,
        generation: row.generation,
        commitment: BigInt(row.commitment),
        publicY: BigInt(publicY),
      });

    // key = (z1 - z2) / (e1 - e2), exactly as the statement gives it.
    const gap = mod(challengeOf(first) - challengeOf(second), group.order);
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
