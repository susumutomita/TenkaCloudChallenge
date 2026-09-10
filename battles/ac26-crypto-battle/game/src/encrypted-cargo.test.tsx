import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import EncryptedCargo from "../../portal/EncryptedCargo.tsx";
import FirstMission from "../../portal/FirstMission.tsx";

for (const locale of ["ja", "en"] as const) {
  test(`projected cargo preserves column mapping without filling answers (${locale})`, () => {
    const html = renderToStaticMarkup(<EncryptedCargo locale={locale} inputs={[{r:"48",y:"86"},{r:"63",y:"81"}]} prime="97" left="" right="" onLeft={()=>{}} onRight={()=>{}} />);
    expect(html).toContain("48 + 63 = □");
    expect(html).toContain("86 + 81 = □");
    expect(html).toContain('value=""');
    expect(html).not.toContain('value="14"');
    expect(html).not.toContain('value="70"');
    expect(html).toContain(locale === "ja" ? "掛け算も扱う完全準同型暗号" : "not full FHE");
  });
  test(`practice starts without an earned result (${locale})`, () => {
    const html = renderToStaticMarkup(<FirstMission locale={locale} onLearn={()=>{}} onDone={()=>{}} />);
    expect(html).toContain(locale === "ja" ? "時間制限・得点・減点なし" : "no deadline, points or penalties");
    expect(html).not.toContain("配送完了！");
    expect(html).not.toContain("Delivered!");
    expect(html).toContain("disabled");
  });
}

test("the completion explanation opens FHE directly instead of another selection step", async () => {
  const { default: ConceptExplanation } = await import("../../portal/ConceptExplanation.tsx");
  for (const locale of ["ja", "en"] as const) {
    const html = renderToStaticMarkup(<ConceptExplanation locale={locale} initialTopic="fhe" embedded />);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("1 / 4");
  }
});
