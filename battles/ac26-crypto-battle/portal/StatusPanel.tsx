/**
 * Issue #641 wrapper: place the 30-second game loop before the live status
 * surface. The unchanged status implementation is copied to
 * StatusPanelCore.tsx in the same commit and re-exported here so existing
 * imports and tests keep their public API.
 */

import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import QuickRules from "./QuickRules.tsx";
import CoreStatusPanel from "./StatusPanelCore.tsx";

export * from "./StatusPanelCore.tsx";

export default function StatusPanel(props: PortalSlotProps) {
  return (
    <>
      <QuickRules locale={props.locale} />
      <CoreStatusPanel {...props} />
    </>
  );
}
