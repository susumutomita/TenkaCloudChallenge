import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SchnorrModelNotice } from "../../portal/SchnorrModelNotice.tsx";
import { SchnorrLesson } from "../../portal/SchnorrLesson.tsx";
import { SchnorrProof } from "../../portal/SchnorrProof.tsx";
import { initialState, applyOp, projectForTeam, STREAMING_ORDER_CONFIG } from "./reducer.ts";
for(const locale of ["ja","en"] as const) test(`Schnorr limits appear before interaction or buying hints (${locale})`,()=>{
  const state=applyOp(initialState({eventId:"boundary",teamIds:["a","b"],matchSecret:"boundary"},STREAMING_ORDER_CONFIG),"a",{kind:"start"});
  const order=projectForTeam(state,"a").myContracts.find(c=>c.schnorr)!;
  expect(order).toBeDefined();
  for(const html of [renderToStaticMarkup(createElement(SchnorrModelNotice,{locale})),renderToStaticMarkup(createElement(SchnorrLesson,{locale}))]) {
    expect(html).toContain(locale==="ja"?"この模型の採点と限界":"Model scoring and limits");
    expect(html).toContain(locale==="ja"?"候補は最大11通り":"11 possible secret values");
    expect(html).toContain(locale==="ja"?"数独の解を知っているかは検査しません":"or a Sudoku solution");
    expect(html).toContain(locale==="ja"?"確かめられません":"cannot establish that you already knew");
  }
});

for(const locale of ["ja","en"] as const) test(`completed Schnorr display does not certify prior knowledge (${locale})`,()=>{
  const state=applyOp(initialState({eventId:"boundary",teamIds:["a","b"],matchSecret:"boundary"},STREAMING_ORDER_CONFIG),"a",{kind:"start"});
  const order=projectForTeam(state,"a").myContracts.find(c=>c.schnorr)!;
  // Render a completed projection fixture; this test checks copy, not protocol acceptance.
  const completed={...order,status:"completed" as const,schnorr:{...order.schnorr!,pending:{y:order.schnorr!.y,a:2,e:1,used:true,outcome:"hit" as const}}};
  const html=renderToStaticMarkup(createElement(SchnorrProof,{order:completed,teamId:"a",locale,busy:false,onSubmit:()=>{}}));
  expect(html).toContain(locale==="ja"?"模型の検証式が一致しました":"The model equation matched");
  expect(html).not.toContain(locale==="ja"?"秘密を送らずに証明できました":"you proved knowledge");
});
