/**
 * Issue #641: browser-local, non-scoring walkthrough for the Crypto Battle.
 *
 * This component never receives a coordination client, never reads the real
 * Vault, and never submits a move. Fixed tutorial-only values demonstrate the
 * observable consequences of LEAK / PROVE / HUNT / ROTATE in order.
 *
 * Issue #643: the HUNT step is now a HAND CALCULATION the participant performs
 * and types in — the Portal checks it and never fills it in.
 *
 * What #641 shipped let a reader press "HUNT with the 3 tutorial shares" and
 * watch a number appear. They saw THAT three shares reconstruct a secret; they
 * never did the reconstruction, so they had no reason to believe it, and
 * nothing carried over to the live match where they must actually compute one.
 * Playtest feedback was blunt about it: 小さい数字なら手計算でも作れるようにした方が
 * 原理を理解しやすい.
 *
 * Three deliberate choices make that hand calculation reachable for this
 * catalog's stated reader (AGENTS.md §12b: junior-high mathematics, one
 * beginner Python book):
 *
 *   1. A tiny field, p = 17, so every intermediate value is two digits.
 *   2. Share indices x = 1, 2, 3 — chosen, not incidental. At those three
 *      points the Lagrange coefficients at x = 0 come out as the WHOLE NUMBERS
 *      3, -3, 1, so the participant never needs a modular inverse. The general
 *      formula does; this instance does not, and that is the whole reason a
 *      pencil suffices.
 *   3. The recipe and a worked one-digit example are given up front. §12b:
 *      problems test applying a given procedure, never deriving it.
 *
 * The checker uses general Lagrange interpolation ({@link
 * reconstructTutorialSecret}), NOT the three whole numbers, so the shortcut we
 * teach is verified against the real math rather than against itself —
 * `onboarding.test.ts` pins that the two agree. The expected value therefore
 * exists in this bundle, as it must for any browser-local checker; what #643
 * requires, and what this file does, is never to DISPLAY or PRE-FILL it.
 */

import { useState } from "react";

type Locale = "ja" | "en";
export type TutorialStage = "ready" | "leaked" | "proved" | "hunted" | "rotated";

/** Why the last HUNT attempt did not advance. `null` = no attempt yet. */
export type TutorialAttempt = "wrong" | "malformed" | null;

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
  /** Set only once the participant's OWN typed answer has been checked. */
  readonly recoveredSecret?: string;
  readonly attempt: TutorialAttempt;
}

/**
 * The tutorial's field. 17 is small enough that `3 x 8 - 3 x 13 + 3` is a
 * pencil-and-paper subtraction, and prime, so the mathematics is the same
 * mathematics the live match runs over its 61-bit prime.
 */
export const TUTORIAL_PRIME = 17;
export const DOCUMENTED_THRESHOLD = 3;

/**
 * The opponent's three public shares, from f(x) = 5 + 2x + x^2 (mod 17):
 * f(1) = 8, f(2) = 13, f(3) = 3. The secret is f(0) — deliberately not named
 * anywhere in this file's participant-visible copy.
 */
export const TUTORIAL_OPPONENT_SHARES = [
  { index: 1, value: 8 },
  { index: 2, value: 13 },
  { index: 3, value: 3 },
] as const;

/**
 * The Lagrange coefficients at x = 0 for the indices 1, 2, 3 — the whole
 * numbers the participant is handed instead of a formula with a division in
 * it.
 *
 * They are not magic: L_i(0) = product over j != i of (0 - x_j) / (x_i - x_j),
 * which for (1, 2, 3) gives 6/2, 3/-1, 2/2. Every denominator divides its
 * numerator exactly, which is why no modular inverse appears. Change the
 * indices and that stops being true — `onboarding.test.ts` checks these
 * coefficients still reproduce {@link reconstructTutorialSecret}'s answer, so
 * a future edit to the share set cannot quietly leave the taught recipe wrong.
 */
export const TUTORIAL_LAGRANGE_COEFFICIENTS = [3, -3, 1] as const;

/**
 * The worked example the statement shows before asking for the real one, in
 * one-digit numbers (§12b). From f(x) = 1 + x^2 (mod 17): f(1) = 2, f(2) = 5,
 * f(3) = 10, and 3x2 - 3x5 + 10 = 1. A DIFFERENT answer from the tutorial's
 * own, so working the example through does not hand over the exercise.
 */
