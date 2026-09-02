/**
 * Issue #641 wrapper: teach the decision loop and let a player rehearse it
 * before exposing the complete cryptographic reference.
 *
 * The unchanged reference implementation is copied to HelpDrawerCore.tsx in
 * the same commit. Re-exporting it preserves PYTHON_SNIPPET and any existing
 * imports while progressive disclosure keeps the 2048-bit constant out of
 * the initial reading path.
 */

import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import CoreHelpDrawer from "./HelpDrawerCore.tsx";
import QuickRules from "./QuickRules.tsx";
import TutorialWalkthrough from "./TutorialWalkthrough.tsx";

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
} as const;

export default function HelpDrawer(props: PortalSlotProps) {
  const locale = props.locale === "ja" ? "ja" : "en";
  const copy = COPY[locale];
  return (
    <section style={panelStyle}>
      <h3 style={{ margin: "0 0 8px", fontSize: "16px" }}>{copy.title}</h3>
      <QuickRules locale={locale} />
      <TutorialWalkthrough locale={locale} />
      <details>
        <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>{copy.fullReference}</summary>
        <div style={{ marginTop: "10px" }}>
          <CoreHelpDrawer {...props} />
        </div>
      </details>
    </section>
  );
}
