/**
 * Issue #486 PR4: ac26-crypto-battle StatusPanel plugin -- the participant's
 * main 1-screen view of a live match: Score / Time / Phase header, then
 * three lanes (Contract Queue / My Vault / Public Ledger).
 *
 * Data source: `props.coordinationClient.getProjection()`, polled every 30s
 * (ADR-014 / polling-over-SSE, `coordination.ts`'s `usePolledProjection` --
 * shared with `RegistrationPanel.tsx`, see that file's header on why it is
 * factored out). `getProjection()` returns this problem's own
 * `CryptoBattleProjection` (see `../game/src/reducer.ts`'s `projectForTeam`)
 * narrowed from `unknown` by `coordination.ts`'s `isCryptoBattleProjection`.
 * `props.coordinationClient` undefined (portal not wired for this
 * deployment/session) fail-closes the entire panel to a short notice --
 * every field this panel renders (score, phase, timer, all 3 lanes) comes
 * from that one projection, so there is no partial content to show without
 * it (unlike microservice-migration-battle's StatusPanel, which still has
 * `props.endpoints` to show even with coordination unwired).
 *
 * UI principle (Issue #486): the Public Ledger lane shows raw published
 * artifacts (teamId / generation / shareIndex / value for a LEAK, or
 * teamId / generation / commitment / response for a PROVE) and nothing
 * else -- no "threshold reached", no "N of M shares exposed", no computed
 * exploitability verdict of any kind. Reading whether a target is huntable
 * is left entirely to the participant's own cryptographic reasoning over
 * that raw data; see `game/src/portal.test.ts`'s "does not leak the answer"
 * test, which greps this lane's rendered output for exactly that kind of
 * string. The same principle applies to My Vault: it shows this team's own
 * secret / shares / generation / rotate cooldown as plain data, never an
 * automated "you are at risk" judgement (Issue #486 explicitly rules this
 * out) -- and `CryptoBattleProjection` does not even carry `config.threshold`
 * for this panel to compute one from, structurally reinforcing that.
 *
 * Cloudscape is not imported here -- see this repo's precedent
 * (`battles/microservice-migration-battle/portal/StatusPanel.tsx`'s header)
 * for why: portal provides it, and importing it in a plugin bundle would
 * duplicate it. Plain HTML + inline style, same as that precedent.
 */

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import { usePolledProjection } from "./coordination.ts";
import type { ContractProjection, CryptoBattleProjection, Phase, PublicArtifact } from "../game/src/types.ts";

type Locale = "ja" | "en";

/**
 * Explicit interface, not `(typeof COPY)["en"]`: with the literal `en`
 * variant's exact string-literal types as the source of truth, TS would
 * reject assigning the `ja` variant's (differently-worded, so
 * differently-literal-typed) object wherever a `Copy`-typed prop is
 * expected -- `copy.title` would be pinned to the exact English sentence.
 * Declaring the shape up front and checking BOTH `en` and `ja` against it
 * (structurally, as plain `string`/function types) is what lets `COPY[locale]`
 * actually vary by locale without a type error.
 */
interface Copy {
  readonly title: string;
  readonly intro: string;
  readonly notConfigured: string;
  readonly loading: string;
  readonly badProjection: string;
  readonly coordinationStatus: (kind: string) => string;
  readonly scoreLabel: string;
  readonly timeLabel: string;
  readonly phaseLabel: string;
  readonly notStarted: string;
  readonly matchEnded: string;
  readonly phase: Record<Phase, string>;
  readonly contractQueueTitle: string;
  readonly contractQueueBody: string;
  readonly noContracts: string;
  readonly colContract: string;
  readonly colKind: string;
  readonly colPoints: string;
  readonly colShares: string;
  readonly colExpires: string;
  readonly kindStandard: string;
  readonly kindRush: string;
  readonly vaultTitle: string;
  readonly vaultBody: string;
  readonly generationLabel: string;
  readonly secretLabel: string;
  readonly sharesLabel: string;
  readonly colShareIndex: string;
  readonly colShareValue: string;
  readonly rotateCooldownLabel: string;
  readonly rotateReady: string;
  readonly huntedGenerationsLabel: string;
  readonly none: string;
  readonly ledgerTitle: string;
  readonly ledgerBody: string;
  readonly noLedgerEntries: string;
  readonly colTeam: string;
  readonly colGeneration: string;
  readonly colEntryKind: string;
  readonly colDetail: string;
  readonly colWhen: string;
  readonly kindShare: string;
  readonly kindProof: string;
  readonly you: string;
}

