/**
 * Issue #641: browser-local, non-scoring walkthrough for the Crypto Battle.
 *
 * This component never receives a coordination client, never reads the real
 * Vault, and never submits a move. Fixed tutorial-only values demonstrate the
 * observable consequences of LEAK / PROVE / HUNT / ROTATE in order.
 */

import { useState } from "react";

type Locale = "ja" | "en";
export type TutorialStage = "ready" | "leaked" | "proved" | "hunted" | "rotated";

export interface TutorialLedgerEntry {
  readonly id: string;
  readonly kind: "share" | "proof";
  readonly generation: number;
  readonly contractId: string;
  readonly shareIndex?: number;
  readonly value?: string;
}

export interface TutorialState {
  readonly stage: TutorialStage;
  readonly score: number;
  readonly generation: number;
  readonly exposedShareIndices: readonly number[];
  readonly ledger: readonly TutorialLedgerEntry[];
  readonly recoveredSecret?: string;
}

const TUTORIAL_PRIME = 101;
export const DOCUMENTED_THRESHOLD = 3;

/** Points from f(x) = 73 + 5x + 2x² (mod 101), so f(0) = 73. */
export const TUTORIAL_OPPONENT_SHARES = [
  { index: 1, value: 80 },
  { index: 2, value: 91 },
  { index: 3, value: 5 },
] as const;

function mod(value: number, prime: number): number {
  const reduced = value % prime;
  return reduced < 0 ? reduced + prime : reduced;
}

function modPow(base: number, exponent: number, prime: number): number {
  let result = 1;
  let factor = mod(base, prime);
  let remaining = exponent;
  while (remaining > 0) {
    if (remaining % 2 === 1) result = mod(result * factor, prime);
    factor = mod(factor * factor, prime);
    remaining = Math.floor(remaining / 2);
  }
  return result;
}

/** Lagrange interpolation at x=0 for the small tutorial field. */
export function reconstructTutorialSecret(
  shares: readonly { readonly index: number; readonly value: number }[],
): number {
  if (shares.length === 0) throw new RangeError("tutorial reconstruction needs at least one share");
  if (new Set(shares.map((share) => share.index)).size !== shares.length) {
    throw new RangeError("tutorial reconstruction requires distinct share indices");
  }

  let total = 0;
  for (const current of shares) {
    let numerator = 1;
    let denominator = 1;
    for (const other of shares) {
      if (other.index === current.index) continue;
      numerator = mod(numerator * -other.index, TUTORIAL_PRIME);
      denominator = mod(denominator * (current.index - other.index), TUTORIAL_PRIME);
    }
    const inverse = modPow(denominator, TUTORIAL_PRIME - 2, TUTORIAL_PRIME);
    total = mod(total + current.value * numerator * inverse, TUTORIAL_PRIME);
  }
  return total;
}

export function createTutorialState(): TutorialState {
  return {
    stage: "ready",
    score: 0,
    generation: 1,
    exposedShareIndices: [],
    ledger: [],
  };
}

/** Pure teaching-state reducer, exported for tests. */
export function advanceTutorial(state: TutorialState): TutorialState {
  switch (state.stage) {
    case "ready":
      return {
        ...state,
        stage: "leaked",
        score: 10,
        exposedShareIndices: [1],
        ledger: [
          {
            id: "tutorial-contract-a-share-1",
            kind: "share",
            generation: 1,
            contractId: "tutorial-contract-a",
            shareIndex: 1,
            value: "44",
          },
        ],
      };
    case "leaked":
      return {
        ...state,
        stage: "proved",
        score: 20,
        ledger: [
          ...state.ledger,
          {
            id: "tutorial-contract-b-proof",
            kind: "proof",
            generation: 1,
            contractId: "tutorial-contract-b",
          },
        ],
      };
    case "proved":
      return {
        ...state,
        stage: "hunted",
        score: 40,
        recoveredSecret: String(reconstructTutorialSecret(TUTORIAL_OPPONENT_SHARES)),
      };
    case "hunted":
      return {
        ...state,
        stage: "rotated",
        generation: 2,
        exposedShareIndices: [],
      };
    case "rotated":
      return createTutorialState();
    default: {
      const exhaustive: never = state.stage;
      return exhaustive;
    }
  }
}

