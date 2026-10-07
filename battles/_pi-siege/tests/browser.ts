import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright-core";
import { createHandler } from "../dev/server.ts";

// Exercise the real Portal component through visible controls only. No reducer
// imports, fixture seeding, direct op requests, or private projection reads.
const output = process.env.BROWSER_OUTPUT_DIR ?? "reports/browser";
await mkdir(output, { recursive: true });
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createHandler() });
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const errors: string[] = [];
const aContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const bContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const a = await aContext.newPage(), b = await bContext.newPage();
for (const p of [a, b]) { p.setDefaultTimeout(12000); p.on("pageerror", error => errors.push(error.message)); }
const url = `http://127.0.0.1:${server.port}`;
const button = (p: Page, name: string) => p.getByRole("button", { name, exact: true });
const visible = (p: Page, text: string) => p.getByText(text, { exact: false }).first().waitFor({ state: "visible" });
const feedback = (p: Page, text: string) => p.locator(".pi-feedback").getByText(text, { exact: false }).first().waitFor({ state: "visible" });
const pass = async (p: Page) => { await button(p, "このラウンドの行動を終える（残りの券は持ち越さない）").click(); };
const publish = async (p: Page) => { await button(p, "主張を公開する（券1枚）").click(); await feedback(p, "主張を公開した"); };
const audit = async (p: Page) => { await button(p, "反例・根拠不足を指摘する（券1枚）").click(); await feedback(p, "監査成立。+4"); };
const trial = async (p: Page, name: string, result: string) => { await button(p, `${name}（券1枚）`).click(); await feedback(p, result); };
const table = async (p: Page, cells: string[]) => { for (let i = 0; i < cells.length; i++) await p.getByRole("textbox", { name: `セル ${i + 1}`, exact: true }).fill(cells[i]!); };

