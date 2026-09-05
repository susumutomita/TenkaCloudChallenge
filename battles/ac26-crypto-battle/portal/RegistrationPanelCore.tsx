/**
 * Issue #486 PR4: ac26-crypto-battle RegistrationPanel plugin -- the
 * participant's op submission form for LEAK / PROVE / HUNT / ROTATE.
 *
 * Deliberately does NOT compute anything cryptographic on the participant's
 * behalf:
 * - LEAK only needs a contract selection -- no computation at all.
 * - PROVE needs the team's sudoku solution with every digit relabelled by a
 *   table the team chose (#709). The relabelling is done by the participant,
 *   on paper, never inside this form. This is not a missing feature: Issue
 *   #486 frames PROVE's local work as the move's actual compute cost, the
 *   same way HUNT's local Lagrange reconstruction is HUNT's compute cost (see
 *   `coordination.ts`'s header). A portal button that relabelled the grid
 *   for you would erase that cost entirely.
 * - HUNT needs `recoveredSecret`, reconstructed locally from
 *   `threshold`-many Public Ledger shares (via `game/src/shamir.ts`'s
 *   `reconstruct`, or the participant's own Lagrange interpolation) --
 *   same reasoning.
 * - ROTATE takes no input at all beyond a confirmation, since it has no
 *   participant-supplied data.
 *
 * Every submit goes through `props.coordinationClient.submitOp(op)`
 * (undefined -> the whole panel fail-closes, same as `StatusPanel.tsx`).
 * The `submit*` functions below build exactly the `CryptoBattleOp` shape
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

import { useEffect, useState } from "react";
import type { CipherRung } from "../game/src/ladder.ts";
import { describeTaskShort } from "./orderTask.ts";
import type { PortalCoordinationClient, PortalCoordinationOutcome, PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import { isCryptoBattleProjection, usePolledProjection } from "./coordination.ts";
import type {
  ContractProjection,
  CryptoBattleOp,
  SubmissionMethod,
  TeamSummaryProjection,
} from "../game/src/types.ts";

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
  readonly gridLabel: string;
  readonly gridError: string;
  readonly proveSubmit: string;
  readonly proveHitResult: string;
  readonly proveMissResult: (cost: number) => string;
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
      "Relabel your solution on paper first: pick a table like 1->3, 2->1, 3->4, 4->2 -- each of 1-4 exactly once on the right, a swap and never a merge -- and rewrite all 16 cells of MY VAULT's grid through it. Never the same table twice on one generation. This form never computes a proof for you.",
    gridLabel: "relabelled grid: 16 digits, row by row (e.g. 2341 4123 1432 3214)",
    gridError: "Enter exactly 16 digits, each 1-4, in row order.",
    proveSubmit: "PROVE this contract",
    proveHitResult: "PROVE accepted -- one group of your relabelled copy is on the Public Ledger; your solution is not.",
    proveMissResult: (cost: number) => `PROVE missed -- that grid is not a relabelling of your solution (-${cost}). The Order is still open. Check that the table uses each of 1-4 once, then check it against every cell.`,
    huntTitle: "HUNT",
    huntLocalNote:
      "Reconstruct the secret locally first, from threshold-many of the target's Public Ledger shares. The Lagrange evaluation is further down this page under \"Computing PROVE and HUNT yourself\". Guessing does not score.",
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
      "先に紙で付け替えてください。「1→3、2→1、3→4、4→2」のような表を 1 つ決め (右側は 1〜4 を 1 回ずつ。入れ替えであって、まとめではありません)、MY VAULT のマス目 16 個をその表で書き換えます。同じ世代で同じ表は 2 度使いません。この form が代わりに proof を計算することはありません。",
    gridLabel: "付け替えたマス目: 1 行ずつ 16 桁 (例 2341 4123 1432 3214)",
    gridError: "1〜4 の数字を、行の順に 16 個入力してください。",
    proveSubmit: "この contract を PROVE する",
    proveHitResult: "PROVE 成功 — 付け替えた写しの 1 グループが Public Ledger に載りました。解は載っていません。",
    proveMissResult: (cost: number) => `PROVE 失敗 — そのマス目は自分の解の付け替えになっていません (-${cost})。Order は開いたままです。表が 1〜4 を 1 回ずつ使っているか確かめてから、全マスに当て直してください。`,
    huntTitle: "HUNT",
    huntLocalNote:
      "先に相手の Public Ledger の share を threshold 分集めてローカルで secret を復元してください。Lagrange の評価式はこのページ下部の「PROVE と HUNT を自分で計算する」にあります。当て推量では得点になりません。",
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

/**
 * [Issue #645] The Orders one method can actually fulfil.
 *
 * Each advanced form offers only these. An FHE or MPC Order sitting in the
 * LEAK selector is a move the judge is certain to refuse, and `allowedMethods`
 * is the Order's own answer to "can this method do this job" — so the form
 * asks it rather than re-deriving the game's rules.
 *
 * Exported for `game/src/portal.test.ts`, which cannot reach the populated
 * panel: `renderToStaticMarkup` never runs the effect that fetches a
 * projection.
 */
