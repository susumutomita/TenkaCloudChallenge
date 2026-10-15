import {expect,test} from "bun:test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {buildScenario} from "../../dev/scenarios.ts";
import {buildHuntOp} from "./playtest.ts";
import {applyOp,projectForTeam,tick,validateOp} from "./reducer.ts";
import {BreachNotice} from "../../portal/BreachNotice.tsx";
test("victim sees attacker and actual loss, including floor; notification survives polls and rotate",()=>{
  for(const startingScore of [0,5,100]) {
    let state=buildScenario("hunt-reachable").host.state;
    state={...state,teams:{...state.teams,alpha:{...state.teams.alpha!,score:startingScore}}};
    const op=buildHuntOp(projectForTeam(state,"bravo"),"alpha",{prime:state.config.prime,threshold:state.config.threshold})!;
    expect(validateOp(state,"bravo",op).ok).toBe(true);
    state=applyOp(state,"bravo",op);
    const projection=projectForTeam(state,"alpha");
    expect(projection.lastBreach).toMatchObject({attackerTeamId:"bravo",method:"share",generation:1,sequence:1,points:-Math.min(startingScore,state.config.scores.huntPenalty)||0});
    expect(projectForTeam(state,"bravo").lastBreach).toBeUndefined();
    expect(projectForTeam(tick(state,state.nowMs!),"alpha").lastBreach).toEqual(projection.lastBreach);
    const html=renderToStaticMarkup(createElement(BreachNotice,{projection,locale:"ja",onDefend:()=>{}}));
    expect(html).toContain('role="alert"'); expect(html).toContain("秘密を見破られました"); expect(html).toContain("bravo"); expect(html).toContain("防御を確認");
    if(startingScore===0)expect(html).toContain("得点の減少は0点");
    const rotateCost=projection.vault.rotatePenalty!;
    const scoreBeforeRotate=state.teams.alpha!.score;
    state=applyOp(state,"alpha",{kind:"rotate"});
    expect(scoreBeforeRotate-state.teams.alpha!.score).toBe(rotateCost);
    const retired=renderToStaticMarkup(createElement(BreachNotice,{projection:projectForTeam(state,"alpha"),locale:"ja",onDefend:()=>{}}));
    expect(retired).toContain("以前の秘密");expect(retired).not.toContain('role="alert"');
  }
});
test("a failed attack does not notify its target",()=>{
  let state=buildScenario("hunt-reachable").host.state;
  const op=buildHuntOp(projectForTeam(state,"bravo"),"alpha",{prime:state.config.prime,threshold:state.config.threshold})!;
  if(op.kind!=="hunt")throw new Error("share expected");
  state=applyOp(state,"bravo",{...op,recoveredSecret:String((BigInt(op.recoveredSecret)+1n)%97n)});
  expect(projectForTeam(state,"alpha").lastBreach).toBeUndefined();
});
