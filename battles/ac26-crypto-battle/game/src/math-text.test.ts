import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MathText from "../../portal/MathText.tsx";
import RsaMaterials from "../../portal/RsaMaterials.tsx";
import ConceptDiagram from "../../portal/ConceptDiagram.tsx";
import { EXPLANATIONS } from "../../portal/ConceptExplanation.tsx";

const math = (text: string) => renderToStaticMarkup(createElement(MathText, { children: text }));

describe("Issue #780: readable math in instructions and worked examples", () => {
  test("multiple powers preserve all surrounding arithmetic and escape HTML", () => {
    expect(math("c = 4^m × 9^r; 4^3 = 64 < 100"))
      .toBe("c = 4<sup>m</sup> × 9<sup>r</sup>; 4<sup>3</sup> = 64 &lt; 100");
    expect(math("a^−1 + 2^10 = □"))
      .toBe("a<sup>−1</sup> + 2<sup>10</sup> = □");
    expect(math("<script>2^3</script>"))
      .toBe("&lt;script&gt;2<sup>3</sup>&lt;/script&gt;");
  });

  test("the real bilingual RSA material renders the rule and example as powers", () => {
    for (const locale of ["ja", "en"] as const) {
      const html = renderToStaticMarkup(createElement(RsaMaterials, {
        locale, task: { kind: "rsa-encrypt", n: 33, e: 3, plaintext: 4 },
      }));
      expect(html).toContain("c = m<sup>e</sup> mod n");
      expect(html).toContain("3<sup>3</sup> mod 7");
      expect(html).not.toContain("^e");
      expect(html).not.toContain("3^3");
    }
  });

  test("both MPC concept routes use the three-party cancellation example and its limits", () => {
    for (const locale of ["ja", "en"] as const) {
      expect(EXPLANATIONS[locale].mpc.steps[0]!.diagram).toBe("mpc");
      const html = renderToStaticMarkup(createElement(ConceptDiagram, { kind: "mpc", locale }));
      expect(html).toContain("(a + z − x) + (b + x − y) + (c + y − z) = a + b + c");
      expect(html).toContain("A → 4 → B → 2 → C → 1 → A");
      expect(html).toContain(locale === "ja" ? "2人だけなら" : "With only two participants");
      expect(html).toContain(locale === "ja" ? "乱数" : "random number");
    }
  });
});
