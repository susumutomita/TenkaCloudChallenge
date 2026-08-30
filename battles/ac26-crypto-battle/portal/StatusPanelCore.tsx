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
import { ledgerKindLabel, ledgerPayload, taskDetail, taskLabel } from "./orderTask.ts";
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
  readonly colTask: string;
  readonly colExpires: string;
  readonly kindStandard: string;
  readonly kindRush: string;
  readonly vaultTitle: string;
  readonly vaultBody: string;
  readonly teamIdLabel: string;
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
  readonly colOrder: string;
  readonly colDetail: string;
  readonly colWhen: string;
  readonly publicKeysTitle: string;
  readonly publicKeysBody: string;
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
    contractQueueBody: "Orders addressed to your team. Each says what it asks for and which methods it accepts. Miss the deadline and one expires unclaimed.",
    noContracts: "No open contracts right now.",
    colContract: "Contract",
    colKind: "Kind",
    colPoints: "Points",
    colTask: "What it asks for",
    colExpires: "Expires in",
    kindStandard: "standard",
    kindRush: "rush",
    vaultTitle: "My Vault",
    vaultBody: "Only your team can see this.",
    // PROVE's Python (HelpDrawer's "Computing PROVE and HUNT yourself")
    // needs this exact string as its `team` variable -- this is the only
    // place a fresh team can read it. Shown as monospace so it copy-pastes
    // cleanly (it feeds a length-prefixed hash preimage; even a
    // leading/trailing space copied in by accident would change the proof).
    teamIdLabel: "Team ID (for PROVE's `team` variable)",
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
    colOrder: "Order",
    colDetail: "Detail",
    colWhen: "Posted (UTC)",
    publicKeysTitle: "Public commitments (Y)",
    publicKeysBody:
      "Every team's public value Y, published from the start. Anyone can check any proof on the ledger against the team's Y — that is what makes a proof checkable without the secret.",
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
    contractQueueBody: "自チーム宛の依頼です。何を求められているかと、使える方法がそれぞれ書いてあります。期限内に応じないと失効します。",
    noContracts: "現在、open な contract はありません。",
    colContract: "Contract",
    colKind: "種別",
    colPoints: "得点",
    colTask: "依頼内容",
    colExpires: "期限まで",
    kindStandard: "standard",
    kindRush: "rush",
    vaultTitle: "My Vault",
    vaultBody: "自チームにのみ表示されます。",
    teamIdLabel: "Team ID (PROVE の `team` 変数)",
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
    colOrder: "依頼",
    colDetail: "詳細",
    colWhen: "記録時刻 (UTC)",
    publicKeysTitle: "公開値 (Y)",
    publicKeysBody:
      "各チームの公開値 Y です。最初から公開されています。ledger にある proof は、そのチームの Y と照らし合わせれば誰でも検算できます — secret を知らなくても proof を確かめられるのは、この Y があるからです。",
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
/**
 * A public commitment is a 2048-bit number, so it is ~617 decimal digits. It
 * has to be rendered in full -- a truncated Y cannot be fed to the challenge
 * hash, which would leave it as decorative as not showing it at all -- so it
 * wraps anywhere rather than overflowing its lane.
 */
const publicKeyValueStyle: CSSProperties = {
  margin: 0,
  fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace",
  overflowWrap: "anywhere",
  color: "#5f6b7a",
};
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

/**
 * Elapsed-time-since-match-start "when" column for the ledger, formatted as
 * HH:MM:SS. `entry.postedAtMs` (`PublicArtifact.postedAtMs`) lives on the
 * dispatcher's elapsed-since-event-start clock, NOT a Unix epoch ms (same
 * clock as `ContractProjection.remainingMs` / `matchRemainingMs` -- see
 * those fields' doc comments in `../game/src/types.ts`), so this
 * deliberately does NOT try to render it as a wall-clock time of day.
 * Feeding an elapsed-ms duration straight into `new Date(ms)` and slicing
 * out `HH:MM:SS` happens to be exactly correct here BECAUSE `Date`'s epoch
 * is 1970-01-01T00:00:00Z: `new Date(elapsedMs).toISOString()`'s
 * `HH:MM:SS` segment IS that duration's hours/minutes/seconds, as long as
 * it stays under 24h -- always true here, since `elapsedMs <=
 * matchDurationMs` (90 min, `DEFAULT_CONFIG` in `../game/src/reducer.ts`).
 * Do not "fix" this into `new Date(ms).toLocaleTimeString()` or similar --
 * that would render this problem's OWN Deploy-time wall clock, not elapsed
 * match time, for every viewer.
 */
