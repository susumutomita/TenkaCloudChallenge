/**
 * Issue #486 PR4: ac26-crypto-battle RegistrationPanel plugin -- the
 * participant's op submission form for LEAK / PROVE / HUNT / ROTATE.
 *
 * Deliberately does NOT compute anything cryptographic on the participant's
 * behalf:
 * - LEAK only needs a contract selection -- no computation at all.
 * - PROVE needs a `SchnorrProof { commitment, response }`. The proof is
 *   built locally by the participant's own tooling
 *   (`game/src/schnorr-prover.ts`'s `createProof`, or an equivalent script
 *   they write against the same construction -- see README.md's "How PROVE
 *   works"), never inside this form. This is not a missing feature: Issue
 *   #486 frames PROVE's local proof construction as the move's actual
 *   compute cost, the same way HUNT's local Lagrange reconstruction is
 *   HUNT's compute cost (see `coordination.ts`'s header). A portal button
 *   that ran `createProof` for you would erase that cost entirely.
 * - HUNT needs `recoveredSecret`, reconstructed locally from
 *   `threshold`-many Public Ledger shares (via `game/src/shamir.ts`'s
 *   `reconstruct`, or the participant's own Lagrange interpolation) --
 *   same reasoning.
 * - ROTATE takes no input at all beyond a confirmation, since it has no
 *   participant-supplied data.
 *
 * Every submit goes through `props.coordinationClient.submitOp(op)`
 * (undefined -> the whole panel fail-closes, same as `StatusPanel.tsx`).
 * The 4 `submit*` functions below build exactly the `CryptoBattleOp` shape
 * `../game/src/types.ts` declares and forward it verbatim -- they are
 * exported so `game/src/portal.test.ts` can assert the op shape a mock
 * client actually received, without needing a DOM/click-simulation harness
 * (`renderToStaticMarkup` never fires `onClick`; see that test file's
 * header).
 *
 * Error handling follows Issue #486's 3-way split, via `describeOutcome`:
 *   (a) `rejected` -- a cryptographic failure or a game-rule rejection
 *       (`../game/src/reducer.ts`'s `validateOp` error string, shown as-is
 *       -- it is already a short, specific, non-secret-leaking reason, see
 *       that function).
 *   (b) `unavailable` / `conflict` / `unauthorized` -- an infra-side
 *       condition unrelated to whether the op itself was valid; shown as a
 *       generic "retry" message, distinct from (a).
 *   (c) `not_configured` -- coordination disabled for this
 *       deployment/session; same fail-closed framing as no
 *       `coordinationClient` at all.
 *
 * Cloudscape is not imported -- see `StatusPanel.tsx`'s header / the
 * microservice-migration-battle precedent for why. Plain HTML + inline style.
 */

