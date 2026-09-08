import { describe, expect, test } from "bun:test";
import { orderLabel, orderDetail } from "../../portal/orderTask.ts";

describe("participant Order labels", () => {
  for (const locale of ["ja", "en"] as const) {
    test(`${locale}: reveal-share protocol identifies Schnorr, not Sudoku`, () => {
      const task = { kind: "reveal-share", shareIndices: [5] } as const;
      const label = orderLabel({ task, allowedMethods: ["prove"], privacyConstraint: "none", schnorr: { y: 8 } }, locale);
      expect(label).toContain("Schnorr");
      expect(label).not.toContain("Sudoku");
      expect(label).not.toContain("かけら");
      const disclosure = orderLabel({ task, schnorr: { y: 8 }, allowedMethods: ["leak"], privacyConstraint: "must-disclose" }, locale);
      expect(disclosure).not.toContain("Schnorr");
      expect(disclosure).toContain(locale === "ja" ? "公開" : "publish");
    });
    test(`${locale}: legacy Sudoku remains explicitly a model`, () => {
      expect(orderLabel({ allowedMethods: ["prove"], privacyConstraint: "none", task: { kind: "zk-sudoku" } }, locale)).toContain(locale === "ja" ? "模型" : "model");
      expect(orderLabel({ allowedMethods: ["prove"], privacyConstraint: "none", task: { kind: "zk-sudoku" }, schnorr: { y: 8 } }, locale)).toContain("Schnorr");
    });
  }
});

for (const locale of ["ja", "en"] as const) {
  test(`${locale}: mixed routes stay visible and Schnorr details exclude Sudoku`, () => {
    const order = { task: { kind: "reveal-share", shareIndices: [1] }, schnorr: { y: 8 }, privacyConstraint: "none", allowedMethods: ["leak", "prove"] } as const;
    const label = orderLabel(order, locale);
    expect(orderDetail(order, locale)).toContain("[1]");
    expect(label).toContain("Schnorr");
    expect(label).toContain(locale === "ja" ? "公開" : "Publish");
    const detail = orderDetail({ allowedMethods: ["prove"], privacyConstraint: "none", task: { kind: "zk-sudoku" }, schnorr: { y: 8 } }, locale);
    expect(orderDetail({ ...order, privacyConstraint: "must-disclose" }, locale)).not.toContain(locale === "ja" ? "証明" : "Proof");
    expect(detail).toContain("a");
    expect(detail).toContain("z");
    expect(detail).not.toContain("4");
    expect(orderDetail({ allowedMethods: ["prove"], privacyConstraint: "none", task: { kind: "zk-sudoku" } }, locale)).toContain("4");
  });
}

for (const locale of ["ja", "en"] as const) {
  test(`${locale}: failed single-use Schnorr response leaves only disclosure`, () => {
    const order = { task: { kind: "reveal-share", shareIndices: [1] }, privacyConstraint: "none", allowedMethods: ["leak", "prove"], schnorr: { y: 8, pending: { y: 8, a: 3, e: 6, used: true, outcome: "miss" } } } as const;
    expect(orderLabel(order, locale)).toContain(locale === "ja" ? "公開" : "publish");
    expect(orderLabel(order, locale)).not.toContain("Schnorr");
    expect(orderDetail(order, locale)).not.toContain(locale === "ja" ? "証明" : "Proof");
  });
}