function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

/**
 * Ms of real wall-clock time elapsed since `receivedAtWallMs` (when the
 * current projection was fetched), ticking forward once a second so
 * contract/match countdowns visibly move between the 30s projection polls.
 *
 * Deliberately NOT `props.nowIso` minus a projection timestamp: this
 * problem's `CryptoBattleProjection` (`../game/src/types.ts`) intentionally
 * ships `remainingMs` / `matchRemainingMs` as durations already computed
 * server-side against the dispatcher's elapsed-since-event-start clock --
 * see those fields' doc comments for why an EARLIER version of this file
 * subtracted an absolute `Date.now()`-derived `nowMs` from a raw
 * `expiresAtMs` here and rendered every countdown as a permanent "0:00"
 * (the two clocks differ by roughly the age of Unix time itself). This hook
 * only ever measures wall-clock elapsed time against `receivedAtWallMs`
 * (also an absolute `Date.now()`-based value, from the same clock) -- same
 * units on both sides of every subtraction, unlike the old code.
 *
 * `receivedAtWallMs === null` (no successful poll yet) returns 0: the
 * caller renders `copy.loading` / `copy.notConfigured` in that case anyway
 * (see `StatusPanel`'s default export below), never a countdown.
 *
 * This `setInterval` runs only as a real DOM effect (never during a
 * static/server render -- see `portal.test.ts`), so it never affects
 * `game/src`'s purity contract, which governs `../game/src/reducer.ts`
 * only, not this display-only client component.
 */
function useElapsedSincePollMs(receivedAtWallMs: number | null): number {
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  useEffect(() => {
    if (receivedAtWallMs === null) {
      setElapsedMs(0);
      return;
    }
    const recompute = () => setElapsedMs(Math.max(0, Date.now() - receivedAtWallMs));
    recompute();
    const id = setInterval(recompute, 1000);
    return () => clearInterval(id);
  }, [receivedAtWallMs]);
  return elapsedMs;
}

