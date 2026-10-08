import { applyOp, initialState, projectForTeam, teamScores, validateOp } from "../game/reducer.ts";
import type { Op, State, Task } from "../game/types.ts";
export type CapacityRoute = "audits" | "upgrades" | "held" | "experiments";
const ids = ["a".repeat(80), "b".repeat(80)];
const measure = (s: State) => new TextEncoder().encode(JSON.stringify(s)).length;
/** Two is the only supported roster size. Visit every accepted transition with
 * maximum-length IDs/names. Routes retain all receipts and every round's claims
 * and score ledger; they vary successful/failed audits, upgrades and experiments.
 * These measured routes are not claimed to be an exhaustive global byte maximum.
 */
export function playCapacityTrace(route: CapacityRoute) {
  let state = initialState({eventId:"capacity",teamIds:ids,teamNames:Object.fromEntries(ids.map(id=>[id,"\u0000".repeat(64)]))});
  let peak = measure(state), peakState = state;
  function act(id: string, move: Record<string,unknown>) {
    const op = {...move,requestId:`request_${String(state.revision).padStart(72,"0")}`,revision:state.revision,round:state.round} as Op;
    const verdict = validateOp(state,id,op);
    if (!verdict.ok) throw new Error(`capacity ${route} round ${state.round} ${String(move.kind)}: ${verdict.error}`);
    const next = applyOp(state,id,op), bytes = measure(next);
    if (bytes > peak) {peak=bytes;peakState=next;}
    // Restore every transition across the same JSON boundary as the host.
    state = JSON.parse(JSON.stringify(next));
    if (JSON.stringify(projectForTeam(state,id)) !== JSON.stringify(projectForTeam(next,id))) throw new Error("projection changed after restore");
    if (JSON.stringify(teamScores(state)) !== JSON.stringify(teamScores(next))) throw new Error("score changed after restore");
  }
  act(ids[0]!,{kind:"ready"}); act(ids[1]!,{kind:"ready"});
  for (let round=0;round<4;round++) {
    const ordered = [ids[round % 2]!, ids[1-round % 2]!];
    const upgraded = route === "upgrades" && round !== 1;
    if (route === "held" && round === 3) for (const id of ordered) act(id,{kind:"upgrade"});
    if (upgraded) for (let step=0;step<2;step++) for (const id of ordered) act(id,{kind:"upgrade"});
    const task = (id:string): Task => {
      const t=state.teams[id]!;
      if (round===0) return {kind:"record",p:4000,q:upgraded ? 997 : 7};
      if (round===1) return {kind:"table",cells:route==="held" ? [{n:1,d:1},{n:1,d:2},{n:1,d:1},{n:5,d:8}] : [{n:-9,d:13},{n:-9,d:11},{n:-9,d:14},{n:-9,d:15}]};
      if (round===2) return {kind:"terms",ones:Math.floor(t.rows/2)};
      return {kind:"allocation",n:route==="held" ? 26 : t.grid-1,d:t.grid};
    };
    if (route!=="experiments") {
      for(const id of ordered) act(id,{kind:"inspect",task:task(id)});
      for(const id of ordered) {
        const sourceId=state.teams[id]!.previews.at(-1)!.id;
        act(id,{kind:"publish",sourceId,...(round===0?{scope:route==="held"?"finite":"forever"}:round===1?{floor:route==="held"?{n:1,d:64}:{n:256,d:4096}}:round===2?{exponent:route==="held"?4:30}:{})});
      }
      for(const id of ordered) {
        const c=state.claims.find(c=>c.round===round&&c.author!==id)!;
        act(id,{kind:"audit",claimId:c.id,reason:round===0?"scope":round===1?"floor":round===2?"mixed":"error",...(round===2?{ones:Math.floor(c.rows!/2),cost:c.rows===6?9:4}:{})});
      }
    }
    while(state.phase==="playing" && state.round===round) act(state.turn,{kind:"inspect",task:task(state.turn)});
  }
  return {state,peak,peakState,final:measure(state),transitions:state.revision};
}
