import {test,expect} from "bun:test";
import {initialState,tick,applyOp,projectForTeam} from "./reducer.ts";
import {readyFeedback,FAST_MOVE_COPY} from "../../portal/FastMovePanel.tsx";
for(const locale of ["ja","en"] as const) test(`ready feedback follows actual phase, never a stale count (${locale})`,()=>{
  const waiting=tick(initialState({eventId:"ready-feedback",teamIds:["a","b"]}),0);
  const first=applyOp(waiting,"a",{kind:"ready"});
  expect(readyFeedback(undefined,locale)).toBeNull();
  expect(readyFeedback(projectForTeam(first,"a"),locale)).toBeNull();
  const started=applyOp(first,"b",{kind:"ready"});
  for(const team of ["a","b"]) {
    const feedback=readyFeedback(projectForTeam(started,team),locale);
    expect(feedback?.title).toBe(FAST_MOVE_COPY[locale].startSuccess);
    expect(feedback?.title).not.toBe(FAST_MOVE_COPY[locale].readyDone);
  }
  const ended=tick(started,started.config.matchDurationMs);
  expect(readyFeedback(projectForTeam(ended,"a"),locale)).toBeNull();
});
