import { describe, expect, test } from "bun:test";
import { orderLabel } from "../../portal/orderTask.ts";

describe("participant Order labels", () => {
  for (const locale of ["ja", "en"] as const) {
    test(`${locale}: reveal-share protocol identifies Schnorr, not Sudoku`, () => {
      const task = { kind: "reveal-share", shareIndices: [5] } as const;
      const label = orderLabel({ task, privacyConstraint: "none", schnorr: { y: 8 } }, locale);
      expect(label).toContain("Schnorr");
      expect(label).not.toContain("Sudoku");
      expect(label).not.toContain("かけら");
      const disclosure = orderLabel({ task, schnorr: { y: 8 }, privacyConstraint: "must-disclose" }, locale);
      expect(disclosure).not.toContain("Schnorr");
      expect(disclosure).toContain(locale === "ja" ? "公開" : "publish");
    });
    test(`${locale}: legacy Sudoku remains explicitly a model`, () => {
      expect(orderLabel({ privacyConstraint: "none", task: { kind: "zk-sudoku" } }, locale)).toContain(locale === "ja" ? "模型" : "model");
      expect(orderLabel({ privacyConstraint: "none", task: { kind: "zk-sudoku" }, schnorr: { y: 8 } }, locale)).toContain("Schnorr");
    });
  }
});
