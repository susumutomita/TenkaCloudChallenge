import { expect, test } from "bun:test";
import { completionReceipt } from "../portal/FastMovePanel.tsx";
import { initialState, applyOp, projectForTeam, tick } from "../game/src/reducer.ts";

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
  const { STREAMING_ORDER_CONFIG } = await import("../game/src/reducer.ts");
  const { scoreItemInputs } = await import("../game/src/score-steal.fixture.ts");
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

for (const [secondHand, expected] of [[1,10],[2,0],[3,30]] as const) test(`RPS final opening completes with its own ${expected}-point reward`, async () => {
  const { commit } = await import("../game/src/commitment.ts");
  const { rpsOrderReward } = await import("../portal/FastMovePanel.tsx");
  let state=tick(applyOp(initialState({eventId:"rps",teamIds:["a","b"],matchSecret:"private-test-fixture"},{contractsPerIssue:6}),"a",{kind:"start"}),60_000);
  const a=projectForTeam(state,"a").myContracts.find(c=>c.task.kind==="rps-duel")!;
  const b=projectForTeam(state,"b").myContracts.find(c=>c.task.kind==="rps-duel")!;
  expect(rpsOrderReward(b)).toBeUndefined();
  state=applyOp(state,"a",{kind:"rps-commit",contractId:a.id,commitment:commit(1,2)});
  state=applyOp(state,"b",{kind:"rps-commit",contractId:b.id,commitment:commit(secondHand,3)});
  state=applyOp(state,"a",{kind:"rps-open",contractId:a.id,hand:1,randomness:2});
  state=applyOp(state,"b",{kind:"rps-open",contractId:b.id,hand:secondHand,randomness:3});
  const next=projectForTeam(state,"b");
  const reward=rpsOrderReward(next.myContracts.find(c=>c.id===b.id));
  expect(reward).toBe(expected);
  expect(completionReceipt(b,next,reward)).toEqual({id:b.id,points:expected,item:false});
});

for (const method of ["fhe","mpc"] as const) test(`completed ${method} receipt includes the settled Lightning bonus`, async () => {
  const { createMatch, readProjection, submitOp } = await import("./host.ts");
  const { buildFheOp, buildMpcOp } = await import("../game/src/playtest.ts");
  const { orderReward } = await import("../portal/orderReward.ts");
  const host=createMatch({eventId:"lightning",teamIds:["alpha","bravo"],matchSecret:"lightning-test"},{phaseBoundaries:{buildToPressureMs:60_000,pressureToEndgameMs:300_000},rushContractTtlMs:300_000});
  host.state={...host.state,teams:{...host.state.teams,alpha:{...host.state.teams.alpha!,score:200},bravo:{...host.state.teams.bravo!,score:400}}};
  readProjection(host,"alpha",300_000);
  const before=projectForTeam(host.state,"alpha");
  const order=before.myContracts.find(c=>c.status==="open"&&c.allowedMethods.includes(method))!;
  expect(submitOp(host,"alpha",{kind:"declare-lightning",contractId:order.id},300_000).kind).toBe("ok");
  const op=method==="fhe"?buildFheOp(order,before.prime):buildMpcOp(order,before.prime);
  if(!op)throw Error("Missing answer fixture");
  expect(submitOp(host,"alpha",op,300_001).kind).toBe("ok");
  const next=projectForTeam(host.state,"alpha");
  const receipt=completionReceipt(order,next,orderReward(order,next));
  expect(receipt?.points).toBe(order.points*2);
});
