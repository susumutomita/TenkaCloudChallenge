/**
 * Issue #646: the first participant-facing surface is now a visual game
 * board (Order belt -> Vault / Public Ledger) rather than prose + raw tables.
 * The original StatusPanel remains available under progressive disclosure
 * for debugging / exact bigint inspection and keeps its public exports.
 */

import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import GameBoard from "./GameBoard.tsx";
import CoreStatusPanel from "./StatusPanelCore.tsx";

export * from "./StatusPanelCore.tsx";

const COPY = {
  en: { raw: "Raw match data / exact values" },
  ja: { raw: "生の試合データ / 正確な値を見る" },
} as const;

export default function StatusPanel(props: PortalSlotProps) {
  const locale = props.locale === "ja" ? "ja" : "en";
  return (
    <>
      <GameBoard {...props} />
      <details style={{ marginTop: "10px" }}>
        <summary style={{ cursor: "pointer", fontSize: "12px", color: "#5f6b7a" }}>{COPY[locale].raw}</summary>
        <div style={{ marginTop: "8px" }}>
          <CoreStatusPanel {...props} />
        </div>
      </details>
    </>
  );
}
