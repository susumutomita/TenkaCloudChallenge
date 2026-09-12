import HuntPanelCore from "./HuntPanelCore.tsx";
import LeakHuntRules from "./LeakHuntRules.tsx";

// Preserve existing option helpers and types for consumers and regression tests.
export * from "./HuntPanelCore.tsx";

/** Rules are visible before choosing a target, outside paid hints. The existing answer form stays mounted. */
export default function HuntPanel(props: Parameters<typeof HuntPanelCore>[0]) {
  return <>
    <LeakHuntRules locale={props.locale} legacySudoku={props.projection.proofProtocol !== "schnorr-v1"} />
    <HuntPanelCore {...props} />
  </>;
}
