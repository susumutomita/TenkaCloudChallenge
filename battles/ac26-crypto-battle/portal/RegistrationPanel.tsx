/**
 * Issue #646 wrapper around the original live move forms.
 *
 * The primary surface is FastMovePanel: Order selection first, LEAK/PROVE as
 * the main choice, then Ledger-driven HUNT and ROTATE. The original detailed
 * forms stay available under progressive disclosure for advanced/manual use.
 */

import { useMemo } from "react";
import type { PortalCoordinationClient, PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import { usePolledProjection } from "./coordination.ts";
import FastMovePanel from "./FastMovePanel.tsx";
import CoreRegistrationPanel from "./RegistrationPanelCore.tsx";
import type { ContractProjection, CryptoBattleProjection } from "../game/src/types.ts";

export * from "./RegistrationPanelCore.tsx";

const COPY = {
  en: {
    advanced: "Advanced / manual submission forms",
    endedTitle: "This match has ended.",
    endedBody: "LEAK, PROVE, HUNT, and ROTATE are no longer available. The final state remains visible above for review.",
  },
  ja: {
    advanced: "詳細 / 手動入力フォームを開く",
    endedTitle: "この試合は終了しました。",
    endedBody: "LEAK / PROVE / HUNT / ROTATE は実行できません。最終状態は上の画面で振り返れます。",
  },
} as const;

export function isMatchClosed(
  projection: Pick<CryptoBattleProjection, "phase" | "matchRemainingMs"> | null | undefined,
): boolean {
  return Boolean(
    projection &&
      (projection.phase === "ended" ||
        (projection.matchRemainingMs !== undefined && projection.matchRemainingMs <= 0)),
  );
}

export function getActionableContracts(
  projection: Pick<CryptoBattleProjection, "phase" | "matchRemainingMs" | "myContracts"> | null | undefined,
): readonly ContractProjection[] {
  if (!projection || isMatchClosed(projection)) return [];
  return projection.myContracts.filter((contract) => contract.status === "open" && contract.remainingMs > 0);
}

/** Preserve every participant-visible field, changing only stale open rows at 0:00. */
export function sanitizeProjection(projection: CryptoBattleProjection): CryptoBattleProjection {
  let changed = false;
  const myContracts = projection.myContracts.map((contract) => {
    if (contract.status !== "open" || contract.remainingMs > 0) return contract;
    changed = true;
    return { ...contract, status: "expired" as const };
  });
  return changed ? { ...projection, myContracts } : projection;
}

export function MatchEndedNotice({ locale }: { readonly locale: "ja" | "en" }) {
  const copy = COPY[locale];
  return (
    <section style={{ border: "1px solid #687078", borderRadius: "8px", padding: "10px 12px", background: "#f2f3f3" }} aria-label="crypto-battle-ended">
      <strong>{copy.endedTitle}</strong>
      <p style={{ margin: "4px 0 0", fontSize: "13px" }}>{copy.endedBody}</p>
    </section>
  );
}

function cachedProjectionClient(
  client: PortalCoordinationClient | undefined,
  projection: CryptoBattleProjection | undefined,
): PortalCoordinationClient | undefined {
  if (!client || !projection) return client;
  return {
    submitOp: (op) => client.submitOp(op),
    getProjection: async () => ({ kind: "ok", projection }),
  };
}

export default function RegistrationPanel(props: PortalSlotProps) {
  const locale = props.locale === "ja" ? "ja" : "en";
  const { coordinationClient } = props;
  const { projection } = usePolledProjection(coordinationClient);
  const sanitizedProjection = useMemo(
    () => (projection ? sanitizeProjection(projection) : undefined),
    [projection],
  );
  const clientForCore = useMemo(
    () => cachedProjectionClient(coordinationClient, sanitizedProjection),
    [coordinationClient, sanitizedProjection],
  );

  if (!coordinationClient || !clientForCore) return <CoreRegistrationPanel {...props} />;

  return (
    <>
      <FastMovePanel {...props} />
      <details style={{ marginTop: "10px" }}>
        <summary style={{ cursor: "pointer", fontSize: "12px", color: "#5f6b7a" }}>{COPY[locale].advanced}</summary>
        <div style={{ marginTop: "8px" }}>
          <CoreRegistrationPanel {...props} coordinationClient={clientForCore} />
        </div>
      </details>
    </>
  );
}