import { useState } from "react";
import type { PortalCoordinationClient, PortalCoordinationOutcome, PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import { usePolledProjection } from "./coordination.ts";
import type { ContractProjection, CryptoBattleOp, TeamSummaryProjection } from "../game/src/types.ts";

type Locale = "ja" | "en";

/**
 * Explicit interface, not `(typeof COPY)["en"]` -- see StatusPanel.tsx's
 * `Copy` doc comment for why: without it, TS pins every field to the
 * English variant's exact string literal, and the `ja` variant (with
 * different literal text) fails to type-check wherever a `Copy`-typed prop
 * is expected.
 */
interface Copy {
  readonly title: string;
  readonly intro: string;
  readonly notConfigured: string;
  readonly loadingContracts: string;
  readonly submitting: string;
  readonly submitted: string;
  readonly rejectedPrefix: string;
  readonly infraIssue: string;
  readonly notConfiguredResult: string;
  readonly noOpenContracts: string;
  readonly leakTitle: string;
  readonly leakSubmit: string;
  readonly proveTitle: string;
  readonly proveLocalNote: string;
  readonly commitmentLabel: string;
  readonly responseLabel: string;
  readonly provePasteJsonLabel: string;
  readonly proveFillFromJson: string;
  readonly proveJsonError: string;
  readonly proveSubmit: string;
  readonly huntTitle: string;
  readonly huntLocalNote: string;
  readonly huntNoTargets: string;
  readonly targetLabel: string;
  readonly generationLabel: string;
  readonly recoveredSecretLabel: string;
  readonly huntSubmit: string;
  readonly rotateTitle: string;
  readonly rotateNote: string;
  readonly rotateConfirmPrompt: string;
  readonly rotateSubmit: string;
}

/**
 * Exported (Issue #486 PR4 review, medium #1) so `game/src/portal.test.ts`
 * can assert `describeOutcome`'s actual localized output against the real
 * ja/en strings, rather than duplicating them as separate expected-value
 * literals in the test that could silently drift from this file's copy.
 */
export const COPY: Record<Locale, Copy> = {
  en: {
    title: "PROVE / LEAK / HUNT -- Submit a move",
    intro: "Every move below goes straight to the match. There is no undo.",
    notConfigured: "Coordination is not wired up for this session -- moves cannot be submitted here.",
    loadingContracts: "Loading your open contracts…",
    submitting: "Submitting…",
    submitted: "Submitted -- the match applied your move.",
    rejectedPrefix: "Rejected: ",
    infraIssue: "The coordination service had a problem on its side -- please retry.",
    notConfiguredResult: "Coordination is not available for this session.",
    noOpenContracts: "No open contract right now.",
    leakTitle: "LEAK",
    leakSubmit: "LEAK the selected shares",
    proveTitle: "PROVE",
    proveLocalNote:
      "Build the proof locally first (see README.md's \"How PROVE works\" -- game/src/schnorr-prover.ts's createProof, or your own equivalent). This form never computes a proof for you.",
    commitmentLabel: "commitment",
    responseLabel: "response",
    provePasteJsonLabel: "Paste { commitment, response } JSON instead",
    proveFillFromJson: "Fill fields from JSON",
    proveJsonError: "That is not valid JSON with string commitment/response fields.",
    proveSubmit: "PROVE this contract",
    huntTitle: "HUNT",
    huntLocalNote:
      "Reconstruct the secret locally first, from threshold-many of the target's Public Ledger shares (Lagrange interpolation -- game/src/shamir.ts's reconstruct, or your own equivalent). Guessing does not score.",
    huntNoTargets: "No other team to target yet.",
    targetLabel: "Target team",
    generationLabel: "Target's generation",
    recoveredSecretLabel: "Recovered secret (decimal)",
    huntSubmit: "Submit HUNT",
    rotateTitle: "ROTATE",
    rotateNote: "Advances your secret to a new generation and voids every currently-open contract you hold. Has a cooldown.",
    rotateConfirmPrompt: "ROTATE your secret now? This voids your open contracts and starts a cooldown.",
    rotateSubmit: "ROTATE",
  },
  ja: {
    title: "PROVE / LEAK / HUNT — 操作を送信",
    intro: "以下の操作はすべて即座に試合へ反映されます。取り消しはできません。",
    notConfigured: "この session では coordination が未配線のため、操作を送信できません。",
    loadingContracts: "open な contract を読み込み中…",
    submitting: "送信中…",
    submitted: "送信しました — 試合に反映されました。",
    rejectedPrefix: "却下されました: ",
    infraIssue: "coordination service 側で問題が発生しました。しばらくしてから再試行してください。",
    notConfiguredResult: "この session では coordination を利用できません。",
    noOpenContracts: "現在、open な contract はありません。",
    leakTitle: "LEAK",
    leakSubmit: "選択した share を LEAK する",
    proveTitle: "PROVE",
    proveLocalNote:
      "proof は先にローカルで作成してください (README.md の「PROVE の実際の手順」— game/src/schnorr-prover.ts の createProof、または同等の自作ツール)。この form が代わりに proof を計算することはありません。",
    commitmentLabel: "commitment",
    responseLabel: "response",
    provePasteJsonLabel: "代わりに { commitment, response } の JSON を貼り付ける",
    proveFillFromJson: "JSON からフィールドに反映",
    proveJsonError: "commitment / response が文字列で入った有効な JSON ではありません。",
    proveSubmit: "この contract を PROVE する",
    huntTitle: "HUNT",
    huntLocalNote:
      "先に相手の Public Ledger の share を threshold 分集めてローカルで secret を復元してください (Lagrange 補間 — game/src/shamir.ts の reconstruct、または同等の自作ツール)。当て推量では得点になりません。",
    huntNoTargets: "まだ狙える他チームがいません。",
    targetLabel: "対象チーム",
    generationLabel: "対象チームの世代",
    recoveredSecretLabel: "復元した secret (10 進数)",
    huntSubmit: "HUNT を送信",
    rotateTitle: "ROTATE",
    rotateNote: "secret を新しい世代に更新し、現在 open な自チーム宛 contract をすべて無効化します。クールダウンがあります。",
    rotateConfirmPrompt: "secret を ROTATE しますか? open な contract は無効化され、クールダウンが始まります。",
    rotateSubmit: "ROTATE する",
  },
};

const panelStyle = {
  border: "1px solid #d5dbdb",
  borderRadius: "8px",
  padding: "16px",
  background: "#fff8e5",
} as const;

const formsGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: "12px",
} as const;

