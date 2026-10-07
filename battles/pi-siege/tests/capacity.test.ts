import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { initialState, projectForTeam, teamScores } from "../game/reducer.ts";
import { playCapacityTrace, type CapacityRoute } from "./capacity-trace.ts";
const routes: readonly CapacityRoute[] = ["audits","upgrades","held","experiments"];
// Fixed 2-team profiles. Rounded measured envelope; not a multi-team forecast.
const declared: {baseBytes:number;bytesPerTeam:number} = JSON.parse(readFileSync(new URL("../metadata.json",import.meta.url),"utf8")).interTeamCoordination.stateBudget;
test("metadata fixes the measured two-team envelope",()=>expect(declared).toEqual({baseBytes:0,bytesPerTeam:32768}));
for(const route of routes) test(`2 teams / ${route}: complete legal histories, every transition and JSON restore`,()=>{
  const result=playCapacityTrace(route);
  console.info(JSON.stringify({route,peak:result.peak,final:result.final,transitions:result.transitions}));
  expect(result.transitions).toBe(50);
  expect(result.state.phase).toBe("ended");
  expect(result.state.receipts).toHaveLength(50);
  expect(result.peak).toBeGreaterThanOrEqual(result.final);
  expect(result.peak).toBeLessThanOrEqual(declared.baseBytes+2*declared.bytesPerTeam);
  if(route==="held") expect(Object.values(teamScores(result.state))).toEqual([24,24]);
  if(route==="audits"||route==="upgrades") {expect(result.state.claims).toHaveLength(8);expect(result.state.ledger).toHaveLength(16);}
  const restored=JSON.parse(JSON.stringify(result.peakState));
  for(const id of restored.roster) expect(projectForTeam(restored,id)).toEqual(projectForTeam(result.peakState,id));
  expect(teamScores(restored)).toEqual(teamScores(result.peakState));
});
test("only two teams are supported, names are bounded without truncating identity",()=>{
  for(const count of [0,1,3,99]) expect(()=>initialState({eventId:"roster",teamIds:Array.from({length:count},(_,i)=>`team${i}`)})).toThrow();
  const ids=["a".repeat(80),"b".repeat(80)],state=initialState({eventId:"names",teamIds:ids,teamNames:{[ids[0]!]:"🐙".repeat(1000)}});
  expect(Array.from(state.teams[ids[0]!]!.name)).toHaveLength(64);
  expect(state.roster).toEqual(ids);
});
