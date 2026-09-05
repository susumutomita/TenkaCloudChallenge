/**
 * Issue #646: the first participant-facing surface is a visual game board
 * rather than prose + raw tables. The original StatusPanel remains available
 * under progressive disclosure for debugging / exact bigint inspection and
 * keeps its public exports.
 *
 * [Issue #659] This slot is now the WHOLE game.
 *
 * It used to render the board while a second host slot (`RegistrationPanel`)
 * rendered the controls, so the Order tickets appeared twice and the thing you
 * were working on sat far above the place you worked. "Which Order" and "what
 * do I do with it" were never in view together, which is what made the screen
 * unintuitive however well each half was laid out.
 *
 * `dashboard.slots` is the problem's own declaration and slots are optional, so
 * the fix is structural rather than cosmetic: `RegistrationPanel` is gone from
 * `metadata.json`, and the surface below is score → tickets → the counter you
 * work at → the public record, in one column.
 */

import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import BattleSurface from "./FastMovePanel.tsx";
import CoreStatusPanel from "./StatusPanelCore.tsx";
import ConceptExplanation from "./ConceptExplanation.tsx";
import QuickRules from "./QuickRules.tsx";
import TutorialWalkthrough from "./TutorialWalkthrough.tsx";

export * from "./StatusPanelCore.tsx";

const COPY = {
  en: { raw: "Raw match data / exact values" },
  ja: { raw: "生の試合データ / 正確な値を見る" },
} as const;

export default function StatusPanel(props: PortalSlotProps) {
  const locale = props.locale === "ja" ? "ja" : "en";
  const tutorialKey = `crypto-battle-tutorial:${props.team.eventId}:${props.jobId}:${props.team.teamId}`;
  return (
    <>
      <QuickRules locale={locale} />
      <ConceptExplanation locale={locale} />
      <TutorialWalkthrough key={tutorialKey} locale={locale} />
      <BattleSurface {...props} />
      <details style={{ marginTop: "10px" }}>
        <summary style={{ cursor: "pointer", fontSize: "12px", color: "#5f6b7a" }}>{COPY[locale].raw}</summary>
        <div style={{ marginTop: "8px" }}>
          <CoreStatusPanel {...props} />
        </div>
      </details>
    </>
  );
}