interface TutorialCopy {
  readonly title: string;
  readonly intro: string;
  readonly skip: string;
  readonly show: string;
  readonly reset: string;
  readonly score: string;
  readonly generation: string;
  readonly exposure: string;
  readonly none: string;
  readonly ledger: string;
  readonly ledgerEmpty: string;
  readonly opponent: string;
  readonly recovered: string;
  readonly stages: Readonly<Record<TutorialStage, { readonly title: string; readonly body: string; readonly action: string }>>;
}

const COPY: Record<Locale, TutorialCopy> = {
  en: {
    title: "Guided rules walkthrough (no score, no match changes)",
    intro: "Fixed tutorial values run only in this browser. Your live secret, Contracts, ledger, and score are untouched.",
    skip: "Skip for now",
    show: "Show the walkthrough",
    reset: "Start over",
    score: "Tutorial score",
    generation: "Current generation",
    exposure: "Current-generation exposed indices",
    none: "none",
    ledger: "Tutorial ledger",
    ledgerEmpty: "No tutorial entries yet.",
    opponent: "Tutorial opponent, generation 1",
    recovered: "Recovered tutorial secret",
    stages: {
      ready: {
        title: "Step 1 of 4 — LEAK Contract A",
        body: "Publish share index 1. You gain 10 tutorial points, and that share remains public.",
        action: "LEAK tutorial Contract A",
      },
      leaked: {
        title: "Step 2 of 4 — PROVE a different Contract B",
        body: "Publish a proof transcript instead. The score rises, but the exposed share-index count stays at one.",
        action: "PROVE tutorial Contract B",
      },
      proved: {
        title: "Step 3 of 4 — HUNT the tutorial opponent",
        body: `The opponent exposed ${DOCUMENTED_THRESHOLD} distinct indices from one generation. Interpolate those points at x=0.`,
        action: "HUNT with the 3 tutorial shares",
      },
      hunted: {
        title: "Step 4 of 4 — ROTATE",
        body: "Move to generation 2. The old share remains visible for audit but is not a share of the new secret.",
        action: "ROTATE to generation 2",
      },
      rotated: {
        title: "Walkthrough complete",
        body: "You saw the full loop: choose LEAK or PROVE, inspect public artifacts, HUNT a generation, then ROTATE.",
        action: "Run it again",
      },
    },
  },
  ja: {
    title: "ルールを順番に体験する（無得点・本番に影響なし）",
    intro: "固定された練習用データだけをブラウザ内で動かします。本物の secret、Contract、Ledger、得点には触れません。",
    skip: "今はスキップ",
    show: "チュートリアルを表示",
    reset: "最初からやり直す",
    score: "練習スコア",
    generation: "現在の世代",
    exposure: "現行世代で公開済みの index",
    none: "なし",
    ledger: "練習用 Ledger",
    ledgerEmpty: "まだ練習用の記録はありません。",
    opponent: "練習相手、世代1",
    recovered: "復元した練習用 secret",
    stages: {
      ready: {
        title: "1 / 4 — Contract A を LEAK",
        body: "share index 1 を公開します。練習スコアは10点増え、その share は公開記録に残ります。",
        action: "練習用 Contract A を LEAK",
      },
      leaked: {
        title: "2 / 4 — 別の Contract B を PROVE",
        body: "代わりに proof transcript を公開します。得点は増えますが、公開済み share index は1種類のままです。",
        action: "練習用 Contract B を PROVE",
      },
      proved: {
        title: "3 / 4 — 練習相手を HUNT",
        body: `相手は同じ世代の異なる index を${DOCUMENTED_THRESHOLD}種類公開しています。この${DOCUMENTED_THRESHOLD}点を x=0 で補間します。`,
        action: "3つの練習用 share で HUNT",
      },
      hunted: {
        title: "4 / 4 — ROTATE",
        body: "世代2へ切り替えます。古い share は監査用に残りますが、新しい secret の share ではありません。",
        action: "世代2へ ROTATE",
      },
      rotated: {
        title: "チュートリアル完了",
        body: "LEAK / PROVE の二択、公開情報の確認、相手への HUNT、自分の ROTATE という一周を確認しました。",
        action: "もう一度実行",
      },
    },
  },
};

