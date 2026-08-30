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
  },
  en: {
    "reveal-share": "account for a share",
    "homomorphic-sum": "add without decrypting",
    "masked-total": "publish a masked subtotal",
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
    default: {
      const exhaustive: never = artifact;
      throw new Error(`ledgerKindLabel: unknown artifact ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** The public value a ledger row carries, rendered for a single table cell. */
export function ledgerPayload(artifact: PublicArtifact): string {
  switch (artifact.kind) {
    case "share":
      return `#${artifact.shareIndex} = ${artifact.value}`;
    case "proof":
      return `${artifact.commitment} / ${artifact.response}`;
    case "ciphertext":
      return `(${artifact.r}, ${artifact.y})`;
    case "partial":
      return artifact.partial;
    default: {
      const exhaustive: never = artifact;
      throw new Error(`ledgerPayload: unknown artifact ${JSON.stringify(exhaustive)}`);
    }
  }
}
