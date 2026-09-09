import { expect, test } from "bun:test";
import { completionReceipt } from "../../portal/FastMovePanel.tsx";
import { initialState, applyOp, projectForTeam, tick } from "./reducer.ts";

test("a single accepted answer completes only its own Order; side operations cannot claim it", () => {
  const state = applyOp(initialState({eventId:"receipt",teamIds:["a","b"]}),"a",{kind:"start"});
  const before = projectForTeam(state,"a");
  const order = before.myContracts[0]!;
  expect(completionReceipt(order,before,10)).toBeUndefined();
  const after = projectForTeam(applyOp(state,"a",{kind:"leak",contractId:order.id}),"a");
  expect(completionReceipt(order,after,10)).toEqual({id:order.id,points:10,item:false});
  // A HUNT or item-use response can contain completed Orders without having submitted any Order answer.
  expect(completionReceipt(undefined,after,8)).toBeUndefined();
  expect(completionReceipt(order,after,undefined)).toBeUndefined();
  expect(completionReceipt({...order,id:"other-order"},after,30)).toBeUndefined();
  const expired = projectForTeam(tick(state,300_000),"a");
  expect(completionReceipt(order,expired,30)).toBeUndefined();
  expect(completionReceipt({...order,status:"completed"},after,10)).toBeUndefined();
});

test("an optional item completion carries an item receipt instead of a zero-point reward", async () => {
  const { STREAMING_ORDER_CONFIG } = await import("./reducer.ts");
  const { scoreItemInputs } = await import("./score-steal.fixture.ts");
  const inputs = scoreItemInputs(["a","b","c"]);
  let state = applyOp(initialState({eventId:"items",teamIds:["a","b","c"],matchSecret:"item-test",deploymentInputs:inputs},STREAMING_ORDER_CONFIG),"a",{kind:"start"});
  for (let t=0;t<=550_000;t+=10_000) {
    state=tick(state,t);
    const order=projectForTeam(state,"a").myContracts.find(c=>c.status==="open"&&c.task.kind==="ssm-decrypt");
    if (!order || order.task.kind!=="ssm-decrypt") continue;
    const material=inputs.a!.CoordinationPrivateItem;
    const next=projectForTeam(applyOp(state,"a",{kind:"claim-steal",contractId:order.id,nonce:order.task.nonce,material,answer:(order.task.ciphertext-JSON.parse(material).key+10)%10}),"a");
    expect(next.scoreSteal?.held).toBeTruthy();
    expect(completionReceipt(order,next,0)).toEqual({id:order.id,points:0,item:true});
    return;
  }
  throw Error("No item Order issued");
});
