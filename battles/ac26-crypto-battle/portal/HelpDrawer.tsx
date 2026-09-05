/**
 * Issue #641 wrapper: teach the decision loop and let a player rehearse it
 * before exposing the complete cryptographic reference.
 *
 * Re-export HelpDrawerCore.tsx to preserve the computation reference imports.
 * Progressive disclosure keeps the full HUNT reference behind the rules and
 * the hand-worked sudoku rehearsal.
 */

import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import CoreHelpDrawer from "./HelpDrawerCore.tsx";

export * from "./HelpDrawerCore.tsx";

const COPY = {
  en: {
    title: "Practice and help",
    fullReference: "Open the complete rules, prerequisites, and PROVE / HUNT computation",
  },
  ja: {
    title: "練習とヘルプ",
    fullReference: "完全なルール、前提問題、PROVE / HUNT の計算方法を開く",
  },
} as const;

const panelStyle = {
  border: "1px solid #d5dbdb",
  borderRadius: "8px",
  padding: "16px",
  background: "#fafafa",
  color: "#16212e",
} as const;

export default function HelpDrawer(props: PortalSlotProps) {
  const locale = props.locale === "ja" ? "ja" : "en";
  const copy = COPY[locale];
  return (
    <section style={panelStyle}>
      <h3 style={{ margin: "0 0 8px", fontSize: "16px" }}>{copy.title}</h3>
      <details>
        <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>{copy.fullReference}</summary>
        <div style={{ marginTop: "10px" }}>
          <CoreHelpDrawer {...props} />
        </div>
      </details>
    </section>
  );
}
