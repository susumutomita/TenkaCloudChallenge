import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const metadata = JSON.parse(await readFile(new URL("../metadata.json", import.meta.url), "utf8"));
for (const [lang, instructions, checks] of [
  ["ja", metadata.instructions, metadata.scoring.checks],
  ["en", metadata.i18n.en.instructions, metadata.i18n.en.checks],
]) {
  test(`${lang}: required position recurrence and a small worked example are free`, () => {
    for (const formula of [
      "C_0 = 0",
      "p_1 = 0",
      "C_i = C_{i-1} + L_i",
      "p_{i+1} = p_i + C_i",
      "p_{i+1} = p_i + L_i",
    ])
      assert.ok(instructions.includes(formula));
    assert.ok(instructions.includes("writes[].offset") && instructions.includes("maxEnd"));
    assert.match(instructions, lang === "ja" ? /長さ 2・3・1/ : /lengths 2, 3 and 1/);
    assert.match(
      instructions,
      lang === "ja" ? /開始位置は 0・2・7/ : /starting positions are 0, 2 and 7/,
    );
    assert.match(instructions, lang === "ja" ? /終端は 8/ : /ends at 8/);
  });
  test(`${lang}: quiz hints prompt comparison without disclosing the selected explanation`, () => {
    const hints = checks
      .filter((c) => ["boot-scope", "impact-class"].includes(c.id))
      .flatMap((c) => c.hints);
    assert.equal(hints.length, 4);
    for (const hint of hints) {
      assert.doesNotMatch(
        hint.content,
        /を選ぶ|その説明|Choose|choose:|option\s+[abc]\b|answer\s*(?:is|:)\s*[abc]\b|答えは|正解は/,
      );
      assert.doesNotMatch(
        hint.content,
        /PXE\).+only|only during network|copy runs only|Disk-only machines never|止まれば DoS|hang\/crash is DoS|steering the control field to attacker-chosen/,
      );
    }
    const advanced = hints.filter((h) => h.id.endsWith("-2"));
    assert.ok(
      advanced.every((h) =>
        lang === "ja" ? h.content.includes("【比較】") : h.content.includes("[Compare]"),
      ),
    );
  });
}
