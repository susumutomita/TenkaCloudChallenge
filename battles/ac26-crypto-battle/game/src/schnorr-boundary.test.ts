import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SchnorrLesson } from "../../portal/SchnorrLesson.tsx";
import { SchnorrProof } from "../../portal/SchnorrProof.tsx";
import { initialState, applyOp, projectForTeam, STREAMING_ORDER_CONFIG } from "./reducer.ts";
for(const locale of ["ja","en"] as const) test(`Schnorr limits appear before interaction or buying hints (${locale})`,()=>{
  const state=applyOp(initialState({eventId:"boundary",teamIds:["a","b"],matchSecret:"boundary"},STREAMING_ORDER_CONFIG),"a",{kind:"start"});
  const order=projectForTeam(state,"a").myContracts.find(c=>c.schnorr)!;
  expect(order).toBeDefined();
  for(const html of [renderToStaticMarkup(createElement(SchnorrProof,{order,teamId:"a",locale,busy:false,onSubmit:()=>{}})),renderToStaticMarkup(createElement(SchnorrLesson,{locale}))]) {
    expect(html).toContain(locale==="ja"?"この模型の採点と限界":"Model scoring and limits");
    expect(html).toContain(locale==="ja"?"候補は11通り":"11 possible secret values");
    expect(html).toContain(locale==="ja"?"シェアの値や数独の解":"share value or a Sudoku solution");
    expect(html).toContain(locale==="ja"?"保証できません":"cannot establish prior knowledge");
  }
});
