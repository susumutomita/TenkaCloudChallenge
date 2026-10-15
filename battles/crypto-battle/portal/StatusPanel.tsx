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
import BattleHelp from "./BattleHelp.tsx";

export * from "./StatusPanelCore.tsx";

export default function StatusPanel(props: PortalSlotProps) {
  return (
    <>
      <BattleHelp key={`${props.team.eventId}:${props.jobId}:${props.team.teamId}`} {...props} />
      <BattleSurface {...props} />

    </>
  );
}
