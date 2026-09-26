import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SchnorrLesson, SCHNORR_LESSON_EXAMPLE as ex } from "../../portal/SchnorrLesson.tsx";
import { SCHNORR, power, simulateSchnorr, verifySchnorr } from "./schnorr.ts";

test("lesson worked examples are real protocol values", () => {
  expect(ex.Y).toBe(power(SCHNORR.g, ex.X));
  expect(ex.A).toBe(power(SCHNORR.g, ex.R));
  expect(verifySchnorr(ex.Y, ex.A, ex.E, ex.Z)).toBe(true);
  expect(ex.SIM_A).toBe(simulateSchnorr(ex.Y, ex.SIM_E, ex.SIM_Z));
  expect(verifySchnorr(ex.Y, ex.SIM_A, ex.SIM_E, ex.SIM_Z)).toBe(true);
  expect(verifySchnorr(ex.Y, ex.A, ex.E2, ex.Z2)).toBe(true);
  expect(ex.EXTRACTED).toBe(ex.X);
});

const PAGES = 8;
for (const locale of ["ja", "en"] as const) {
  test(`every lesson page renders and derives the claims from equations (${locale})`, () => {
    const pages = Array.from({ length: PAGES }, (_, i) => renderToStaticMarkup(<SchnorrLesson locale={locale} initialStep={i} />));
    for (const [i, html] of pages.entries()) expect(html).toContain(`${i + 1}/${PAGES}`);
    const all = pages.join("\n");
    // completeness derivation, simulator, extraction, and the HVZK boundary
    expect(all).toContain("g<sup>r</sup> × (g<sup>x</sup>)<sup>e</sup>");
    expect(all).toContain(`a = 6 × 6 mod 23 = ${ex.SIM_A}`);
    expect(all).toContain("z − z′ = (e − e′) × x");
    expect(all).toContain("HVZK");
    expect(all).toContain(locale === "ja" ? "逆元" : "inverse");
    expect(all).toContain(locale === "ja" ? "一対一" : "one-to-one");
    // the lesson uses a fixed example, never the player's witness
    expect(all).not.toContain("undefined");
    expect(all).not.toContain("NaN");
  });
}