export function contractsForMethod(
  contracts: readonly ContractProjection[],
  method: SubmissionMethod,
): readonly ContractProjection[] {
  return contracts.filter((c) => c.allowedMethods.includes(method));
}

/** Builds and submits a LEAK op. Exported for direct testing -- see this file's header. */
export function submitLeak(client: PortalCoordinationClient, contractId: string): Promise<PortalCoordinationOutcome> {
  const op: CryptoBattleOp = { kind: "leak", contractId };
  return client.submitOp(op);
}

/**
 * [Issue #709] PROVE: the relabelled grid, sixteen digits row by row. One op,
 * because the judge holds the solution and checks the whole grid -- there is
 * no challenge to wait for.
 */
export function submitProveSudoku(
  client: PortalCoordinationClient,
  contractId: string,
  grid: readonly number[],
): Promise<PortalCoordinationOutcome> {
  const op: CryptoBattleOp = { kind: "prove-sudoku", contractId, grid };
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

/**
 * [Issue #645 Phase 2] Builds and submits an FHE op — the ciphertext this team
 * computed by adding the Order's two input ciphertexts componentwise.
 */
export function submitFhe(
  client: PortalCoordinationClient,
  contractId: string,
  ciphertext: { readonly r: string; readonly y: string },
): Promise<PortalCoordinationOutcome> {
  const op: CryptoBattleOp = { kind: "fhe", contractId, ciphertext };
  return client.submitOp(op);
}

/**
 * [Issue #645 Phase 3] Builds and submits an MPC op — this office's masked
 * partial.
 */
export function submitMpc(
  client: PortalCoordinationClient,
  contractId: string,
  partial: string,
): Promise<PortalCoordinationOutcome> {
  const op: CryptoBattleOp = { kind: "mpc", contractId, partial };
  return client.submitOp(op);
}

/**
 * [Issue #659] Builds and submits a CIPHER op — the ciphertext this team
 * computed for a ladder Order.
 *
 * The answer is sent as the participant typed it, symbol by symbol. The reducer
 * accepts either the pictures or their numeric values and rejects everything
 * else (`parseAnswer`), so no normalising happens here: a portal that quietly
 * "fixed" an answer would be deciding what the team meant.
 */
export function submitCipher(
  client: PortalCoordinationClient,
  contractId: string,
  answer: readonly string[],
): Promise<PortalCoordinationOutcome> {
  const op: CryptoBattleOp = { kind: "cipher", contractId, answer };
  return client.submitOp(op);
}

/**
 * [Issue #659 §2] Builds and submits a ladder HUNT — the key recovered from a
 * target's published (plaintext, ciphertext) pairs.
 */
export function submitHuntCipher(
  client: PortalCoordinationClient,
  targetTeamId: string,
  generation: number,
  rung: CipherRung,
  recoveredKey: number,
): Promise<PortalCoordinationOutcome> {
  const op: CryptoBattleOp = { kind: "hunt-cipher", targetTeamId, generation, rung, recoveredKey };
  return client.submitOp(op);
}

/**
 * [Issue #709] Builds and submits a sudoku HUNT — the target's solution,
 * recovered from reveals that share a relabelling tag, lined up against the
 * target's public puzzle.
 */
export function submitHuntSudoku(
  client: PortalCoordinationClient,
  targetTeamId: string,
  generation: number,
  solution: readonly number[],
): Promise<PortalCoordinationOutcome> {
  const op: CryptoBattleOp = { kind: "hunt-sudoku", targetTeamId, generation, solution };
  return client.submitOp(op);
}

/**
 * [Issue #659 §9] Builds and submits a HINT op — open the next rung of this
 * Order's hint ladder and pay for it.
 *
 * Carries no level: the reducer opens the next unopened one (see
 * `CryptoBattleOp`'s `reveal-hint` arm), so the Portal never has to hold a
 * counter that could disagree with the state about which hint comes next.
 */
export function submitRevealHint(
  client: PortalCoordinationClient,
  contractId: string,
): Promise<PortalCoordinationOutcome> {
  const op: CryptoBattleOp = { kind: "reveal-hint", contractId };
  return client.submitOp(op);
}

/**
 * [Issue #688] Builds and submits a READY op — this team is ready, and the
 * match starts when every team has said so. Exported for direct testing.
 */
export function submitReady(client: PortalCoordinationClient): Promise<PortalCoordinationOutcome> {
  const op: CryptoBattleOp = { kind: "ready" };
  return client.submitOp(op);
}

/**
 * [Issue #677] Builds and submits a START op. Exported for direct testing --
 * see this file's header.
 */
export function submitStart(client: PortalCoordinationClient): Promise<PortalCoordinationOutcome> {
  const op: CryptoBattleOp = { kind: "start" };
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

/**
 * [Issue #709 review] The PROVE form's own outcome text. A wrong grid LANDS:
 * the judge returns ok, charges `wrongProve`, leaves the Order open and writes
 * `lastProve.outcome: "miss"` -- so "Submitted" would be true and useless.
 * Read off the projection the op came back with, the way the primary form's
 * `proveFeedback` does; anything that is not a landed PROVE on this Order
 * falls through to the shared three-way text.
 */
export function describeProveOutcome(
  outcome: PortalCoordinationOutcome,
  contractId: string,
  copy: Copy,
): string {
  const verdict = proveVerdict(outcome, contractId);
  if (verdict?.outcome === "miss") return copy.proveMissResult(verdict.cost);
  if (verdict?.outcome === "hit") return copy.proveHitResult;
  return describeOutcome(outcome, copy);
}

/** The landed PROVE verdict on `contractId` in an ok outcome, if there is one. */
function proveVerdict(
  outcome: PortalCoordinationOutcome,
  contractId: string,
): { readonly outcome: "hit" | "miss"; readonly cost: number } | undefined {
  if (outcome.kind !== "ok" || !isCryptoBattleProjection(outcome.projection)) return undefined;
  const last = outcome.projection.lastProve;
  if (last?.contractId !== contractId) return undefined;
  return { outcome: last.outcome, cost: outcome.projection.wrongProveCost };
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
                {c.id} ({c.kind}, {c.points}pt, {describeTaskShort(c.task)})
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
  generation,
  copy,
}: {
  readonly client: PortalCoordinationClient;
  readonly contracts: readonly ContractProjection[];
  readonly generation: number | undefined;
  readonly copy: Copy;
}) {
  const [contractId, setContractId] = useState("");
  const [gridText, setGridText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const selected = contractId || contracts[0]?.id || "";
  // [Issue #709 review] A typed grid belongs to the Order and generation it
  // was typed for. When the default Order completes, `selected` falls through
  // to the next open one, and a grid left behind would be one click from a
  // second PROVE under the same table; after a ROTATE it would be a charged
  // miss against the new solution. Same rule as the fast panel's grids.
  useEffect(() => {
    setGridText("");
    setParseError(null);
  }, [selected, generation]);

  const onSubmit = () => {
    // [Issue #709] Sixteen digits, whitespace ignored -- a participant who
    // copies four rows off paper types them with spaces between the rows.
    const digits = gridText.replace(/\s+/g, "");
    if (!/^[1-4]{16}$/.test(digits)) {
      setParseError(copy.gridError);
      return;
    }
    if (!selected || submitting) return;
    setParseError(null);
    setSubmitting(true);
    setResult(null);
    void submitProveSudoku(client, selected, [...digits].map(Number)).then((outcome) => {
      setResult(describeProveOutcome(outcome, selected, copy));
      // A hit spends that table; the box empties so it cannot be sent twice.
      if (proveVerdict(outcome, selected)?.outcome === "hit") setGridText("");
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
            aria-label="prove-grid"
            style={fieldStyle}
            placeholder={copy.gridLabel}
            value={gridText}
            onChange={(e) => setGridText(e.target.value)}
          />
          {parseError && <p style={errStyle}>{parseError}</p>}
          <button
            type="button"
            style={fieldStyle}
            onClick={onSubmit}
            disabled={submitting || !gridText.trim()}
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
  const leakContracts = contractsForMethod(openContracts, "leak");
  const proveContracts = contractsForMethod(openContracts, "prove");
  const myTeamId = projection?.vault.teamId;
  const teamIds = projection ? Object.keys(projection.teams) : [];
  const teams = projection?.teams ?? {};

  return (
    <section style={panelStyle}>
      <h3 style={{ margin: "0 0 4px 0", fontSize: "16px" }}>{copy.title}</h3>
      <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "#5f6b7a" }}>{copy.intro}</p>
      {!projection && <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "#5f6b7a" }}>{copy.loadingContracts}</p>}
      <div style={formsGridStyle}>
        <LeakForm client={coordinationClient} contracts={leakContracts} copy={copy} />
        <ProveForm client={coordinationClient} contracts={proveContracts} generation={projection?.vault.generation} copy={copy} />
        <HuntForm client={coordinationClient} teamIds={teamIds} myTeamId={myTeamId} teams={teams} copy={copy} />
        <RotateForm client={coordinationClient} copy={copy} />
      </div>
    </section>
  );
}