const COPY: Record<Locale, Copy> = {
  en: {
    title: "PROVE / LEAK / HUNT -- Status",
    intro:
      "Your Contract Queue, your Vault, and the full Public Ledger, refreshed from the match every 30s.",
    notConfigured: "Coordination is not wired up for this session -- match status is unavailable here.",
    loading: "Waiting for the first match update…",
    badProjection: "The match sent back data in an unrecognized shape -- showing nothing rather than guessing.",
    coordinationStatus: (kind: string) => `Coordination status: ${kind} -- retrying.`,
    scoreLabel: "Score",
    timeLabel: "Time left",
    phaseLabel: "Phase",
    notStarted: "not started",
    matchEnded: "ended",
    phase: { build: "Build", pressure: "Pressure", endgame: "Endgame", ended: "Ended" } as Record<Phase, string>,
    contractQueueTitle: "Contract Queue",
    contractQueueBody: "LEAK requests addressed to your team. Miss the deadline and one expires unclaimed.",
    noContracts: "No open contracts right now.",
    colContract: "Contract",
    colKind: "Kind",
    colPoints: "Points",
    colShares: "Requested shares",
    colExpires: "Expires in",
    kindStandard: "standard",
    kindRush: "rush",
    vaultTitle: "My Vault",
    vaultBody: "Only your team can see this.",
    generationLabel: "Generation",
    secretLabel: "Secret",
    sharesLabel: "Shares (this generation)",
    colShareIndex: "Index",
    colShareValue: "Value",
    rotateCooldownLabel: "ROTATE cooldown",
    rotateReady: "ready now",
    huntedGenerationsLabel: "Generations successfully HUNTed against you",
    none: "none",
    ledgerTitle: "Public Ledger",
    ledgerBody: "Every share every team has LEAKed, and every proof every team has PROVEn -- forever, in the open.",
    noLedgerEntries: "The ledger is empty so far.",
    colTeam: "Team",
    colGeneration: "Gen",
    colEntryKind: "Kind",
    colDetail: "Detail",
    colWhen: "Posted (UTC)",
    kindShare: "share (LEAK)",
    kindProof: "proof (PROVE)",
    you: " (you)",
  },
  ja: {
    title: "PROVE / LEAK / HUNT — 状態",
    intro: "自チームの Contract Queue、Vault、全チーム共通の Public Ledger を 30 秒ごとに更新表示します。",
    notConfigured: "この session では coordination が未配線のため、試合状態を表示できません。",
    loading: "最初の更新を待っています…",
    badProjection: "試合データの形式を認識できませんでした — 推測表示はせず、何も表示しません。",
    coordinationStatus: (kind: string) => `coordination status: ${kind} — 再試行しています。`,
    scoreLabel: "スコア",
    timeLabel: "残り時間",
    phaseLabel: "フェーズ",
    notStarted: "未開始",
    matchEnded: "終了",
    phase: { build: "Build", pressure: "Pressure", endgame: "Endgame", ended: "Ended" } as Record<Phase, string>,
    contractQueueTitle: "Contract Queue",
    contractQueueBody: "自チーム宛の LEAK 依頼です。期限内に応じないと失効します。",
    noContracts: "現在、open な contract はありません。",
    colContract: "Contract",
    colKind: "種別",
    colPoints: "得点",
    colShares: "要求 share index",
    colExpires: "期限まで",
    kindStandard: "standard",
    kindRush: "rush",
    vaultTitle: "My Vault",
    vaultBody: "自チームにのみ表示されます。",
    generationLabel: "世代",
    secretLabel: "Secret",
    sharesLabel: "Share 一覧 (現行世代)",
    colShareIndex: "Index",
    colShareValue: "値",
    rotateCooldownLabel: "ROTATE クールダウン",
    rotateReady: "今すぐ実行可",
    huntedGenerationsLabel: "自チームが HUNT された世代",
    none: "なし",
    ledgerTitle: "Public Ledger",
    ledgerBody: "全チームがこれまでに LEAK した share と PROVE した proof の全公開履歴です。",
    noLedgerEntries: "まだ ledger に記録はありません。",
    colTeam: "チーム",
    colGeneration: "世代",
    colEntryKind: "種別",
    colDetail: "詳細",
    colWhen: "記録時刻 (UTC)",
    kindShare: "share (LEAK)",
    kindProof: "proof (PROVE)",
    you: " (自チーム)",
  },
};

