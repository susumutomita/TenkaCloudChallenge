import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import { createLab } from "../dev/server.ts";
const repair =
  'actor.active && ((actor.tenant == document.tenant && (action == "read" || actor.role == "editor")) || (action == "read" && grant.valid))';
const detector =
  'event.allowed && event.actorTenant != event.documentTenant && !(event.action == "read" && event.grantValid)';
const lab = createLab(),
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: lab.handler });
const browser = await chromium.launch({
  headless: true,
  ...(Bun.env.BROWSER ? { executablePath: Bun.env.BROWSER } : {}),
});
const [a, b] = await Promise.all([browser.newPage(), browser.newPage()]);
const errors: string[] = [];
for (const page of [a!, b!]) page.on("pageerror", (e) => errors.push(e.message));
const click = async (page: typeof a, name: string) =>
  page!.getByRole("button", { name, exact: true }).click();
const wait = async (page: typeof a, text: string) =>
  page!.getByText(text, { exact: true }).first().waitFor();
await mkdir(new URL("../docs/evidence/", import.meta.url), { recursive: true });
try {
  await a!.goto(`http://127.0.0.1:${server.port}/#seat=${lab.seats.alpha}`);
  await b!.goto(`http://127.0.0.1:${server.port}/#seat=${lab.seats.bravo}`);
  await click(a, "準備完了");
  await wait(b, "準備完了した席: 1 / 2");
  await click(b, "準備完了");
  for (let round = 1; round <= 4; round++) {
    const defender = round % 2 ? a! : b!,
      attacker = round % 2 ? b! : a!;
    await wait(attacker, "操作と証拠を比較");
    if (round === 1) {
      let drop = true;
      const bodies: string[] = [];
      await attacker.route("**/api/op", async (route) => {
        bodies.push(route.request().postData()!);
        if (drop) {
          drop = false;
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      });
      await click(attacker, "読む");
      await click(attacker, "同じ操作を再送");
      await attacker.unroute("**/api/op");
      assert.equal(bodies.length, 2);
      assert.equal(bodies[0], bodies[1]);
    } else await click(attacker, "読む");
    await attacker.getByText("read · allowed=true · damage=+25", { exact: true }).waitFor();
    await click(attacker, "証拠を渡す");
    await wait(defender, "認可と検知を実装");
    if (round === 1) {
      await defender.getByLabel("認可式", { exact: true }).fill("false");
      await click(defender, "公開テスト");
      await defender.getByText("FAIL · active reader blue → blue read", { exact: true }).waitFor();
      await defender.setViewportSize({ width: 390, height: 844 });
      assert(await defender.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await defender.screenshot({
        path: new URL("../docs/evidence/repair-mobile-ja.png", import.meta.url).pathname,
        fullPage: true,
      });
      await defender.setViewportSize({ width: 1280, height: 900 });
    }
    await defender.getByLabel("認可式", { exact: true }).fill(repair);
    await defender.getByLabel("検知式", { exact: true }).fill(detector);
    await click(defender, "公開テスト");
    await defender
      .getByText("PASS · allowed cross-tenant read, no grant → alert", { exact: true })
      .waitFor();
    assert.equal(await defender.getByLabel("公開テスト結果").getByText(/^FAIL/).count(), 0);
    await click(defender, "修正を適用して再試験");
    await wait(attacker, "再試験");
    await click(attacker, "読む");
    await attacker.getByText("read · allowed=false · damage=0", { exact: true }).waitFor();
    if (round === 3) {
      const shared = await attacker
        .getByLabel("対象ノート")
        .locator("option")
        .filter({ hasText: "Shared reading copy" })
        .getAttribute("value");
      await attacker.getByLabel("対象ノート").selectOption(shared!);
      await click(attacker, "読む");
      await attacker.getByText("read · allowed=true · damage=0", { exact: true }).waitFor();
      await click(attacker, "変更する");
      await attacker.getByText("edit · allowed=false · damage=0", { exact: true }).waitFor();
    }
    await defender
      .getByText(
        round === 3 ? "edit · allowed=false · damage=0" : "read · allowed=false · damage=0",
        { exact: true },
      )
      .waitFor();
    await click(defender, "正規業務・境界・検知を再検証");
    await defender
      .getByText("境界 48/48 · 正規業務 16/16 · 検知 128/128 · PASS", { exact: true })
      .waitFor();
    await attacker
      .getByText("境界 48/48 · 正規業務 16/16 · 検知 128/128 · PASS", { exact: true })
      .waitFor();
    await click(attacker, "攻撃の再試験を完了");
  }
  await wait(a, "試合終了");
  await wait(b, "試合終了");
  assert.equal(await a!.getByText("200 pt", { exact: true }).count(), 2);
  await a!.screenshot({
    path: new URL("../docs/evidence/replay-ja.png", import.meta.url).pathname,
    fullPage: true,
  });
  await b!.goto(`http://127.0.0.1:${server.port}/?lang=en#seat=${lab.seats.bravo}`);
  await wait(b, "Match finished");
  await b!.getByRole("heading", { name: "Tenant Boundary Duel", exact: true }).waitFor();
  await b!.screenshot({
    path: new URL("../docs/evidence/replay-en.png", import.meta.url).pathname,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS visible controls: baseline evidence, failed public test then code repair, four rounds, read-only delegation, exact response-loss retry, JA/EN, 390px mobile, 200–200 history; no page errors",
  );
} catch (error) {
  console.error(await a!.locator("body").innerText());
  console.error(await b!.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
  server.stop(true);
}
