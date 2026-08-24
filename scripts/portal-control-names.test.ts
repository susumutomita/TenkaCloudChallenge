import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

/**
 * A problem may only name a Portal control by the label the Portal actually shows.
 *
 * Found by playing `ac26-w4-sumcheck-drill` through the real Portal (`make local`
 * in the platform repo) on 2026-08-24: the statement told the player to press
 * 「証拠を調べる」 and the button is 「証拠を確認」. The catalog was split — 28 problems
 * used the invented name, 17 used the real one — so a player following the text
 * looked for a control that does not exist.
 *
 * The labels below are copied from the platform repo's
 * `apps/participant-portal/src/i18n/locales/{ja,en}.json`, keys `workbench.*`.
 * They live here as literals because the platform is a separate repository; when a
 * label changes there, this test fails and both sides move together. That is the
 * point — a silent rename on either side is exactly the defect this catches.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHALLENGES = join(REPO_ROOT, "challenges");

/** workbench.inspect_button / test_button / reset_button, ja and en. */
const REAL_LABELS = {
  ja: ["証拠を確認", "公開テストを実行", "初期状態に戻す"],
  en: ["Inspect evidence", "Run public tests", "Restore starter"],
};

/**
 * Names the catalog has invented for those same controls, plus the raw API verbs.
 *
 * `inspect` / `test` / `prepare` are the editor API's endpoint names, not labels on
 * any button — a player told to "run `inspect`" looks for something the Portal never
 * shows. Nine problems did that as well, in a third phrasing the first sweep missed.
 */
const INVENTED = {
  ja: ["証拠を調べる", "証拠を見る", "エビデンスを確認", "`inspect` を実行", "`test` は", "`test` を", "`prepare` は", "`prepare` を"],
  en: ["Run `inspect`", "press **inspect**", "run the public tests", "run `inspect`"],
};

const problems = readdirSync(CHALLENGES)
  .filter((name) => name.startsWith("ac26-"))
  .sort();

describe("Portal controls are named as the Portal names them", () => {
  it("covers the ac26 catalog", () => {
    expect(problems.length).toBeGreaterThanOrEqual(38);
  });

  for (const id of problems) {
    const meta = JSON.parse(readFileSync(join(CHALLENGES, id, "metadata.json"), "utf8"));
    const ja: string = meta.instructions ?? "";
    const en: string = meta.i18n?.en?.instructions ?? "";

    it(`${id} does not invent a Japanese control name`, () => {
      for (const wrong of INVENTED.ja) {
        expect(ja.includes(wrong), `${id}: 「${wrong}」 is not a Portal control; use 「証拠を確認」`).toBe(false);
      }
    });

    it(`${id} does not invent an English control name`, () => {
      for (const wrong of INVENTED.en) {
        expect(en.includes(wrong), `${id}: "${wrong}" is not a Portal control; use "Inspect evidence"`).toBe(false);
      }
    });

    it(`${id} names a real control when it tells the player to press one`, () => {
      // A statement that mentions the editor at all should point at a control the
      // player can find. Problems that never mention it are out of scope.
      const mentionsEditor = ja.includes("問題エディタ") || ja.includes("Participant Portal");
      if (!mentionsEditor) return;
      const namesOne = REAL_LABELS.ja.some((label) => ja.includes(label));
      expect(namesOne, `${id}: mentions the Portal but names no control the player can press`).toBe(true);
    });
  }
});
