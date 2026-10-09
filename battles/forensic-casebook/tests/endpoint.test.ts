import { expect, test } from "bun:test";
import { applyOp, initialState, migrateState, projectForTeam, validateOp } from "../game/index.ts";
import type { State } from "../game/types.ts";
const start = (generation = 1) => initialState({ eventId: "endpoint-test", teamIds: ["a", "b"], matchSecret: "a".repeat(64) }, { generation });
const view = (s: State) => projectForTeam(s, "a").cases.find(c => c.id === "endpoint")!;
const doc = (s: State, id: string) => JSON.parse(view(s).evidence.find(e => e.id === id)!.content);
let serial = 0;
const op = (s: State, questionId: string, answer: string, evidenceIds: string[]) => ({ kind: "answer" as const, id: `endpoint-${++serial}`, generation: s.generation, revision: s.teams.a!.revision, caseId: "endpoint", questionId, answer, evidenceIds });
function route(s: State): [string, string, string[]][] {
  const inv = doc(s,"E-INVENTORY"), approval = doc(s,"E-APPROVAL"), history = doc(s,"E-HISTORY");
  const recreation = history.events.find((e: any) => e.action === "recreate-file");
  const bad = inv.tasks.find((t: any) => t.id === recreation.task && approval.unapproved_hashes.includes(t.hash));
  const normal = inv.tasks.find((t: any) => t.id === approval.approved.task);
  return [
    ["diagnose",`suspect=${bad.id};unknown=${inv.unresolved_object}`,["E-INVENTORY","E-APPROVAL","E-HISTORY"]],
    ["preserve","snapshot",["E-INVENTORY","E-APPROVAL","E-HISTORY","E-PLAN"]],
    ["contain",`disable=${bad.id};quarantine=${bad.target};block=${bad.target}`,["E-INVENTORY","E-APPROVAL","E-HISTORY","E-PLAN"]],
    ["restore",`restore=${normal.target};keep=${normal.id}`,["E-INVENTORY","E-APPROVAL","E-PLAN"]],
    ["reboot","reboot",["E-OBSERVATION","E-PLAN"]],
    ["assessment","recurrence=no;normal=yes;scope=simulation",["E-OBSERVATION","E-APPROVAL"]],
  ];
}
test("visible evidence completes ordered simulation across generations; custody, restart, team isolation, persistence and replay", () => {
  for (let generation = 1; generation <= 8; generation++) {
    let s = start(generation);
    const original = view(s).evidence.slice(0,3);
    const steps = route(s);
    for (const step of steps) {
      const action = op(s,...step);
      s = applyOp(s,"a",action);
      expect(s.teams.a!.lastResult?.status).toBe("correct");
      expect(applyOp(s,"a",action)).toBe(s);
      s = JSON.parse(JSON.stringify(s));
    }
    const obs = doc(s,"E-OBSERVATION");
    expect(obs.custody).toEqual(original.map(e => ({id:e.id,sha256:e.sha256,original_content:e.content,before_change:true})));
    expect(view(s).evidence.slice(0,3)).toEqual(original);
    expect(obs.reboot_count).toBe(1);
    expect(obs.post_reboot).toMatchObject({ recreated: [], suspect_execution_count:0, normal_update:"success" });
    expect(obs.blocked_targets).toEqual(["cache-update"]);
    expect(s.teams.a!.score).toBe(100);
    expect(projectForTeam(s,"b").score).toBe(0);
    expect(projectForTeam(s,"b").cases.find(c => c.id === "endpoint")!.evidence.find(e => e.id === "E-OBSERVATION")!.content).toContain('"reboot_count": 0');
  }
});
test("missing or irrelevant evidence and skipping steps never change simulation or score", () => {
  let s=start(); const steps=route(s); const before=doc(s,"E-OBSERVATION");
  for (const step of [...steps.slice(1), [steps[0]![0],steps[0]![1],[]] as [string,string,string[]], [steps[0]![0],steps[0]![1],[...steps[0]![2],"E-PLAN"]] as [string,string,string[]]]) {
    s=applyOp(s,"a",op(s,...step));
    expect(s.teams.a!.lastResult?.status).toBe("incorrect");
    expect(s.teams.a!.score).toBe(0);
    expect(doc(s,"E-OBSERVATION")).toEqual(before);
  }
});
test("normal removal, global block, file-only deletion and premature eradication claims fail", () => {
  let s=start(); const steps=route(s);
  for (const step of steps.slice(0,2)) s=applyOp(s,"a",op(s,...step));
  const before=doc(s,"E-OBSERVATION"), normal=doc(s,"E-APPROVAL").approved.task;
  for (const answer of [steps[2]![1].replace("block=cache-update","block=all"), `disable=${normal};quarantine=vendor-update;block=vendor-update`, "delete=cache-update", steps[2]![1]+";delete=vendor-update"]) {
    s=applyOp(s,"a",op(s,"contain",answer,steps[2]![2]));
    expect(s.teams.a!.lastResult?.status).toBe("incorrect");
    expect(doc(s,"E-OBSERVATION")).toEqual(before);
  }
  for (const step of steps.slice(2,5)) s=applyOp(s,"a",op(s,...step));
  s=applyOp(s,"a",op(s,"assessment","recurrence=no;normal=yes;scope=real-endpoint",steps[5]![2]));
  expect(s.teams.a!.score).toBe(70);
  expect(s.teams.a!.lastResult?.status).toBe("incorrect");
  expect(validateOp(s,"a",op(s,"contain",steps[2]![1],steps[2]![2])).ok).toBe(false);
});

test("old states fail explicitly without resetting or silently expanding existing events", () => {
  const s=start(); const legacy={...s,schemaVersion:1} as unknown as State;
  expect(validateOp(legacy,"a",op(s,...route(s)[0]!))).toEqual({ok:false,error:"incompatible_state"});
  expect(() => projectForTeam(legacy,"a")).toThrow("incompatible_state");
  expect(() => migrateState(legacy,1)).toThrow("new_event_required");
  expect(legacy.schemaVersion as number).toBe(1);
});