export const TUTORIAL_WORKED_EXAMPLE = {
  shares: [
    { index: 1, value: 2 },
    { index: 2, value: 5 },
    { index: 3, value: 10 },
  ],
  answer: 1,
} as const;

/**
 * The participant's own tutorial share, published by the LEAK step. From a
 * different polynomial than the opponent's, so nothing here is a step toward
 * the HUNT answer.
 */
const TUTORIAL_OWN_SHARE = { index: 1, value: 14 } as const;

/**
 * [Issue #709] The ZK sudoku PROVE, at the size the live match plays it.
 *
 * The live PROVE IS this: a 4x4 solution, a relabelling table, the relabelled
 * copy, one opened row. Nothing here is a scale model of something larger --
 * which is the point of the rebuild (#709): the toy and the real thing are the
 * same move. `onboarding.test.ts` verifies the worked example actually
 * relabels and that the opened row is a row of the copy, so the teaching
 * numbers cannot rot.
 */
export const TUTORIAL_TOY_SUDOKU = {
  /** A solution, row by row. */
  solution: [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1],
  /** The table: 1->3, 2->1, 3->4, 4->2. */
  table: [3, 1, 4, 2],
  /** The solution with every digit sent through the table. */
  relabelled: [3, 1, 4, 2, 4, 2, 3, 1, 1, 3, 2, 4, 2, 4, 1, 3],
  /** Which row the judge opens (0-based) and what everyone then sees. */
  openedRow: 1,
  opened: [4, 2, 3, 1],
} as const;

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

/**
 * General Lagrange interpolation at x=0 for the small tutorial field.
 *
 * Deliberately general — with a modular inverse — even though the tutorial's
 * own indices make one unnecessary. This is the CHECKER: verifying the
 * participant against the same procedure `shamir.ts` runs (rather than against
 * the three whole numbers we hand them) is what makes the shortcut trustworthy
 * instead of circular.
 */
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

/**
 * Issue #643: whether a typed answer is the reconstructed secret.
 *
 * Accepts only a plain non-negative integer already reduced into the field.
 * `-12` — the honest intermediate result before taking the remainder — is
 * rejected as `malformed` rather than silently normalised, because "reduce it
 * into 0..16" is precisely the step being taught, and quietly doing it for the
 * participant would remove it.
 */
export function checkTutorialHunt(answer: string): "correct" | "wrong" | "malformed" {
  const trimmed = answer.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return "malformed";
  const parsed = Number(trimmed);
  if (parsed >= TUTORIAL_PRIME) return "malformed";
  return parsed === reconstructTutorialSecret(TUTORIAL_OPPONENT_SHARES) ? "correct" : "wrong";
}

export function createTutorialState(): TutorialState {
  return {
    stage: "ready",
    score: 0,
    generation: 1,
    exposedShareIndices: [],
    ledger: [],
    attempt: null,
  };
}

/** What the participant did. HUNT is the only step that carries a value. */
export type TutorialAction = { readonly kind: "advance" } | { readonly kind: "hunt"; readonly answer: string };

/**
 * Pure teaching-state reducer, exported for tests.
 *
 * Issue #643: the `proved` -> `hunted` transition now requires a CORRECT typed
 * answer. A wrong or malformed one records the attempt and leaves the stage
 * where it was, so the participant retries rather than being walked past the
 * one step that carries the idea.
 */