const formCardStyle = {
  border: "1px solid #f0e0b0",
  borderRadius: "6px",
  padding: "10px 12px",
  background: "#fff",
  display: "flex",
  flexDirection: "column" as const,
  gap: "6px",
};

const fieldStyle = { padding: "4px 6px", fontSize: "13px" } as const;
const noteStyle = { margin: "0 0 4px 0", fontSize: "11px", color: "#5f6b7a" } as const;
const resultStyle = { margin: "4px 0 0 0", fontSize: "12px", color: "#414d5c" } as const;
const errStyle = { margin: "4px 0 0 0", fontSize: "12px", color: "#d13212" } as const;

/** Builds and submits a LEAK op. Exported for direct testing -- see this file's header. */
export function submitLeak(client: PortalCoordinationClient, contractId: string): Promise<PortalCoordinationOutcome> {
  const op: CryptoBattleOp = { kind: "leak", contractId };
  return client.submitOp(op);
}

/** Builds and submits a PROVE op. Exported for direct testing -- see this file's header. */
export function submitProve(
  client: PortalCoordinationClient,
  contractId: string,
  proof: { readonly commitment: string; readonly response: string },
): Promise<PortalCoordinationOutcome> {
  const op: CryptoBattleOp = { kind: "prove", contractId, proof };
  return client.submitOp(op);
}

/** Builds and submits a HUNT op. Exported for direct testing -- see this file's header. */
export function submitHunt(
  client: PortalCoordinationClient,
  targetTeamId: string,
  generation: number,
  recoveredSecret: string,
): Promise<PortalCoordinationOutcome> {
  const op: CryptoBattleOp = { kind: "hunt", targetTeamId, generation, recoveredSecret };
  return client.submitOp(op);
}

/** Builds and submits a ROTATE op. Exported for direct testing -- see this file's header. */
export function submitRotate(client: PortalCoordinationClient): Promise<PortalCoordinationOutcome> {
  const op: CryptoBattleOp = { kind: "rotate" };
  return client.submitOp(op);
}

/**
 * Issue #486's 3-way error split -- see this file's header. Shared by all 4
 * forms below. Exported (alongside `COPY`) so `game/src/portal.test.ts` can
 * verify the actual displayed text for every outcome kind directly --
 * including `"ok"`, which previously fell through to the literal string
 * `"ok"` instead of a localized success message (Issue #486 PR4 review,
 * medium #1) -- without needing a DOM click-simulation harness this repo
 * doesn't have (see this file's header on why `submit*` are exported the
 * same way).
 */
export function describeOutcome(outcome: PortalCoordinationOutcome, copy: Copy): string {
  switch (outcome.kind) {
    case "ok":
      return copy.submitted;
    case "rejected":
      return `${copy.rejectedPrefix}${outcome.error}`;
    case "not_configured":
      return copy.notConfiguredResult;
    case "unavailable":
    case "conflict":
    case "unauthorized":
      return copy.infraIssue;
    default: {
      const exhaustive: never = outcome;
      return String(exhaustive);
    }
  }
}

function LeakForm({
  client,
  contracts,
  copy,
}: {
  readonly client: PortalCoordinationClient;
  readonly contracts: readonly ContractProjection[];
  readonly copy: Copy;
}) {
  const [contractId, setContractId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const selected = contractId || contracts[0]?.id || "";

  const onSubmit = () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    setResult(null);
    void submitLeak(client, selected).then((outcome) => {
      setResult(describeOutcome(outcome, copy));
      setSubmitting(false);
    });
  };

  return (
    <div style={formCardStyle}>
      <h4 style={{ margin: 0, fontSize: "13px" }}>{copy.leakTitle}</h4>
      {contracts.length === 0 ? (
        <p style={noteStyle}>{copy.noOpenContracts}</p>
      ) : (
        <>
          <select aria-label="leak-contract" style={fieldStyle} value={selected} onChange={(e) => setContractId(e.target.value)}>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} ({c.kind}, {c.points}pt, shares[{c.requestedShareIndices.join(",")}])
              </option>
            ))}
          </select>
          <button type="button" style={fieldStyle} onClick={onSubmit} disabled={submitting}>
            {submitting ? copy.submitting : copy.leakSubmit}
          </button>
        </>
      )}
      {result && <p style={resultStyle}>{result}</p>}
    </div>
  );
}