try {
  await Promise.all([a.goto(`${url}/?team=alpha`), b.goto(`${url}/?team=bravo`)]);
  await visible(a, "まず分数3/1を試すと");
  await visible(a, "研究原稿の誤りを見つける競技ではありません");
  await button(a, "準備完了").click(); await visible(a, "相手の準備を待っています");
  await visible(b, "相手は準備完了");
  await button(b, "準備完了").click();
  await visible(a, "ROUND 1"); await visible(b, "ROUND 1");
  console.log("Browser: round 1 + retry");
  await a.getByText("無料の式と小さい例", { exact: true }).click();
  await visible(a, "q=5なら三乗の基準");
  await a.getByText("段階ヒント（無料・券不要）", { exact: true }).click();
  await a.getByText("2. 式と小さい例", { exact: true }).click();
  await visible(a, "誤差は3/2−4/3=1/6");

  // Lose a response AFTER the server accepts the move; replay via the visible
  // recovery button must use exactly the same request and spend only one ticket.
  let drop = true; const submitted: string[] = [];
  await a.route("**/api/op?team=alpha", async route => {
    submitted.push(route.request().postData()!);
    if (drop) { drop = false; await route.fetch(); await route.abort("failed"); }
    else await route.continue();
  });
  await button(a, "分母を120まで広げる（券1枚）").click();
  await visible(a, "通信結果を確認できません");
  await button(a, "同じ操作を再送").click();
  await feedback(a, "探索できる分母を 120");
  assert.equal(submitted.length, 2); assert.equal(submitted[0], submitted[1]);
  assert.match(await a.locator(".pi-scoreboard").innerText(), /5\s*枚/);
  await a.unroute("**/api/op?team=alpha");
  await trial(b, "分数を試す", "3/1: 誤差の目安は 約0.1415927");
  await a.getByRole("spinbutton", { name: "分子 p", exact: true }).fill("355");
  await a.getByRole("spinbutton", { name: /分母 q/ }).fill("113");
  await trial(a, "分数を試す", "この一回は基準より良い");
  assert.equal(await b.getByText("355/113", { exact: false }).count(), 0);
  await a.reload(); await visible(a, "355/113: 誤差の目安");
  await b.getByRole("combobox", { name: "主張の範囲", exact: true }).selectOption("forever");
  await publish(b); await audit(a); await feedback(a, "分数そのものが間違いという判定ではない");
  await pass(b); await publish(a); await pass(a);

  await visible(b, "ROUND 2");
  console.log("Browser: round 2");
  await table(b, ["1", "1/2", "1", "5/8"]); await trial(b, "数表を試す", "対角の積の差 = 1/8");
  await table(a, ["1", "1/2", "1", "1/2"]); await trial(a, "数表を試す", "対角の積の差 = 0");
  await b.getByRole("textbox", { name: "公開する下限", exact: true }).fill("1/64"); await publish(b);
  await a.getByRole("textbox", { name: "公開する下限", exact: true }).fill("1/16"); await publish(a);
  await b.getByRole("combobox", { name: "監査の理由", exact: true }).selectOption("zero"); await audit(b);
  await feedback(b, "ゼロならこの下限は使えない"); await pass(a); await pass(b);

  await visible(a, "ROUND 3");
  console.log("Browser: round 3");
  await trial(a, "配置を試す", "合計 = 6");
  await b.getByRole("spinbutton", { name: "試す種類1の枚数", exact: true }).fill("2");
  const cards = b.getByLabel("種類と次数の配置", { exact: true });
  assert.equal(await cards.locator(".pi-card-0").count(), 2); assert.equal(await cards.locator(".pi-card-1").count(), 2);
  await trial(b, "配置を試す", "合計 = 4");
  await a.getByRole("spinbutton", { name: "公開する指数", exact: true }).fill("6"); await publish(a);
  await b.getByRole("spinbutton", { name: "反例の種類1の枚数", exact: true }).fill("2");
  // Visible cards: types sum 0+0+1+1=2; degrees sum 0+1+0+1=2.
  await b.getByRole("spinbutton", { name: "反例の指数", exact: true }).fill("4"); await audit(b);
  await feedback(b, "実際の項が非零・大きいという判定ではない");
  await a.screenshot({ path: `${output}/round-3-desktop.png`, fullPage: true });
  await button(a, "行を5枚へ増やす（券1枚）").click(); await feedback(a, "行カードを 5 枚");
  await b.getByRole("spinbutton", { name: "公開する指数", exact: true }).fill("4"); await publish(b);
  await pass(a); await pass(b);

  await visible(b, "ROUND 4");
  console.log("Browser: round 4");
  await button(b, "目盛りを1/50へ細かくする（券1枚）").click(); await feedback(b, "1/50 刻み");
  await trial(a, "配分を試す", "誤差側 ν(1−b)−1 = -1/10");
  await b.getByRole("spinbutton", { name: "配分の分子", exact: true }).fill("27");
  await trial(b, "配分を試す", "入口2つと調整後2つ、4つ全て正");
  await publish(a); await b.getByRole("combobox", { name: "監査の理由", exact: true }).selectOption("error"); await audit(b);
  await pass(a); await publish(b); await pass(b);
  await visible(a, "試合終了 · 有限の競技から論文へ"); await visible(b, "試合終了 · 有限の競技から論文へ");
  await visible(a, "橙チームの勝ち");
  assert.match(await a.locator(".pi-scoreboard").innerText(), /青チーム\s*1\s*点\s*橙チーム\s*27\s*点/);
  await visible(a, "有限のゲームがπの指数2を証明した意味でも");
  await visible(a, "検証済みの新定理とは断言しない");
  await visible(a, "研究原稿の定理を反証したことにはなりません");
  assert.equal(await a.locator(".pi-debrief article").count(), 14);
  await a.screenshot({ path: `${output}/debrief-desktop.png`, fullPage: true });
  await a.setViewportSize({ width: 390, height: 844 });
  assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await a.screenshot({ path: `${output}/debrief-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log("PASS: two isolated browser seats, 4 rounds, 8 claims, three mathematical counterexamples + scope audit, lost-response retry, private trial, refresh, hand-calculated mixed arrangement, 1–27 final score, debrief, mobile width, no page errors.");
  console.log(`Screenshots: ${output}`);
} catch (error) {
  await a.screenshot({ path: `${output}/failure-alpha.png`, fullPage: true });
  await b.screenshot({ path: `${output}/failure-bravo.png`, fullPage: true });
  console.error("Alpha visible state:", await a.locator("main").innerText());
  console.error("Bravo visible state:", await b.locator("main").innerText());
  throw error;
} finally {
  await browser.close(); server.stop(true);
}