const cardStyle = {
  border: "1px solid #b6d7f2",
  borderRadius: "8px",
  padding: "12px",
  marginBottom: "12px",
  background: "#fff",
} as const;
const actionStyle = { padding: "6px 10px", fontSize: "12px", cursor: "pointer" } as const;
const statsStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: "8px",
  marginTop: "10px",
} as const;
const statStyle = { border: "1px solid #eaeded", borderRadius: "6px", padding: "8px", fontSize: "12px" } as const;
const cellStyle = { padding: "4px 6px", borderBottom: "1px solid #eaeded", textAlign: "left" as const };

export default function TutorialWalkthrough({ locale }: { readonly locale: Locale }) {
  const copy = COPY[locale];
  const [state, setState] = useState<TutorialState>(() => createTutorialState());
  const [visible, setVisible] = useState(true);
  const stage = copy.stages[state.stage];
  const showOpponent = state.stage === "proved" || state.stage === "hunted" || state.stage === "rotated";

  if (!visible) {
    return (
      <div style={cardStyle}>
        <button type="button" style={actionStyle} onClick={() => setVisible(true)}>
          {copy.show}
        </button>
      </div>
    );
  }

  return (
    <section style={cardStyle} aria-label="crypto-battle-tutorial">
      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
        <div>
          <strong>{copy.title}</strong>
          <p style={{ margin: "4px 0", fontSize: "12px", color: "#5f6b7a" }}>{copy.intro}</p>
        </div>
        <button type="button" style={actionStyle} onClick={() => setVisible(false)}>
          {copy.skip}
        </button>
      </div>

      <div style={{ border: "1px solid #b6d7f2", borderRadius: "6px", padding: "10px", background: "#f1f8ff" }}>
        <strong>{stage.title}</strong>
        <p style={{ margin: "4px 0 8px", fontSize: "13px" }}>{stage.body}</p>
        <button type="button" style={actionStyle} onClick={() => setState((current) => advanceTutorial(current))}>
          {stage.action}
        </button>
        {state.stage !== "ready" && state.stage !== "rotated" && (
          <button type="button" style={{ ...actionStyle, marginLeft: "6px" }} onClick={() => setState(createTutorialState())}>
            {copy.reset}
          </button>
        )}
      </div>

      <div style={statsStyle}>
        <div style={statStyle}>
          <strong>{copy.score}</strong>
          <div>{state.score} pt</div>
        </div>
        <div style={statStyle}>
          <strong>{copy.generation}</strong>
          <div>{state.generation}</div>
        </div>
        <div style={statStyle}>
          <strong>{copy.exposure}</strong>
          <div>{state.exposedShareIndices.length > 0 ? state.exposedShareIndices.join(", ") : copy.none}</div>
        </div>
        {state.recoveredSecret && (
          <div style={statStyle}>
            <strong>{copy.recovered}</strong>
            <div>{state.recoveredSecret}</div>
          </div>
        )}
      </div>

      {showOpponent && (
        <p style={{ margin: "10px 0 0", fontFamily: "monospace", fontSize: "12px" }}>
          <strong>{copy.opponent}:</strong>{" "}
          {TUTORIAL_OPPONENT_SHARES.map((share) => `share[${share.index}]=${share.value}`).join(" / ")}
        </p>
      )}

      <div style={{ marginTop: "10px" }}>
        <strong style={{ fontSize: "12px" }}>{copy.ledger}</strong>
        {state.ledger.length === 0 ? (
          <p style={{ margin: "4px 0 0", fontSize: "12px" }}>{copy.ledgerEmpty}</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
            <thead>
              <tr>
                <th style={cellStyle}>move</th>
                <th style={cellStyle}>contract</th>
                <th style={cellStyle}>generation</th>
                <th style={cellStyle}>public detail</th>
              </tr>
            </thead>
            <tbody>
              {state.ledger.map((entry) => (
                <tr key={entry.id}>
                  <td style={cellStyle}>{entry.kind === "share" ? "LEAK" : "PROVE"}</td>
                  <td style={cellStyle}>{entry.contractId}</td>
                  <td style={cellStyle}>{entry.generation}</td>
                  <td style={{ ...cellStyle, fontFamily: "monospace" }}>
                    {entry.kind === "share" ? `share[${entry.shareIndex}]=${entry.value}` : "{ commitment, response }"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
