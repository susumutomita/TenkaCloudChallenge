import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import StatusPanel from "../portal/StatusPanel.tsx";
import { SCENARIO_IDS, scenarioProps } from "./scenarios.ts";

function render(id: (typeof SCENARIO_IDS)[number]): string {
  return renderToStaticMarkup(createElement(StatusPanel, scenarioProps(id, "ja")));
}

describe("StackStack UI state harness", () => {
  it("renders every declared state with the real StatusPanel", () => {
    for (const id of SCENARIO_IDS) expect(render(id)).toContain("StackStack — 次にやること");
  });

  it("starts with URL registration, not a misleading measurement message", () => {
    const html = render("unregistered");
    expect(html).toContain("AppUrlHint");
    expect(html).not.toContain("URL は登録できました");
  });

  it("shows the measurement wait only after a URL exists", () => {
    const html = render("measuring");
    expect(html).toContain("URL は登録できました");
    expect(html).toContain("https://alpha.local.example");
  });

  it("shows one next production task and compact progress", () => {
    const html = render("partial");
    expect(html).toContain("本番化チェック 6個中 2個 完了");
    expect(html).toContain("アクセス制限 — WAF");
  });

  it("prioritizes a live safety regression over completed hardening", () => {
    const html = render("incident");
    expect(html).toContain("サイト無改ざん — 掲示板が改ざんされていない");
    expect(html).not.toContain("https://alpha.local.example");
    expect(html).toContain("https://bravo.local.example");
  });

  it("shows an explicit completion state", () => {
    expect(render("ready")).toContain("本番化は完了しています");
  });
});
