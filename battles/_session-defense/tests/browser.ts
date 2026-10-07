import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { createLab } from "../dev/server.ts";
import { strict as assert } from "node:assert";
const lab=createLab();const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:lab.handler});
const base=`http://127.0.0.1:${server.port}`;
const browser=await chromium.launch({headless:true,...(Bun.env.BROWSER?{executablePath:Bun.env.BROWSER}:{})});
const contexts=await Promise.all([browser.newContext(),browser.newContext()]);
const pages=await Promise.all(contexts.map(c=>c.newPage()));const errors:string[]=[];
for(const page of pages)page.on("pageerror",e=>errors.push(e.message));
const [alpha,bravo]=pages;
await mkdir(new URL("../docs/evidence/",import.meta.url),{recursive:true});
const wait=async(page:typeof alpha,text:string)=>page.getByText(text,{exact:true}).first().waitFor();
const click=async(page:typeof alpha,name:string|RegExp)=>{const button=page.getByRole("button",{name,exact:typeof name==="string"});await button.waitFor();await button.click();};
try {
  await alpha!.goto(`${base}/#seat=${lab.seats.alpha}`);await bravo!.goto(`${base}/#seat=${lab.seats.bravo}`);
  await click(alpha!,"準備完了");await wait(bravo!,"準備完了した席: 1 / 2");await click(bravo!,"準備完了");
  const actionNames=[/架空の管理者を追加/,/ダミー顧客のリンクを解除/,/ダミー顧客表を持ち出す/,/模擬広告の予算を変更/];
  const controls=[[/初回ログインを強化/,/HttpOnlyを設定/],[/今あるセッションを失効/],[/今あるセッションを失効/,/重要操作で追加本人確認/],[/管理操作は別担当者も承認/,/普段の役割は担当者に限定/]];
  for(let round=1;round<=4;round++){
    const defender=round%2?alpha!:bravo!,attacker=round%2?bravo!:alpha!;
    await wait(attacker,"試す → 被害を確認");await click(attacker,"演習用の証拠を入力へコピー");
    if(round===1){
      // Deliver an operation, then lose its response; retry only through the visible UI.
      let drop=true;await attacker.route("**/api/op",async route=>{if(drop){drop=false;await route.fetch();await route.abort("failed");}else await route.continue();});
      await click(attacker,actionNames[0]!);await click(attacker,"同じ操作を再送");await attacker.unroute("**/api/op");
    }else await click(attacker,actionNames[0]!);
    await attacker.getByText("実行された · +40",{exact:true}).waitFor();
    await click(attacker,"被害を確認した・防衛役へ");await wait(defender,"予算6で対策を選ぶ");
    for(const control of controls[round-1]!)await defender.getByRole("checkbox",{name:control}).check();
    await click(defender,"この対策で再試験へ");await click(defender,"正規の担当者で仕事を確認");await wait(defender,"正規の仕事も通った");
    await wait(attacker,"再試験");await click(attacker,"演習用の証拠を入力へコピー");
    for(const name of actionNames){await click(attacker,name);await attacker.waitForTimeout(100);}
    if(round===1){await attacker.reload();await wait(attacker,"再試験");await attacker.screenshot({path:new URL("../docs/evidence/baseline-reuse.png",import.meta.url).pathname,fullPage:true});}
    if(round===3){await defender.setViewportSize({width:390,height:844});await defender.screenshot({path:new URL("../docs/evidence/defense-mobile.png",import.meta.url).pathname,fullPage:true});assert(await defender.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await defender.setViewportSize({width:1280,height:900});}
    await click(attacker,"このラウンドを精算");
  }
  await wait(alpha!,"リプレイから何が分かる？");await wait(bravo!,"リプレイから何が分かる？");
  assert((await alpha!.getByText(/R4 · 橙チーム: 58/).count())===1);assert((await alpha!.getByText(/R3 · 青チーム: 65/).count())===1);
  await alpha!.getByText("4ラウンドの操作記録",{exact:true}).click();await alpha!.screenshot({path:new URL("../docs/evidence/final-replay.png",import.meta.url).pathname,fullPage:true});
  await bravo!.goto(`${base}/?lang=en#seat=${lab.seats.bravo}`);await wait(bravo!,"What does the replay show?");assert.equal(errors.length,0,errors.join("\n"));
  console.log("PASS: two isolated browser contexts, visible inputs only, 4 rounds, response-loss retry, reload, actual dummy assets, comparison, replay, EN, 390px overflow, no page errors");
} catch(error) {await alpha!.screenshot({path:new URL("../docs/evidence/browser-failure.png",import.meta.url).pathname,fullPage:true});console.error(await alpha!.locator("body").innerText());console.error(await bravo!.locator("body").innerText());throw error;}
finally {await browser.close();server.stop(true);}