const panelStyle: CSSProperties = {
  border: "1px solid #d5dbdb",
  borderRadius: "8px",
  padding: "16px",
  background: "#fafafa",
};

const headerRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "12px",
  marginBottom: "16px",
};

const statBoxStyle: CSSProperties = {
  border: "1px solid #eaeded",
  borderRadius: "6px",
  padding: "8px 14px",
  background: "#fff",
  minWidth: "120px",
};

const laneGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: "12px",
};

const laneStyle: CSSProperties = {
  border: "1px solid #eaeded",
  borderRadius: "6px",
  padding: "10px 12px",
  background: "#fff",
  minWidth: 0,
};

const tableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "12px" };
const thStyle: CSSProperties = { padding: "4px 6px", textAlign: "left", borderBottom: "1px solid #d5dbdb" };
const tdStyle: CSSProperties = {
  padding: "4px 6px",
  borderBottom: "1px solid #f0f0f0",
  fontFamily: "monospace",
  wordBreak: "break-all",
};

/** `12:03:45` style hh:mm:ss from a duration in ms, floored at 0. Locale-independent (digits only). */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Deterministic, timezone-independent timestamp for the ledger's "when" column. */
function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

/**
 * Anchors the display clock to `props.nowIso` (portal's own idea of "now",
 * for clock-skew tolerance and testability -- see the SDK's doc comment on
 * that field) rather than reading the browser clock directly, then ticks it
 * forward once a second so contract/rotate countdowns visibly move between
 * the 30s projection polls. This `setInterval` runs only as a real DOM
 * effect (never during a static/server render -- see `portal.test.ts`), so
 * it never affects `game/src`'s purity contract, which governs
 * `../game/src/reducer.ts` only, not this display-only client component.
 */
function useLiveNowMs(nowIso: string): number {
  const [nowMs, setNowMs] = useState<number>(() => {
    const parsed = Date.parse(nowIso);
    return Number.isFinite(parsed) ? parsed : Date.now();
  });
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return nowMs;
}