function ContractQueueLane({
  contracts,
  elapsedSincePollMs,
  locale,
  copy,
}: {
  readonly contracts: readonly ContractProjection[];
  readonly elapsedSincePollMs: number;
  readonly locale: Locale;
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
              <th style={thStyle}>{copy.colTask}</th>
              <th style={thStyle}>{copy.colExpires}</th>
            </tr>
          </thead>
          <tbody>
            {open.map((c) => {
              const remainingMs = Math.max(0, c.remainingMs - elapsedSincePollMs);
              const soon = remainingMs < 60_000;
              return (
                <tr key={c.id}>
                  <td style={tdStyle}>{c.id}</td>
                  <td style={tdStyle}>{c.kind === "rush" ? copy.kindRush : copy.kindStandard}</td>
                  <td style={tdStyle}>{c.points}</td>
                  {/*
                    [Issue #645] The participant-facing label, not
                    `describeTaskShort` — whose own docstring says it names the
                    mechanism for operators and is "exactly what a participant
                    should not be handed as their first impression of the job".
                    This lane is that first impression, and it was rendering
                    `fhe-sum×2` under a column headed "Requested shares".
                  */}
                  <td style={tdStyle}>
                    {taskLabel(c.task, locale)} · {taskDetail(c.task, locale)}
                  </td>
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

function VaultLane({
  vault,
  elapsedSincePollMs,
  copy,
}: {
  readonly vault: CryptoBattleProjection["vault"];
  readonly elapsedSincePollMs: number;
  readonly copy: Copy;
}) {
  const rotateCooldownRemainingMs = Math.max(0, vault.rotateCooldownRemainingMs - elapsedSincePollMs);
  return (
    <div style={laneStyle}>
      <h4 style={{ margin: "0 0 4px 0", fontSize: "13px" }}>{copy.vaultTitle}</h4>
      <p style={{ margin: "0 0 8px 0", fontSize: "12px", color: "#5f6b7a" }}>{copy.vaultBody}</p>
      <p style={{ margin: "0 0 4px 0", fontSize: "12px" }}>
        {copy.teamIdLabel}: <strong style={{ fontFamily: "monospace" }}>{vault.teamId}</strong>
      </p>
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
        <strong>{rotateCooldownRemainingMs > 0 ? formatDuration(rotateCooldownRemainingMs) : copy.rotateReady}</strong>
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
  publicCommitments,
  myTeamId,
  copy,
}: {
  readonly ledger: readonly PublicArtifact[];
  readonly publicCommitments: Readonly<Record<string, string>>;
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
              <th style={thStyle}>{copy.colOrder}</th>
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
                {/*
                  [Issue #645] Four artifact shapes now, one rendering. Labels
                  and payloads live in orderTask.ts so the ledger cannot start
                  disagreeing with the game board about what a row means.
                */}
                <td style={tdStyle}>{ledgerKindLabel(entry)}</td>
                {/*
                  [Issue #645] The Order an artifact was posted against. Public
                  on every artifact shape, and one of the five values a proof's
                  challenge is computed over (see the Help Drawer's Python:
                  domain, team, contract, generation, R, Y) -- so without it on
                  screen a reader cannot re-derive a challenge from the ledger,
                  and the nonce-reuse HUNT is unreachable by hand.
                */}
                <td style={tdStyle}>{entry.contractId}</td>
                <td style={tdStyle}>{ledgerPayload(entry)}</td>
                <td style={tdStyle}>{formatTimestamp(entry.postedAtMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {/*
        [Issue #645] Y, the other value a proof's challenge binds. It is public
        by construction (see reducer.ts's `publicCommitments`) and PROVE is only
        checkable BECAUSE it is public -- but it reached no participant surface,
        which left every challenge on the ledger impossible to re-derive and the
        nonce-reuse HUNT unplayable by hand.
      */}
      <div style={{ marginTop: "12px" }}>
        <h5 style={{ margin: "0 0 2px 0", fontSize: "12px" }}>{copy.publicKeysTitle}</h5>
        <p style={{ margin: "0 0 6px 0", fontSize: "11px", color: "#5f6b7a" }}>
          {copy.publicKeysBody}
        </p>
        <dl style={{ margin: 0, fontSize: "11px" }}>
          {Object.entries(publicCommitments).map(([teamId, y]) => (
            <div key={teamId} style={{ margin: "0 0 6px 0" }}>
              <dt style={{ fontWeight: 700 }}>
                {teamId}
                {teamId === myTeamId ? copy.you : ""}
              </dt>
              <dd style={publicKeyValueStyle}>{y}</dd>
            </div>
          ))}
        </dl>
      </div>
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
  elapsedSincePollMs,
}: {
  readonly projection: CryptoBattleProjection;
  readonly locale: Locale;
  /** See `useElapsedSincePollMs`'s doc comment. 0 is the correct value "as of the last poll" (e.g. in tests). */
  readonly elapsedSincePollMs: number;
}) {
  const copy = COPY[locale];
  const myTeamId = projection.vault.teamId;
  const myScore = projection.teams[myTeamId]?.score ?? 0;
  const remainingMs =
    projection.matchRemainingMs === undefined
      ? undefined
      : Math.max(0, projection.matchRemainingMs - elapsedSincePollMs);

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
        <ContractQueueLane
          contracts={projection.myContracts}
          elapsedSincePollMs={elapsedSincePollMs}
          locale={locale}
          copy={copy}
        />
        <VaultLane vault={projection.vault} elapsedSincePollMs={elapsedSincePollMs} copy={copy} />
        <LedgerLane
          ledger={projection.publicLedger}
          publicCommitments={projection.publicCommitments}
          myTeamId={myTeamId}
          copy={copy}
        />
      </div>
    </>
  );
}

export default function StatusPanel(props: PortalSlotProps) {
  const copy = COPY[props.locale === "ja" ? "ja" : "en"];
  const { coordinationClient } = props;
  const { projection, status, receivedAtWallMs } = usePolledProjection(coordinationClient);
  const elapsedSincePollMs = useElapsedSincePollMs(receivedAtWallMs);

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
        <StatusPanelBody
          projection={projection}
          locale={props.locale === "ja" ? "ja" : "en"}
          elapsedSincePollMs={elapsedSincePollMs}
        />
      ) : (
        status === null && <p style={{ margin: 0, fontSize: "13px", color: "#5f6b7a" }}>{copy.loading}</p>
      )}
    </section>
  );
}
