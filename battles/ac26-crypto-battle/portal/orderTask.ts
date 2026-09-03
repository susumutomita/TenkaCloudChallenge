/**
 * [Issue #645] Shared rendering for an Order's task.
 *
 * Four panels show an Order, at three different levels of detail: the game
 * board's tile, the fast-move card, the operator-facing debug list, and the
 * status table. Before Phase 2 every Order asked for the same thing, so each
 * panel spelled `shares[...]` inline. With three task kinds that would be four
 * places to update, and four places to get the labels inconsistent.
 *
 * Participant-facing wording follows §12b: no term appears that the statement
 * has not already defined. "暗号文" and "覆面" are introduced in the Order's own
 * instructions and in the tutorial before any card uses them.
 */

import { rungSpec } from "../game/src/ladder.ts";
import type { OrderTaskProjection, PublicArtifact } from "../game/src/types.ts";

export type Locale = "ja" | "en";

/**
 * A compact, locale-free descriptor for operator and debug surfaces.
 *
 * Deliberately not participant-facing: it names the mechanism (`fhe-sum`)
 * rather than the story, which is what an operator reading a raw Order list
 * wants and exactly what a participant should not be handed as their first
 * impression of the job.
 */
export function describeTaskShort(task: OrderTaskProjection): string {
  switch (task.kind) {
    case "reveal-share":
      return `shares[${task.shareIndices.join(",")}]`;
    case "homomorphic-sum":
      return `fhe-sum×${task.inputs.length}`;
    case "masked-total":
      return `mpc-partial/${task.partyCount}`;
    case "caesar-shift":
      return `${task.rung}×${task.plaintext.length}/mod${task.symbols.length}`;
    default: {
      const exhaustive: never = task;
      throw new Error(`describeTaskShort: unknown task ${JSON.stringify(exhaustive)}`);
    }
  }
}

const TASK_LABELS: Readonly<Record<Locale, Readonly<Record<OrderTaskProjection["kind"], string>>>> = {
  ja: {
    "reveal-share": "share を出す",
    "homomorphic-sum": "暗号文のまま足す",
    "masked-total": "覆面をかけた小計を出す",
    // [Issue #659] 「シーザー暗号で」ではなく「自分の鍵で暗号にする」。
    // 方式名は Order 本文に書いてある (ケルクホフス) ので、ラベルは
    // *何をするか* を言う。方式名を見出しにすると、方式を知らない人には
    // ただの呪文になり、知っている人には作業の説明にならない。
    "caesar-shift": "自分の鍵で暗号にする",
  },
  en: {
    "reveal-share": "account for a share",
    "homomorphic-sum": "add without decrypting",
    "masked-total": "publish a masked subtotal",
    "caesar-shift": "encrypt it with your key",
  },
};

/** What this Order asks for, in one participant-readable phrase. */
export function taskLabel(task: OrderTaskProjection, locale: Locale): string {
  return TASK_LABELS[locale][task.kind];
}

/**
 * The concrete detail that belongs next to the label on a card: which share,
 * how many ciphertexts, how many offices. Kept short — the full working
 * material lives in the action panel, not on the card.
 */
