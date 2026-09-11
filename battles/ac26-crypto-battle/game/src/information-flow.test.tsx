import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import LeakHuntRules, { LEAK_HUNT_RULES } from "../../portal/LeakHuntRules.tsx";
import { disclosurePreview, orderHeading } from "../../portal/OrderFocus.tsx";
import type { ContractProjection, CryptoBattleProjection } from "./types.ts";

// These deliberately minimal projections contain public fixtures, not a live match or seed.
const projection = {
  prime: "97", threshold: 3, vault: { teamId: "alpha", generation: 2 },
  publicLedger: [
    { kind: "share", teamId: "alpha", generation: 1, shareIndex: 2 },
    { kind: "share", teamId: "bravo", generation: 2, shareIndex: 3 },
    { kind: "share", teamId: "alpha", generation: 2, shareIndex: 1 },
    { kind: "share", teamId: "alpha", generation: 2, shareIndex: 1 },
  ],
} as unknown as CryptoBattleProjection;
function shareOrder(indices: number[], required = false): ContractProjection {
  return { task: { kind: "reveal-share", shareIndices: indices }, privacyConstraint: required ? "must-disclose" : "none" } as ContractProjection;
}

describe("free LEAK-to-HUNT rules", () => {
  for (const locale of ["ja", "en"] as const) {
    test(`${locale}: starts open, with fixed examples and every current HUNT target`, () => {
      const html = renderToStaticMarkup(<LeakHuntRules locale={locale} />);
      expect(html).toContain("<details");
      expect(html).toContain('open=""');
      expect(html).toContain(LEAK_HUNT_RULES[locale].title);
      const disclaimer = renderToStaticMarkup(<span>{LEAK_HUNT_RULES[locale].disclaimer}</span>).slice(6, -7);
      expect(html).toContain(disclaimer);
      expect(html).toContain("5 − 2 = 3");
      expect(html).toContain("RSA");
      expect(html).toContain("Rotor");
      expect(html).not.toContain('type="submit"');
      expect(LEAK_HUNT_RULES[locale].rows).toHaveLength(6);
    });
  }
  test("legacy Sudoku is explained only when requested", () => {
    expect(renderToStaticMarkup(<LeakHuntRules locale="ja" />)).not.toContain("旧数独模型");
    expect(renderToStaticMarkup(<LeakHuntRules locale="ja" legacySudoku />)).toContain("旧数独模型");
  });
  test("worked examples preserve one value from LEAK through the HUNT answer", () => {
    expect((2 + 3) % 7).toBe(5);
    expect((5 - 2 + 7) % 7).toBe(3);
    expect(((3 * 2 - 3 * 5 + 3) % 7 + 7) % 7).toBe(1);
    expect(LEAK_HUNT_RULES.ja.shareRule).toContain("番号1・2・3専用");
    expect(LEAK_HUNT_RULES.en.shareRule).toContain("only to indices 1, 2, 3");
  });
  test("does not equate Schnorr's witness with the Shamir secret", () => {
    expect(LEAK_HUNT_RULES.ja.prove).toContain("シェアの値を知っているかは検査しません");
    expect(LEAK_HUNT_RULES.en.prove).toContain("does not check knowledge of a share");
  });
  test("RSA inputs are prime factors, not plaintext, ciphertext or the private exponent", () => {
    expect(LEAK_HUNT_RULES.ja.rows[4][1]).toContain("LEAKは不要");
    expect(LEAK_HUNT_RULES.ja.rows[4][2]).toContain("異なる素数2個");
  });
});

describe("LEAK button previews name the HUNT answer", () => {
  test("a share is not described as directly publishing the original secret", () => {
    expect(orderHeading(shareOrder([2]), "ja")).toContain("かけら #2");
    expect(orderHeading(shareOrder([2]), "ja")).not.toContain("秘密を公開");
    expect(disclosurePreview(projection, shareOrder([2]), "ja")).toContain("元の秘密そのものではありません");
  });
  test("duplicates, other teams and retired generations do not inflate exposure", () => {
    expect(disclosurePreview(projection, shareOrder([1]), "ja")).toContain("1 → 1 個");
    expect(disclosurePreview(projection, shareOrder([2]), "ja")).toContain("1 → 2 個");
    expect(disclosurePreview(projection, shareOrder([2, 3]), "ja")).toContain("1 → 3 個");
    expect(disclosurePreview(projection, shareOrder([2, 3]), "ja")).toContain("復元の材料がそろいます");
  });
  test("required disclosure retains its meaning and does not offer an alternative", () => {
    expect(orderHeading(shareOrder([2], true), "ja")).toContain("公開が条件");
    expect(orderHeading(shareOrder([2], true), "en")).toContain("publication required");
  });
  test("Caesar explicitly asks for the key, not the already-visible plaintext", () => {
    const order = { task: { kind: "caesar-shift", rung: "caesar", pairsToBreak: 1 } } as ContractProjection;
    expect(disclosurePreview(projection, order, "ja")).toContain("平文や暗号文を当てるのではありません");
    expect(disclosurePreview(projection, order, "en")).toContain("enter the key in HUNT");
  });
  test("RSA and Rotor retain their different attack conditions", () => {
    const rsa = { task: { kind: "rsa-encrypt" } } as ContractProjection;
    const rotor = { task: { kind: "rotor-encrypt" } } as ContractProjection;
    expect(disclosurePreview(projection, rsa, "ja")).toContain("LEAKは不要");
    expect(disclosurePreview(projection, rotor, "ja")).toContain("候補が残る");
    expect(disclosurePreview(projection, rotor, "en")).toContain("initial a and b");
  });
  test("non-LEAK tasks do not acquire a fake disclosure rule", () => {
    const order = { task: { kind: "masked-total" } } as ContractProjection;
    expect(disclosurePreview(projection, order, "ja")).toBe("");
  });
});
