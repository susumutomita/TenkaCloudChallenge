import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { FAST_MOVE_COPY } from "../../portal/FastMovePanel.tsx";
import { type HintContext, HINT_LADDER } from "./hints.ts";
import { projectForTeam, tick } from "./reducer.ts";
import { startedMatch } from "./playtest.ts";

/**
 * [Issue #703] One noun for one thing, in the Japanese copy.
 *
 * The live run had all three of these on a single screen: the instructions said
 * 破片, the board said `share`, and the problem is called 「かけら3枚」. The
 * player's next message was 「Share ってそもそもなに？」 -- which is what three
 * names for one object buys you. かけら is the word the problem's own title
 * uses, so it is the one that wins; `share` survives only where it is glossed
 * (「かけら (share)」), so a player can still connect the board to the English
 * material and to `ac26-w2-secret-sharing`.
 *
 * Enforced by scanning the sources rather than by importing each surface's COPY
 * object, because the failure this guards against is a NEW string in a surface
 * nobody remembered to export.
 */
const PORTAL_DIR = join(import.meta.dir, "..", "..", "portal");

/** [Issue #712] A rung is rendered against an Order; this is the first share Order of a real match. */
function shareRungContext(): HintContext {
  const state = tick(startedMatch({ eventId: "vocabulary", teamIds: ["a", "b"] }), 0);
  const projection = projectForTeam(state, "a");
  const order = projection.myContracts.find((c) => c.task.kind === "reveal-share");
  if (!order) throw new Error("test setup: expected a share Order");
  return { allowedMethods: order.allowedMethods, exposedShareIndices: [], task: order.task, vault: projection.vault, prime: projection.prime, threshold: projection.threshold, shareCount: 5 };
}

function portalSources(): { file: string; text: string }[] {
  return readdirSync(PORTAL_DIR)
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
    .map((file) => ({ file, text: readFileSync(join(PORTAL_DIR, file), "utf8") }));
}

describe("Issue #703: the Japanese copy calls a share one thing", () => {
  test("no participant-facing surface says 破片", () => {
    const offenders = portalSources().flatMap(({ file, text }) =>
      text
        .split("\n")
        .map((line, i) => ({ file, line: i + 1, text: line }))
        .filter((l) => l.text.includes("破片")),
    );
    expect(offenders).toEqual([]);
  });

  test("the problem's own metadata says 破片 nowhere either", () => {
    const metadata = readFileSync(join(import.meta.dir, "..", "..", "metadata.json"), "utf8");
    expect(metadata).not.toContain("破片");
  });

  test("`share` appears in Japanese copy only where it is glossed", () => {
    // The gloss is 「かけら (share)」 -- one line, on the card and in the first
    // hint. Everywhere else the Japanese word stands alone. A bare `share` in a
    // Japanese sentence is the drift this catches.
    const glossed = "かけら (share)";
    expect(FAST_MOVE_COPY.ja.shareWhat).toContain(glossed);
    expect(HINT_LADDER["reveal-share"][0]?.text(shareRungContext()).ja).toContain(glossed);
  });

  /**
   * [Issue #702] The first hint has to answer the question a first-time player
   * actually asks. Three levels that only weigh LEAK against PROVE assume the
   * noun; a player who does not have it bought -14 points of strategy advice
   * for a decision they could not frame.
   */
  test("the first share hint names the thing and names the move", () => {
    const first = HINT_LADDER["reveal-share"][0]?.text(shareRungContext());
    expect(first?.ja).toContain("MY VAULT");
    expect(first?.ja).toContain("LEAK");
    expect(first?.en).toContain("MY VAULT");
    expect(first?.en).toContain("LEAK");
  });

  test("the card carries the same definition for free, so it is never behind a price", () => {
    for (const locale of ["ja", "en"] as const) {
      expect(FAST_MOVE_COPY[locale].shareWhat.length).toBeGreaterThan(20);
      expect(FAST_MOVE_COPY[locale].shareDo([4])).toContain("#4");
      expect(FAST_MOVE_COPY[locale].shareDo([4])).toContain("LEAK");
    }
  });
});