function ProveForm({
  client,
  contracts,
  copy,
}: {
  readonly client: PortalCoordinationClient;
  readonly contracts: readonly ContractProjection[];
  readonly copy: Copy;
}) {
  const [contractId, setContractId] = useState("");
  const [commitment, setCommitment] = useState("");
  const [response, setResponse] = useState("");
  const [pasteJson, setPasteJson] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const selected = contractId || contracts[0]?.id || "";

  const fillFromJson = () => {
    try {
      const parsed = JSON.parse(pasteJson) as { commitment?: unknown; response?: unknown };
      if (typeof parsed.commitment !== "string" || typeof parsed.response !== "string") {
        throw new Error("missing commitment/response");
      }
      // Trimmed on the way in (same as the manual-entry path below) so the
      // field always shows exactly what will be submitted.
      setCommitment(parsed.commitment.trim());
      setResponse(parsed.response.trim());
      setParseError(null);
    } catch {
      setParseError(copy.proveJsonError);
    }
  };

  const onSubmit = () => {
    // Trimmed here, not on every keystroke (which would fight the cursor
    // while typing): a copy-pasted commitment/response with a trailing
    // newline or leading space is otherwise well-formed, and untrimmed
    // would fail Schnorr verification exactly like a genuinely wrong proof
    // -- indistinguishable from a real cryptographic error (Issue #486 PR4
    // review, low #3; HUNT's recoveredSecret gets the same treatment below).
    const trimmedCommitment = commitment.trim();
    const trimmedResponse = response.trim();
    if (!selected || !trimmedCommitment || !trimmedResponse || submitting) return;
    setSubmitting(true);
    setResult(null);
    void submitProve(client, selected, { commitment: trimmedCommitment, response: trimmedResponse }).then((outcome) => {
      setResult(describeOutcome(outcome, copy));
      setSubmitting(false);
    });
  };

  return (
    <div style={formCardStyle}>
      <h4 style={{ margin: 0, fontSize: "13px" }}>{copy.proveTitle}</h4>
      <p style={noteStyle}>{copy.proveLocalNote}</p>
      {contracts.length === 0 ? (
        <p style={noteStyle}>{copy.noOpenContracts}</p>
      ) : (
        <>
          <select aria-label="prove-contract" style={fieldStyle} value={selected} onChange={(e) => setContractId(e.target.value)}>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} ({c.kind}, {c.points}pt)
              </option>
            ))}
          </select>
          <input
            aria-label="commitment"
            style={fieldStyle}
            placeholder={copy.commitmentLabel}
            value={commitment}
            onChange={(e) => setCommitment(e.target.value)}
          />
          <input
            aria-label="response"
            style={fieldStyle}
            placeholder={copy.responseLabel}
            value={response}
            onChange={(e) => setResponse(e.target.value)}
          />
          <details>
            <summary style={{ fontSize: "12px", cursor: "pointer" }}>{copy.provePasteJsonLabel}</summary>
            <textarea
              aria-label="prove-json"
              style={{ ...fieldStyle, width: "100%", marginTop: "4px" }}
              value={pasteJson}
              onChange={(e) => setPasteJson(e.target.value)}
              placeholder='{"commitment":"...","response":"..."}'
            />
            <button type="button" style={fieldStyle} onClick={fillFromJson}>
              {copy.proveFillFromJson}
            </button>
            {parseError && <p style={errStyle}>{parseError}</p>}
          </details>
          <button
            type="button"
            style={fieldStyle}
            onClick={onSubmit}
            disabled={submitting || !commitment.trim() || !response.trim()}
          >
            {submitting ? copy.submitting : copy.proveSubmit}
          </button>
        </>
      )}
      {result && <p style={resultStyle}>{result}</p>}
    </div>
  );
}

