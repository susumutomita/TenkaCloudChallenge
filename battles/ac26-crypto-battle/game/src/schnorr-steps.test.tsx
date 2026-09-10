import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SchnorrResponseSteps } from "../../portal/SchnorrProof.tsx";

for (const locale of ["ja", "en"] as const) {
  test(`response guide uses this player's values without filling the answer (${locale})`, () => {
    const html = renderToStaticMarkup(<SchnorrResponseSteps r={5} x={5} e={10} locale={locale} />);
    expect(html).toContain("10 × 5 = □①");
    expect(html).toContain("□① + 5 = □②");
    expect(html).toContain("□② ÷ 11");
    expect(html.match(/<li>/g)).toHaveLength(4);
    expect(html).toContain(locale === "ja" ? "計算した余り z" : "Calculated remainder z");
    expect(html).not.toContain("value=\"");
  });
}
test("zero challenge and randomness remain visible", () => {
  const html = renderToStaticMarkup(<SchnorrResponseSteps r={0} x={7} e={0} locale="ja" />);
  expect(html).toContain("0 × 7 = □①");
  expect(html).toContain("□① + 0 = □②");
  expect(html).toContain("11未満なら、そのまま");
});
