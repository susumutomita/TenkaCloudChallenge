import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PortalCoordinationClient, PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import { applyOp, initialState, projectForTeam, tick } from "./reducer.ts";
import FastMovePanel, { EndedView, FAST_MOVE_COPY, closedReason, isClosed, outcomeError } from "../../portal/FastMovePanel.tsx";

function minimalProps(locale: "ja" | "en", overrides: Partial<PortalSlotProps> = {}): PortalSlotProps {
  return {
    team: { teamName: "Test Team" },
    problemId: "ac26-crypto-battle",
    jobId: "job-1",
    score: 0,
    locale,
    endpoints: [],
    phases: [],
    disruptions: [],
    nowIso: new Date().toISOString(),
    ...overrides,
  };
}

function fakeClient(): PortalCoordinationClient {
  return {
    submitOp: async () => ({ kind: "ok", projection: {} }),
    getProjection: async () => ({ kind: "ok", projection: {} }),
  };
}

for (const locale of ["en", "ja"] as const) {
  test(`outcomeError localizes "event_ended" as ambiguous (not started OR ended) (${locale})`, () => {
    expect(outcomeError({ kind: "rejected", error: "event_ended" }, locale)).toBe(
      locale === "ja"
        ? "現在は提出を受け付けていません。イベントの開始前か、終了後です。"
        : "Submissions are closed. The event has not started yet or has already ended.",
    );
  });

  test(`outcomeError localizes "scoring_locked" (${locale})`, () => {
    expect(outcomeError({ kind: "rejected", error: "scoring_locked" }, locale)).toBe(
      locale === "ja"
        ? "運営が採点を一時停止しています。再開してからもう一度送ってください。"
        : "The organizer has paused scoring. Submit again after it resumes.",
    );
  });

  test(`EndedView shows eventEndedBody for reason "event" (${locale})`, () => {
    const html = renderToStaticMarkup(createElement(EndedView, { locale, reason: "event" }));
    expect(html).toContain('aria-label="crypto-battle-ended"');
    expect(html).toContain(FAST_MOVE_COPY[locale].ended);
    expect(html).toContain(FAST_MOVE_COPY[locale].eventEndedBody);
    expect(html).not.toContain(FAST_MOVE_COPY[locale].endedBody);
  });

  test(`EndedView keeps the pre-existing endedBody for reason "match" (${locale})`, () => {
    const html = renderToStaticMarkup(createElement(EndedView, { locale, reason: "match" }));
    expect(html).toContain('aria-label="crypto-battle-ended"');
    expect(html).toContain(FAST_MOVE_COPY[locale].ended);
    expect(html).toContain(FAST_MOVE_COPY[locale].endedBody);
    expect(html).not.toContain(FAST_MOVE_COPY[locale].eventEndedBody);
  });
}

test("closedReason is \"event\" whenever eventOver is true, regardless of the underlying match phase", () => {
  const waiting = tick(initialState({ eventId: "event-ended-closedReason", teamIds: ["a", "b"] }), 0);
  const readyA = applyOp(waiting, "a", { kind: "ready" });
  const started = applyOp(readyA, "b", { kind: "ready" });
  const waitingProjection = projectForTeam(waiting, "a");
  const liveProjection = projectForTeam(started, "a");

  expect(closedReason(null, true)).toBe("event");
  expect(closedReason(waitingProjection, true)).toBe("event");
  expect(liveProjection.phase).not.toBe("ended");
  expect(closedReason(liveProjection, true)).toBe("event");
});

test("closedReason is \"match\" for the pre-existing per-match check, unchanged when eventOver is false", () => {
  const waiting = tick(initialState({ eventId: "event-ended-closedReason-match", teamIds: ["a", "b"] }), 0);
  const readyA = applyOp(waiting, "a", { kind: "ready" });
  const started = applyOp(readyA, "b", { kind: "ready" });
  const waitingProjection = projectForTeam(waiting, "a");
  const liveProjection = projectForTeam(started, "a");
  const endedState = tick(started, started.config.matchDurationMs);
  const endedProjection = projectForTeam(endedState, "a");

  expect(closedReason(null, false)).toBeNull();
  expect(closedReason(waitingProjection, false)).toBeNull();
  expect(closedReason(liveProjection, false)).toBeNull();
  expect(endedProjection.phase).toBe("ended");
  expect(closedReason(endedProjection, false)).toBe("match");
  expect(isClosed(endedProjection, false)).toBe(true);
  expect(isClosed(liveProjection, false)).toBe(false);
  expect(isClosed(null)).toBe(false);
});

test("FastMovePanel shows the event-ended body on first paint when eventEndsAt has already passed, even with no projection yet", () => {
  for (const locale of ["en", "ja"] as const) {
    const html = renderToStaticMarkup(
      createElement(FastMovePanel, minimalProps(locale, {
        coordinationClient: fakeClient(),
        eventEndsAt: "2000-01-01T00:00:00Z",
      })),
    );
    expect(html).toContain('aria-label="crypto-battle-ended"');
    expect(html).toContain(FAST_MOVE_COPY[locale].ended);
    expect(html).toContain(FAST_MOVE_COPY[locale].eventEndedBody);
    expect(html).not.toContain(FAST_MOVE_COPY[locale].endedBody);
  }
});

test("FastMovePanel does not show the ended view when eventEndsAt is in the future", () => {
  const html = renderToStaticMarkup(
    createElement(FastMovePanel, minimalProps("en", {
      coordinationClient: fakeClient(),
      eventEndsAt: "2999-01-01T00:00:00Z",
    })),
  );
  expect(html).not.toContain("crypto-battle-ended");
  expect(html).toContain("Waiting for the first match update");
});

test("FastMovePanel is unaffected by eventEndsAt when it is undefined (pre-existing behavior)", () => {
  const html = renderToStaticMarkup(
    createElement(FastMovePanel, minimalProps("en", { coordinationClient: fakeClient() })),
  );
  expect(html).not.toContain("crypto-battle-ended");
  expect(html).toContain("Waiting for the first match update");
});