function ContractQueueLane({
  contracts,
  nowMs,
  copy,
}: {
  readonly contracts: readonly ContractProjection[];
  readonly nowMs: number;
  readonly copy: Copy;
}) {
  const open = contracts.filter((c) => c.status === "open");
  return (
    <div style={laneStyle}>
      <h4 style={{ margin: "0 0 4px 0", fontSize: "13px" }}>{copy.contractQueueTitle}</h4>
      <p style={{ margin: "0 0 8px 0", fontSize: "12px", color: "#5f6b7a" }}>{copy.contractQueueBody}</p>
      {open.length === 0 ? (
        <p style={{ margin: 0, fontSize: "12px", color: "#5f6b7a" }}>{copy.noContracts}</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>{copy.colContract}</th>
              <th style={thStyle}>{copy.colKind}</th>
              <th style={thStyle}>{copy.colPoints}</th>
              <th style={thStyle}>{copy.colShares}</th>
              <th style={thStyle}>{copy.colExpires}</th>
            </tr>
          </thead>
          <tbody>
            {open.map((c) => {
              const remainingMs = c.expiresAtMs - nowMs;
              const soon = remainingMs < 60_000;
              return (
                <tr key={c.id}>
                  <td style={tdStyle}>{c.id}</td>
                  <td style={tdStyle}>{c.kind === "rush" ? copy.kindRush : copy.kindStandard}</td>
                  <td style={tdStyle}>{c.points}</td>
                  <td style={tdStyle}>{c.requestedShareIndices.join(", ")}</td>
                  <td style={{ ...tdStyle, color: soon ? "#8a6d3b" : undefined }}>{formatDuration(remainingMs)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function VaultLane({ vault, copy }: { readonly vault: CryptoBattleProjection["vault"]; readonly copy: Copy }) {
  return (
    <div style={laneStyle}>
      <h4 style={{ margin: "0 0 4px 0", fontSize: "13px" }}>{copy.vaultTitle}</h4>
      <p style={{ margin: "0 0 8px 0", fontSize: "12px", color: "#5f6b7a" }}>{copy.vaultBody}</p>
      <p style={{ margin: "0 0 4px 0", fontSize: "12px" }}>
        {copy.generationLabel}: <strong>{vault.generation}</strong>
      </p>
      <p style={{ margin: "0 0 8px 0", fontSize: "12px", fontFamily: "monospace", wordBreak: "break-all" }}>
        {copy.secretLabel}: {vault.secret}
      </p>
      <p style={{ margin: "0 0 4px 0", fontSize: "12px", color: "#414d5c" }}>{copy.sharesLabel}</p>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>{copy.colShareIndex}</th>
            <th style={thStyle}>{copy.colShareValue}</th>
          </tr>
        </thead>
        <tbody>
          {vault.shares.map((s) => (
            <tr key={s.index}>
              <td style={tdStyle}>{s.index}</td>
              <td style={tdStyle}>{s.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ margin: "8px 0 0 0", fontSize: "12px" }}>
        {copy.rotateCooldownLabel}:{" "}
        <strong>{vault.rotateCooldownRemainingMs > 0 ? formatDuration(vault.rotateCooldownRemainingMs) : copy.rotateReady}</strong>
      </p>
      <p style={{ margin: "4px 0 0 0", fontSize: "12px" }}>
        {copy.huntedGenerationsLabel}:{" "}
        {vault.huntedGenerations.length > 0 ? vault.huntedGenerations.join(", ") : copy.none}
      </p>
    </div>
  );
}

function LedgerLane({
  ledger,
  myTeamId,
  copy,
}: {
  readonly ledger: readonly PublicArtifact[];
  readonly myTeamId: string;
  readonly copy: Copy;
}) {
  // Newest first. No derived "exposure" reading of any kind -- see this
  // file's header. Every column below is a field straight off `PublicArtifact`.
  const sorted = [...ledger].sort((a, b) => b.postedAtMs - a.postedAtMs);
  return (
    <div style={laneStyle}>
      <h4 style={{ margin: "0 0 4px 0", fontSize: "13px" }}>{copy.ledgerTitle}</h4>
      <p style={{ margin: "0 0 8px 0", fontSize: "12px", color: "#5f6b7a" }}>{copy.ledgerBody}</p>
      {sorted.length === 0 ? (
        <p style={{ margin: 0, fontSize: "12px", color: "#5f6b7a" }}>{copy.noLedgerEntries}</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>{copy.colTeam}</th>
              <th style={thStyle}>{copy.colGeneration}</th>
              <th style={thStyle}>{copy.colEntryKind}</th>
              <th style={thStyle}>{copy.colDetail}</th>
              <th style={thStyle}>{copy.colWhen}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry) => (
              <tr key={entry.id}>
                <td style={tdStyle}>
                  {entry.teamId}
                  {entry.teamId === myTeamId ? copy.you : ""}
                </td>
                <td style={tdStyle}>{entry.generation}</td>
                <td style={tdStyle}>{entry.kind === "share" ? copy.kindShare : copy.kindProof}</td>
                <td style={tdStyle}>
                  {entry.kind === "share" ? `#${entry.shareIndex} = ${entry.value}` : `${entry.commitment} / ${entry.response}`}
                </td>
                <td style={tdStyle}>{formatTimestamp(entry.postedAtMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * Pure, presentational body -- everything the header + 3 lanes need, given
 * an already-narrowed `projection`. Exported (unlike
 * microservice-migration-battle's StatusPanel, which inlines everything in
 * its default export) so `game/src/portal.test.ts` can render it directly
 * with a fabricated `CryptoBattleProjection`, independent of the
 * `coordinationClient` polling loop -- `renderToStaticMarkup` never runs
 * `useEffect`, so a full end-to-end poll cannot be exercised in a server
 * render anyway; this is the seam that keeps the populated-lanes cases
 * (including the "no exploit hints" check) testable without one.
 */
export function StatusPanelBody({
  projection,
  locale,
  nowMs,
}: {
  readonly projection: CryptoBattleProjection;
  readonly locale: Locale;
  readonly nowMs: number;
}) {
  const copy = COPY[locale];
  const myTeamId = projection.vault.teamId;
  const myScore = projection.teams[myTeamId]?.score ?? 0;
  const remainingMs =
    projection.matchEndsAtMs === undefined ? undefined : Math.max(0, projection.matchEndsAtMs - nowMs);

  return (
    <>
      <div style={headerRowStyle}>
        <div style={statBoxStyle}>
          <div style={{ fontSize: "11px", color: "#5f6b7a" }}>{copy.scoreLabel}</div>
          <div style={{ fontSize: "18px", fontWeight: 700 }}>{myScore}</div>
        </div>
        <div style={statBoxStyle}>
          <div style={{ fontSize: "11px", color: "#5f6b7a" }}>{copy.timeLabel}</div>
          <div style={{ fontSize: "18px", fontWeight: 700 }}>
            {remainingMs === undefined
              ? copy.notStarted
              : projection.phase === "ended"
                ? copy.matchEnded
                : formatDuration(remainingMs)}
          </div>
        </div>
        <div style={statBoxStyle}>
          <div style={{ fontSize: "11px", color: "#5f6b7a" }}>{copy.phaseLabel}</div>
          <div style={{ fontSize: "18px", fontWeight: 700 }}>{copy.phase[projection.phase]}</div>
        </div>
      </div>
      <div style={laneGridStyle}>
        <ContractQueueLane contracts={projection.myContracts} nowMs={nowMs} copy={copy} />
        <VaultLane vault={projection.vault} copy={copy} />
        <LedgerLane ledger={projection.publicLedger} myTeamId={myTeamId} copy={copy} />
      </div>
    </>
  );
}

export default function StatusPanel(props: PortalSlotProps) {
  const copy = COPY[props.locale === "ja" ? "ja" : "en"];
  const { coordinationClient } = props;
  const { projection, status } = usePolledProjection(coordinationClient);
  const nowMs = useLiveNowMs(props.nowIso);

  if (!coordinationClient) {
    return (
      <section style={panelStyle}>
        <h3 style={{ margin: "0 0 8px 0", fontSize: "16px" }}>{copy.title}</h3>
        <p style={{ margin: 0, fontSize: "13px", color: "#5f6b7a" }}>{copy.notConfigured}</p>
      </section>
    );
  }

  return (
    <section style={panelStyle}>
      <h3 style={{ margin: "0 0 4px 0", fontSize: "16px" }}>{copy.title}</h3>
      <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "#5f6b7a" }}>{copy.intro}</p>
      {status === "bad_projection" && (
        <p style={{ margin: "0 0 12px 0", fontSize: "12px", color: "#d13212" }}>{copy.badProjection}</p>
      )}
      {status !== null && status !== "bad_projection" && (
        <p style={{ margin: "0 0 12px 0", fontSize: "12px", color: "#d13212" }}>{copy.coordinationStatus(status)}</p>
      )}
      {projection ? (
        <StatusPanelBody projection={projection} locale={props.locale === "ja" ? "ja" : "en"} nowMs={nowMs} />
      ) : (
        status === null && <p style={{ margin: 0, fontSize: "13px", color: "#5f6b7a" }}>{copy.loading}</p>
      )}
    </section>
  );
}