function HuntForm({
  client,
  teamIds,
  myTeamId,
  teams,
  copy,
}: {
  readonly client: PortalCoordinationClient;
  readonly teamIds: readonly string[];
  readonly myTeamId: string | undefined;
  readonly teams: Readonly<Record<string, TeamSummaryProjection>>;
  readonly copy: Copy;
}) {
  const targets = teamIds.filter((t) => t !== myTeamId);
  const [targetTeamId, setTargetTeamId] = useState("");
  const [generation, setGeneration] = useState("");
  const [recoveredSecret, setRecoveredSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const selectedTarget = targetTeamId || targets[0] || "";
  const knownGeneration = selectedTarget ? teams[selectedTarget]?.generation : undefined;
  const generationValue = generation || (knownGeneration !== undefined ? String(knownGeneration) : "");

  const onSubmit = () => {
    const gen = Number(generationValue);
    if (!selectedTarget || !Number.isFinite(gen) || !recoveredSecret || submitting) return;
    setSubmitting(true);
    setResult(null);
    void submitHunt(client, selectedTarget, gen, recoveredSecret.trim()).then((outcome) => {
      setResult(describeOutcome(outcome, copy));
      setSubmitting(false);
    });
  };

  return (
    <div style={formCardStyle}>
      <h4 style={{ margin: 0, fontSize: "13px" }}>{copy.huntTitle}</h4>
      <p style={noteStyle}>{copy.huntLocalNote}</p>
      {targets.length === 0 ? (
        <p style={noteStyle}>{copy.huntNoTargets}</p>
      ) : (
        <>
          <select
            aria-label="hunt-target"
            style={fieldStyle}
            value={selectedTarget}
            onChange={(e) => {
              setTargetTeamId(e.target.value);
              setGeneration("");
            }}
          >
            {targets.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            aria-label="hunt-generation"
            type="number"
            style={fieldStyle}
            placeholder={copy.generationLabel}
            value={generationValue}
            onChange={(e) => setGeneration(e.target.value)}
          />
          <input
            aria-label="hunt-recovered-secret"
            style={fieldStyle}
            placeholder={copy.recoveredSecretLabel}
            value={recoveredSecret}
            onChange={(e) => setRecoveredSecret(e.target.value)}
          />
          <button type="button" style={fieldStyle} onClick={onSubmit} disabled={submitting || !recoveredSecret}>
            {submitting ? copy.submitting : copy.huntSubmit}
          </button>
        </>
      )}
      {result && <p style={resultStyle}>{result}</p>}
    </div>
  );
}

function RotateForm({ client, copy }: { readonly client: PortalCoordinationClient; readonly copy: Copy }) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const onSubmit = () => {
    if (submitting) return;
    if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(copy.rotateConfirmPrompt)) {
      return;
    }
    setSubmitting(true);
    setResult(null);
    void submitRotate(client).then((outcome) => {
      setResult(describeOutcome(outcome, copy));
      setSubmitting(false);
    });
  };

  return (
    <div style={formCardStyle}>
      <h4 style={{ margin: 0, fontSize: "13px" }}>{copy.rotateTitle}</h4>
      <p style={noteStyle}>{copy.rotateNote}</p>
      <button type="button" style={fieldStyle} onClick={onSubmit} disabled={submitting}>
        {submitting ? copy.submitting : copy.rotateSubmit}
      </button>
      {result && <p style={resultStyle}>{result}</p>}
    </div>
  );
}

export default function RegistrationPanel(props: PortalSlotProps) {
  const copy = COPY[props.locale === "ja" ? "ja" : "en"];
  const { coordinationClient } = props;
  const { projection } = usePolledProjection(coordinationClient);

  if (!coordinationClient) {
    return (
      <section style={panelStyle}>
        <h3 style={{ margin: "0 0 8px 0", fontSize: "16px" }}>{copy.title}</h3>
        <p style={{ margin: 0, fontSize: "13px", color: "#5f6b7a" }}>{copy.notConfigured}</p>
      </section>
    );
  }

  const openContracts = projection ? projection.myContracts.filter((c) => c.status === "open") : [];
  const myTeamId = projection?.vault.teamId;
  const teamIds = projection ? Object.keys(projection.teams) : [];
  const teams = projection?.teams ?? {};

  return (
    <section style={panelStyle}>
      <h3 style={{ margin: "0 0 4px 0", fontSize: "16px" }}>{copy.title}</h3>
      <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "#5f6b7a" }}>{copy.intro}</p>
      {!projection && <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "#5f6b7a" }}>{copy.loadingContracts}</p>}
      <div style={formsGridStyle}>
        <LeakForm client={coordinationClient} contracts={openContracts} copy={copy} />
        <ProveForm client={coordinationClient} contracts={openContracts} copy={copy} />
        <HuntForm client={coordinationClient} teamIds={teamIds} myTeamId={myTeamId} teams={teams} copy={copy} />
        <RotateForm client={coordinationClient} copy={copy} />
      </div>
    </section>
  );
}
