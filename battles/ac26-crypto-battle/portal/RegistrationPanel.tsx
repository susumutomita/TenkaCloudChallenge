/**
 * Issue #641 wrapper around the existing live move forms.
 *
 * The original implementation is copied unchanged to
 * RegistrationPanelCore.tsx. This gate adds three participant-facing
 * guarantees without changing any cryptographic operation:
 *
 * - it frames LEAK / PROVE as the one-Contract choice, then HUNT / ROTATE as
 *   the follow-up attack / defence;
 * - a stale Contract at 0:00 is projected to `expired`, so the unchanged core
 *   form cannot offer it;
 * - an ended (or zero-time) match becomes explicitly read-only and the live
 *   forms are not rendered.
 */

import { useMemo } from "react";
import type { PortalCoordinationClient, PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import { usePolledProjection } from "./coordination.ts";
import CoreRegistrationPanel from "./RegistrationPanelCore.tsx";
import type { ContractProjection, CryptoBattleProjection } from "../game/src/types.ts";

export * from "./RegistrationPanelCore.tsx";

const COPY = {
  en: {
    title: "What to decide here",
    choice: "For each open Contract, choose exactly one: LEAK or PROVE.",
    after: "Then inspect the public records: HUNT an opponent, or ROTATE your own generation.",
    active: "An actionable Contract is available. Choose before its countdown reaches zero.",
    idle: "No Contract is actionable right now. Inspect public records or wait for the next request.",
    endedTitle: "This match has ended.",
    endedBody: "LEAK, PROVE, HUNT, and ROTATE are no longer available. The final state remains visible above for review.",
  },
  ja: {
    title: "ここで判断すること",
    choice: "open な Contract 1件につき、LEAK または PROVE のどちらか一方を選びます。",
    after: "その後、公開記録を確認し、相手を HUNT するか、自分の世代を ROTATE します。",
    active: "応答できる Contract があります。カウントダウンが0になる前にどちらかを選んでください。",
    idle: "現在応答できる Contract はありません。公開記録を確認するか、次の依頼を待ってください。",
    endedTitle: "この試合は終了しました。",
    endedBody: "LEAK / PROVE / HUNT / ROTATE は実行できません。最終状態は上の画面で振り返れます。",
  },
} as const;

const guideStyle = {
  border: "1px solid #d5a600",
  borderRadius: "6px",
  padding: "10px 12px",
  marginBottom: "12px",
  background: "#fff8e5",
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

/**
 * Preserve every participant-visible field, changing only stale `open` rows
 * whose server-computed remaining duration is already zero.
 */
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
    <section style={{ ...guideStyle, borderColor: "#687078", background: "#f2f3f3" }} aria-label="crypto-battle-ended">
      <strong>{copy.endedTitle}</strong>
      <p style={{ margin: "4px 0 0", fontSize: "13px" }}>{copy.endedBody}</p>
    </section>
  );
}

function DecisionGuide({ locale, hasActionableContract }: { readonly locale: "ja" | "en"; readonly hasActionableContract: boolean }) {
  const copy = COPY[locale];
  return (
    <section style={guideStyle} aria-label="crypto-battle-decision-guide">
      <strong>{copy.title}</strong>
      <p style={{ margin: "4px 0", fontSize: "13px" }}>{copy.choice}</p>
      <p style={{ margin: "4px 0", fontSize: "13px" }}>{copy.after}</p>
      <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#5f6b7a" }}>
        {hasActionableContract ? copy.active : copy.idle}
      </p>
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

  // Preserve the core's existing fail-closed message when coordination is not
  // wired. Avoid adding guidance that could be mistaken for an actionable UI.
  if (!coordinationClient || !clientForCore) return <CoreRegistrationPanel {...props} />;

  if (isMatchClosed(sanitizedProjection)) {
    return <MatchEndedNotice locale={locale} />;
  }

  const hasActionableContract = getActionableContracts(sanitizedProjection).length > 0;
  return (
    <>
      <DecisionGuide locale={locale} hasActionableContract={hasActionableContract} />
      <CoreRegistrationPanel
        {...props}
        coordinationClient={clientForCore}
      />
    </>
  );
}