export function advanceTutorial(
  state: TutorialState,
  action: TutorialAction = { kind: "advance" },
): TutorialState {
  switch (state.stage) {
    case "ready":
      return {
        ...state,
        stage: "leaked",
        score: 10,
        exposedShareIndices: [TUTORIAL_OWN_SHARE.index],
        ledger: [
          {
            id: "tutorial-contract-a-share-1",
            kind: "share",
            generation: 1,
            contractId: "tutorial-contract-a",
            shareIndex: TUTORIAL_OWN_SHARE.index,
            value: String(TUTORIAL_OWN_SHARE.value),
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
    case "proved": {
      // Only a checked answer moves this step. A bare "advance" — which is what
      // a button press with an empty box is — counts as an unfinished attempt.
      const verdict = action.kind === "hunt" ? checkTutorialHunt(action.answer) : "malformed";
      if (verdict !== "correct") return { ...state, attempt: verdict };
      return {
        ...state,
        stage: "hunted",
        score: 40,
        attempt: null,
        // The participant's own value, echoed back — not a number this
        // component computed for them.
        recoveredSecret: action.kind === "hunt" ? action.answer.trim() : undefined,
      };
    }
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
  readonly huntRecipe: string;
  readonly huntFormula: string;
  readonly huntNegative: string;
  readonly huntExample: string;
  readonly huntInputLabel: string;
  readonly huntWrong: string;
  readonly huntMalformed: string;
  readonly toyTitle: string;
  readonly toyIntro: string;
  readonly toySteps: readonly string[];
  readonly toyRealDifference: string;
  readonly toyNotSubmittable: string;
  readonly stages: Readonly<
    Record<TutorialStage, { readonly title: string; readonly body: string; readonly action: string }>
  >;
}

const EXAMPLE_SHARES = TUTORIAL_WORKED_EXAMPLE.shares
  .map((share) => `(${share.index}, ${share.value})`)
  .join(" ");

/** `1 2 3 4 / 3 4 1 2 / ...` -- a 16-cell grid as four rows. */
function rows(cells: readonly number[]): string {
  const out: string[] = [];
  for (let r = 0; r < 4; r += 1) out.push(cells.slice(r * 4, r * 4 + 4).join(" "));
  return out.join(" / ");
}

const COPY: Record<Locale, TutorialCopy> = {
  en: {
    title: "Guided rules walkthrough (no score, no match changes)",
    intro:
      "Fixed tutorial values run only in this browser. Your live secret, Contracts, ledger, and score are untouched.",
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
    recovered: "The secret you recovered",
    huntRecipe: `Work it out yourself. Every number below is small enough for paper — no code needed. "Remainder after dividing by ${TUTORIAL_PRIME}" is written mod ${TUTORIAL_PRIME} from here on.`,
    huntFormula: `secret = (3 x first share - 3 x second share + 1 x third share), then the remainder after dividing by ${TUTORIAL_PRIME}`,
    huntNegative: `If the subtraction goes below zero, add ${TUTORIAL_PRIME} until the result sits between 0 and ${TUTORIAL_PRIME - 1}.`,
    huntExample: `Worked example — shares ${EXAMPLE_SHARES}: 3x${TUTORIAL_WORKED_EXAMPLE.shares[0].value} - 3x${TUTORIAL_WORKED_EXAMPLE.shares[1].value} + ${TUTORIAL_WORKED_EXAMPLE.shares[2].value} = ${TUTORIAL_WORKED_EXAMPLE.answer}. (Different shares from the ones above, so this is not the answer.)`,
    huntInputLabel: `Recovered secret (0 to ${TUTORIAL_PRIME - 1})`,
    huntWrong: "Not that value. Check the subtraction, then try again.",
    huntMalformed: `Enter one whole number between 0 and ${TUTORIAL_PRIME - 1}. A negative intermediate result still needs its remainder taken.`,
    toyTitle: "Optional: PROVE on paper",
    toyIntro:
      "The live PROVE is exactly this, with your own grid. A 4x4 sudoku: every row, column and 2x2 box holds 1-4 once each.",
    toySteps: [
      `Your solution (private): ${rows(TUTORIAL_TOY_SUDOKU.solution)}. Eight of its cells are public as your puzzle.`,
      `Pick a table: 1→${TUTORIAL_TOY_SUDOKU.table[0]}, 2→${TUTORIAL_TOY_SUDOKU.table[1]}, 3→${TUTORIAL_TOY_SUDOKU.table[2]}, 4→${TUTORIAL_TOY_SUDOKU.table[3]}. Each of 1-4 appears once on the right: it swaps digits, it never merges two into one.`,
      `Rewrite every cell through it: ${rows(TUTORIAL_TOY_SUDOKU.relabelled)}. Still a valid sudoku — relabelling cannot break a row, column or box.`,
      `Submit the copy. The judge checks it is your solution relabelled, then opens ONE row: row ${TUTORIAL_TOY_SUDOKU.openedRow + 1} reads ${TUTORIAL_TOY_SUDOKU.opened.join(" ")}.`,
      "Everyone else sees 1-4 in some order and a tag naming your table. They learn nothing about which digit sits where. Use a DIFFERENT table next time: two opened groups under one table line up against your puzzle and give the table away.",
    ],
    toyRealDifference:
      "The real ZK sudoku commits every cell first and opens one group per challenge; here the judge already holds your solution, so it checks the whole copy in one step and opens one group of it. Same idea, one move.",
    toyNotSubmittable:
      "These toy values cannot be submitted to a real Contract: the judge checks against YOUR solution, in MY VAULT.",
    stages: {
      ready: {
        title: "Step 1 of 4 — LEAK Contract A",
        body: `Publish share index ${TUTORIAL_OWN_SHARE.index}. You gain 10 tutorial points, and that share remains public.`,
        action: "LEAK tutorial Contract A",
      },
      leaked: {
        title: "Step 2 of 4 — PROVE a different Contract B",
        body: "Relabel your sudoku and publish the copy instead. One row of the copy goes public; the score rises, but the exposed share-index count stays at one.",
        action: "PROVE tutorial Contract B",
      },
      proved: {
        title: "Step 3 of 4 — HUNT the tutorial opponent",
        body: `The opponent has published ${DOCUMENTED_THRESHOLD} shares of one generation. That is enough to rebuild their secret — do it, and type what you get.`,
        action: "Submit my answer",
      },
      hunted: {
        title: "Step 4 of 4 — ROTATE",
        body: "Move to generation 2. The old share remains visible for audit but is not a share of the new secret.",
        action: "ROTATE to generation 2",
      },
      rotated: {
        title: "Walkthrough complete",
        body: "You saw the core loop: choose LEAK or PROVE, inspect public artifacts, HUNT a generation, then ROTATE. Some Orders take neither LEAK nor PROVE — they hand you numbers you are not allowed to read and ask you to compute on them anyway (FHE and MPC). The card names the method each Order accepts, and \"How this Battle works\" describes both.",
        action: "Run it again",
      },
    },
  },
  ja: {
    title: "ルールを順番に体験する（無得点・本番に影響なし）",
    intro:
      "固定された練習用データだけをブラウザ内で動かします。本物の secret、Contract、Ledger、得点には触れません。",
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
    recovered: "あなたが復元した secret",
    huntRecipe: `自分で計算します。下の数はすべて紙で足りる大きさで、プログラムは要りません。以降、「${TUTORIAL_PRIME} で割った余り」を mod ${TUTORIAL_PRIME} と書きます。`,
    huntFormula: `secret = (3 × 1枚目 − 3 × 2枚目 + 1 × 3枚目) を ${TUTORIAL_PRIME} で割った余り`,
    huntNegative: `引き算の結果がマイナスになったら、0 以上 ${TUTORIAL_PRIME - 1} 以下になるまで ${TUTORIAL_PRIME} を足します。`,
    huntExample: `例題 — share が ${EXAMPLE_SHARES} のとき: 3×${TUTORIAL_WORKED_EXAMPLE.shares[0].value} − 3×${TUTORIAL_WORKED_EXAMPLE.shares[1].value} + ${TUTORIAL_WORKED_EXAMPLE.shares[2].value} = ${TUTORIAL_WORKED_EXAMPLE.answer}。（上の share とは別の数なので、これは答えではありません。）`,
    huntInputLabel: `復元した secret（0 〜 ${TUTORIAL_PRIME - 1}）`,
    huntWrong: "その値ではありません。引き算を見直してもう一度どうぞ。",
    huntMalformed: `0 〜 ${TUTORIAL_PRIME - 1} の整数を1つ入力してください。途中がマイナスになった場合も、余りを取ってから入力します。`,
    toyTitle: "任意: PROVE を紙で追う",
    toyIntro:
      "本番の PROVE はまさにこれを、自分のマス目で行います。4×4 の数独: どの行・列・2×2 の箱にも 1〜4 が 1 回ずつ入ります。",
    toySteps: [
      `自分の解 (非公開): ${rows(TUTORIAL_TOY_SUDOKU.solution)}。このうち 8 マスが「問題」として公開されています。`,
      `表を 1 つ決めます: 1→${TUTORIAL_TOY_SUDOKU.table[0]}、2→${TUTORIAL_TOY_SUDOKU.table[1]}、3→${TUTORIAL_TOY_SUDOKU.table[2]}、4→${TUTORIAL_TOY_SUDOKU.table[3]}。右側には 1〜4 が 1 回ずつ現れます。数字を入れ替えるだけで、2 つを 1 つにまとめることはありません。`,
      `全マスをその表で書き換えます: ${rows(TUTORIAL_TOY_SUDOKU.relabelled)}。これも正しい数独です ── 付け替えで行・列・箱は崩れません。`,
      `写しを出します。審判は「自分の解の付け替え」であることを検査し、1 行だけ開きます: ${TUTORIAL_TOY_SUDOKU.openedRow + 1} 行目は ${TUTORIAL_TOY_SUDOKU.opened.join(" ")}。`,
      "相手には「1〜4 の並び替え」と、表を名指すタグしか見えません。どのマスに何があったかは分かりません。次は別の表を使ってください。同じ表で開いた 2 グループは、公開問題と突き合わせると表が割れます。",
    ],
    toyRealDifference:
      "本物の ZK 数独は全マスを先に封じてから、質問ごとに 1 グループ開きます。ここでは審判があなたの解を持っているので、写し全体を 1 手で検査してから 1 グループ開きます。考え方は同じで、手数が 1 手です。",
    toyNotSubmittable:
      "この練習用の値は実際の Contract には提出できません。審判は MY VAULT にある「あなたの解」と照らし合わせます。",
    stages: {
      ready: {
        title: "1 / 4 — Contract A を LEAK",
        body: `share index ${TUTORIAL_OWN_SHARE.index} を公開します。練習スコアは10点増え、その share は公開記録に残ります。`,
        action: "練習用 Contract A を LEAK",
      },
      leaked: {
        title: "2 / 4 — 別の Contract B を PROVE",
        body: "代わりに数独を付け替えて写しを出します。写しの 1 行が公開されますが、得点は増え、公開済み share index は1種類のままです。",
        action: "練習用 Contract B を PROVE",
      },
      proved: {
        title: "3 / 4 — 練習相手を HUNT",
        body: `相手は同じ世代の share を${DOCUMENTED_THRESHOLD}枚公開しています。これで secret を組み立て直せます。実際に計算して、出た数を入力してください。`,
        action: "答えを送る",
      },
      hunted: {
        title: "4 / 4 — ROTATE",
        body: "世代2へ切り替えます。古い share は監査用に残りますが、新しい secret の share ではありません。",
        action: "世代2へ ROTATE",
      },
      rotated: {
        title: "チュートリアル完了",
        body: "LEAK / PROVE の二択、公開情報の確認、相手への HUNT、自分の ROTATE という基本の一周を確認しました。依頼にはこの二択のどちらでもないものもあります — 読んではいけない数字を渡され、そのまま計算することを求められる依頼です（FHE と MPC）。使える方法は各カードに書いてあり、「この Battle の遊び方」で両方を説明しています。",
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
const statStyle = {
  border: "1px solid #eaeded",
  borderRadius: "6px",
  padding: "8px",
  fontSize: "12px",
} as const;
const cellStyle = { padding: "4px 6px", borderBottom: "1px solid #eaeded", textAlign: "left" as const };
const formulaStyle = {
  fontFamily: "monospace",
  fontSize: "12px",
  background: "#fffdf3",
  border: "1px solid #f0e3b8",
  borderRadius: "4px",
  padding: "6px 8px",
  margin: "6px 0",
} as const;
const errorStyle = { margin: "6px 0 0", fontSize: "12px", color: "#8a2b2b" } as const;

/**
 * Issue #643: the HUNT step's worksheet — recipe, worked example, input box.
 *
 * Everything a participant needs to compute the answer is on screen; the answer
 * itself is not, and the box starts empty. §12b: the needed procedure is given,
 * and the difficulty lives in doing the work rather than in guessing what the
 * work is.
 */
function HuntWorksheet(props: {
  readonly copy: TutorialCopy;
  readonly attempt: TutorialAttempt;
  readonly onSubmit: (answer: string) => void;
  readonly actionLabel: string;
}) {
  const { copy, attempt } = props;
  const [answer, setAnswer] = useState("");

  return (
    <div style={{ marginTop: "8px" }}>
      <p style={{ margin: "0 0 4px", fontSize: "12px" }}>{copy.huntRecipe}</p>
      <p style={formulaStyle}>{copy.huntFormula}</p>
      <p style={{ margin: "0 0 4px", fontSize: "12px" }}>{copy.huntNegative}</p>
      <p style={{ margin: "0 0 8px", fontSize: "12px", color: "#5f6b7a" }}>{copy.huntExample}</p>
      <label style={{ display: "block", fontSize: "12px", marginBottom: "4px" }}>
        {copy.huntInputLabel}
        <input
          type="text"
          inputMode="numeric"
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          style={{ marginLeft: "6px", width: "5em", fontSize: "12px", padding: "3px 6px" }}
        />
      </label>
      <button type="button" style={actionStyle} onClick={() => props.onSubmit(answer)}>
        {props.actionLabel}
      </button>
      {attempt !== null && (
        <p style={errorStyle} role="alert">
          {attempt === "wrong" ? copy.huntWrong : copy.huntMalformed}
        </p>
      )}
    </div>
  );
}

/**
 * Issue #643: the paper-sized PROVE, kept behind a closed `<details>`.
 *
 * Progressive disclosure on purpose — it is the "why does PROVE work" detour,
 * not part of the four-step loop, and the playtest complaint that started #643
 * was about how much text sits between a reader and their first move.
 * [Issue #709] The detour is the live move itself now: a 4x4 relabelling.
 */
function ToySudoku({ copy }: { readonly copy: TutorialCopy }) {
  return (
    <details style={{ marginTop: "10px", fontSize: "12px" }}>
      <summary style={{ cursor: "pointer" }}>{copy.toyTitle}</summary>
      <p style={{ margin: "6px 0" }}>{copy.toyIntro}</p>
      <ol style={{ margin: "0 0 6px", paddingLeft: "1.2em" }}>
        {copy.toySteps.map((step) => (
          <li key={step} style={{ marginBottom: "3px" }}>
            {step}
          </li>
        ))}
      </ol>
      <p style={{ margin: "6px 0" }}>{copy.toyRealDifference}</p>
      <p style={{ margin: 0, color: "#8a2b2b" }}>{copy.toyNotSubmittable}</p>
    </details>
  );
}

export default function TutorialWalkthrough({ locale }: { readonly locale: Locale }) {
  const copy = COPY[locale];
  const [state, setState] = useState<TutorialState>(() => createTutorialState());
  const [visible, setVisible] = useState(false);
  const stage = copy.stages[state.stage];
  const showOpponent = state.stage === "proved" || state.stage === "hunted" || state.stage === "rotated";
  const isHuntStep = state.stage === "proved";

  if (!visible) {
    return (
      <div style={cardStyle}>
        <strong>{copy.title}</strong>
        <p style={{ margin: "4px 0 8px", fontSize: "12px", color: "#5f6b7a" }}>{copy.intro}</p>
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

        {/*
          The opponent's shares sit ABOVE the worksheet at the HUNT step, so the
          numbers and the recipe that consumes them read in one pass.
        */}
        {isHuntStep && (
          <p style={{ margin: "0 0 4px", fontFamily: "monospace", fontSize: "12px" }}>
            {TUTORIAL_OPPONENT_SHARES.map((share) => `share[${share.index}]=${share.value}`).join(" / ")}
          </p>
        )}

        {isHuntStep ? (
          <HuntWorksheet
            copy={copy}
            attempt={state.attempt}
            actionLabel={stage.action}
            onSubmit={(answer) =>
              setState((current) => advanceTutorial(current, { kind: "hunt", answer }))
            }
          />
        ) : (
          <button type="button" style={actionStyle} onClick={() => setState((current) => advanceTutorial(current))}>
            {stage.action}
          </button>
        )}

        {state.stage !== "ready" && state.stage !== "rotated" && (
          <button
            type="button"
            style={{ ...actionStyle, marginLeft: isHuntStep ? 0 : "6px", marginTop: isHuntStep ? "6px" : 0 }}
            onClick={() => setState(createTutorialState())}
          >
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

      {showOpponent && !isHuntStep && (
        <p style={{ margin: "10px 0 0", fontFamily: "monospace", fontSize: "12px" }}>
          <strong>{copy.opponent}:</strong>{" "}
          {TUTORIAL_OPPONENT_SHARES.map((share) => `share[${share.index}]=${share.value}`).join(" / ")}
        </p>
      )}

      <ToySudoku copy={copy} />

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
                    {entry.kind === "share" ? `share[${entry.shareIndex}]=${entry.value}` : "one opened row of a relabelled sudoku"}
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
