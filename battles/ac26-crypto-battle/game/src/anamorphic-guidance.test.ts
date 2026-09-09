import {test,expect} from "bun:test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {hintsFor} from "./hints.ts";
import {initialState,projectForTeam} from "./reducer.ts";
import type {AnamorphicTask} from "./anamorphic.ts";
import {SplitAnamorphicWorksheet} from "../../portal/SplitAnamorphicWorksheet.tsx";
const task: AnamorphicTask={kind:"anamorphic-rejection",exercise:"encrypt",ordinaryKey:2,candidates:[[2,5],[3,6],[4,6],[5,5],[6,3],[1,3]],secretBits:[1,1,0,0,0,1],targetBit:0,tickets:[1,2,3,1,2,3]};
const p=projectForTeam(initialState({eventId:"hint",teamIds:["a","b"]}),"a");
function hint(exercise:AnamorphicTask["exercise"]){return hintsFor(task.kind)[2]!.text({task:{...task,exercise},vault:p.vault,prime:"7",threshold:3,shareCount:5,allowedMethods:["anamorphic"],exposedShareIndices:[]});}
test("selection hint compares this Order's rows through the first match and names the submission",()=>{
 for(const text of Object.values(hint("encrypt"))) {
  expect(text).toContain("F(c1) = 1 ≠ 0");
  expect(text).toContain("F(c2) = 1 ≠ 0");
  expect(text).toContain("F(c3) = 0 = 0");
  expect(text).not.toContain("F(c4)");
  expect(text).toContain("(4, 6)");
 }
 expect(hint("encrypt").ja).toContain("候補番号 3");
});
test("decryption hint substitutes and checks the actual ciphertext instead of asking for another task",()=>{
 for(const text of Object.values(hint("decrypt"))) {
  expect(text).toContain("(2, 5)");
  expect(text).toContain("2 × 2 = 4");
  expect(text).toContain("4 × 3 = 12 → 5");
  expect(text).toContain("m = 3");
 }
});
test("probability hint sums only the matching rows and submits the denominator",()=>{
 for(const text of Object.values(hint("probability"))) expect(text).toContain("3 + 1 + 2 = 6");
});
for(const locale of ["ja","en"] as const)test(`selection controls expose every candidate without auto-selecting a correct row (${locale})`,()=>{
 const html=renderToStaticMarkup(createElement(SplitAnamorphicWorksheet,{task,locale,busy:false,wrongCost:6,onSubmit:()=>{}}));
 expect(html.match(/aria-pressed="false"/g)).toHaveLength(6);
 expect(html).toContain("F(c<sub>i</sub>) = h");
 expect(html.match(/<input /g)).toHaveLength(1);
 expect(html).not.toContain('aria-pressed="true"');
});

for(const locale of ["ja","en"] as const)test(`free worked example belongs to its exercise (${locale})`,()=>{
 const render=(exercise:AnamorphicTask["exercise"])=>renderToStaticMarkup(createElement(SplitAnamorphicWorksheet,{task:{...task,exercise},locale,busy:false,wrongCost:6,onSubmit:()=>{}}));
 const selectionExample=locale==="ja"?"候補2を選びます":"choose candidate2";
 expect(render("encrypt")).toContain(selectionExample);
 expect(render("decrypt")).not.toContain(selectionExample);
 expect(render("probability")).not.toContain(selectionExample);
 expect(render("probability")).toContain(locale==="ja"?"合計6枚":"total6");
});