export function taskDetail(task: OrderTaskProjection, locale: Locale): string {
  switch (task.kind) {
    case "reveal-share":
      return `share [${task.shareIndices.join(", ")}]`;
    case "homomorphic-sum":
      return locale === "ja" ? `暗号文 ${task.inputs.length} 個` : `${task.inputs.length} ciphertexts`;
    case "masked-total":
      return locale === "ja" ? `${task.partyCount} 拠点` : `${task.partyCount} offices`;
    case "caesar-shift":
      // A COUNT, not the symbols. The symbols are drawn on the card by
      // `DieRow` (see DieFace.tsx on why they are drawn and not typed), so
      // repeating them here as text would print the tofu this replaced.
      return locale === "ja"
        ? `${task.plaintext.length} 個 · ${task.symbols.length} 種類`
        : `${task.plaintext.length} symbols · mod ${task.symbols.length}`;
    default: {
      const exhaustive: never = task;
      throw new Error(`taskDetail: unknown task ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * [Issue #645] How one Public Ledger row is labelled and what it shows.
 *
 * Every method posts a different artifact shape, and #645's Public Ledger
 * requirement is that a reader can see which method a team used — so the label
 * names the method, and the payload is whatever that method legitimately made
 * public. What is NOT here is as important: no branch reaches for a secret,
 * because none of these artifacts carries one. See types.ts on each shape.
 */
export function ledgerKindLabel(artifact: PublicArtifact): string {
  switch (artifact.kind) {
    case "share":
      return "share (LEAK)";
    case "proof":
      return "proof (PROVE)";
    case "ciphertext":
      return "ciphertext (FHE)";
    case "partial":
      return "partial (MPC)";
    case "cipher-pair":
      return "pair (LEAK)";
    default: {
      const exhaustive: never = artifact;
      throw new Error(`ledgerKindLabel: unknown artifact ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** The public value a ledger row carries, rendered for a single table cell. */
const LEDGER_COPY = {
  ja: { remainderOf: "を割る数で割った余り", breaksAt: "組で鍵が割れる" },
  en: { remainderOf: "remainder the modulus", breaksAt: "pair(s) recover the key" },
} as const;

export function ledgerPayload(artifact: PublicArtifact, locale: Locale): string {
  const copy = LEDGER_COPY[locale];
  switch (artifact.kind) {
    case "share":
      return `#${artifact.shareIndex} = ${artifact.value}`;
    case "proof":
      // [Issue #701] R / e / s -- the whole transcript, in the order the
      // verification equation reads it. The challenge belongs on this row for
      // two reasons: `g^s == R * Y^e` is only checkable by a reader who has
      // `e`, and two transcripts that reuse a commitment carry two DIFFERENT
      // challenges, which is the pair of equations the nonce-reuse HUNT solves.
      // Since #701 bound the challenge to the match seed, this row is the only
      // place a participant can get it. A row written before #701 has no
      // challenge and renders the two values it does have.
      return artifact.challenge === undefined
        ? `${artifact.commitment} / ${artifact.response}`
        : `${artifact.commitment} / ${artifact.challenge} / ${artifact.response}`;
    case "ciphertext":
      return `(${artifact.r}, ${artifact.y})`;
    case "partial":
      // All three offices' partials and what they sum to.
      //
      // The remainder is stated, not implied. `total` is the sum reduced mod
      // p, and three field elements almost always add to more than p -- so
      // rendering this as a plain `a + b + c = total` was simply FALSE for the
      // common case, and false in the one direction that matters: it invited a
      // hand check that would not come out. Reproducing this row by hand is
      // the MPC lesson, so the row has to describe an addition that actually
      // reproduces.
      return `${[artifact.partial, ...artifact.peerPartials].join(" + ")} ${copy.remainderOf} = ${artifact.total}`;
    case "cipher-pair":
      // [Issue #659] The plaintext ABOVE its ciphertext, because the two lined
      // up is the break: subtract one from the other, position by position, and
      // on the bottom rung the key falls out of the first column. The row also
      // states how many such pairs this rung survives, so a reader can see at a
      // glance whether the team that posted it is already finished.
      // Values, spelled out. This is the one-line TEXT rendering of a ledger
      // row (a table cell, an operator's log); the board draws the same pair as
      // symbols. Numbers read the same in every language and cannot go tofu.
      return `${artifact.plaintext.join(" ")} → ${artifact.ciphertext.join(" ")} (${rungSpec(artifact.rung).pairsToBreak} ${copy.breaksAt})`;
    default: {
      const exhaustive: never = artifact;
      throw new Error(`ledgerPayload: unknown artifact ${JSON.stringify(exhaustive)}`);
    }
  }
}
