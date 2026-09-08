import EvolutionWorksheet from "./EvolutionWorksheet.tsx";
import MathText from "./MathText.tsx";
import {AnamorphicWorksheet} from "./AnamorphicWorksheet.tsx";
import {StarkWorksheet} from "./StarkWorksheet.tsx";
import {IoWorksheet} from "./IoWorksheet.tsx";
import {orderReward} from "./orderReward.ts";
import {SnarkWorksheet} from "./SnarkWorksheet.tsx";
import {EcWorksheet} from "./EcWorksheet.tsx";
import { BreachNotice } from "./BreachNotice.tsx";
import { SchnorrProof } from "./SchnorrProof.tsx";
import { power } from "../game/src/schnorr.ts";
import { chooseProveTable } from "./prove-table.ts";
import RotorMaterials from "./RotorMaterials.tsx";
import RsaMaterials from "./RsaMaterials.tsx";
import Lightning from "./Lightning.tsx";
import VigenereMaterials from "./VigenereMaterials.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PortalCoordinationClient, PortalCoordinationOutcome, PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import { isCryptoBattleProjection, usePolledProjection } from "./coordination.ts";
import {
  submitCipher,
  submitDeclareLightning,
  submitFhe,
  submitLeak,
  submitMpc,
  submitProveSudoku,
  submitRevealHint,
  submitReady,
  submitRotate,
  submitStart,
} from "./RegistrationPanelCore.tsx";
import ConceptExplanation from "./ConceptExplanation.tsx";
import { RpsHuntStatus, RpsOrderPrediction } from "./RpsHunt.tsx";
import RpsDuel, { RpsResult, rpsRejection } from "./RpsDuel.tsx";
import MpcMaskDiagram from "./MpcMaskDiagram.tsx";
import MpcWorksheet from "./MpcWorksheet.tsx";
import HuntPanel from "./HuntPanel.tsx";
import HintBooster, { ageHintBooster } from "./HintBooster.tsx";
import { HUNT_GUIDE_CSS } from "./HuntGuide.tsx";
import { ledgerTargets, cipherHuntCandidates, sudokuHuntCandidates } from "./hunt-targets.ts";
export type { CipherHuntCandidate, SudokuHuntCandidate } from "./hunt-targets.ts";
export { huntBudgetFor, cipherHuntCandidates, sudokuHuntCandidates } from "./hunt-targets.ts";
import SudokuGuide, { RelabelDiagram, GUIDE_CSS } from "./SudokuGuide.tsx";
import SuccessCelebration, { SUCCESS_CSS } from "./SuccessCelebration.tsx";
import { taskDetail } from "./orderTask.ts";
import OrderQueue, { type OrderReceipt } from "./OrderQueue.tsx";
import { disclosurePreview, orderHeading } from "./OrderFocus.tsx";
import { DIE_CSS, DieFace, DieRow } from "./DieFace.tsx";
import { BOARD_CSS, MatchRecords } from "./GameBoard.tsx";
import {
  describeRevealGroup,
  emptyCells,
  parseCells,
  PermutationChips,
  SudokuBoard,
  SudokuInput,
  sudokuFillInGivens,
  SUDOKU_CSS,
} from "./SudokuGrid.tsx";
import { rungSpec } from "../game/src/ladder.ts";
import { ALL_PERMUTATIONS } from "../game/src/sudoku.ts";
import type {
  ContractProjection,
  SudokuRevealArtifact,
  CryptoBattleProjection,
  HintProjection,
} from "../game/src/types.ts";

type Locale = "ja" | "en";
type FeedbackKind = "ec" | "leak" | "prove" | "hunt" | "rotate" | "hint" | "error";

/**
 * [Issue #697] A banner before it is stamped with the submission it belongs to.
 * Every call site describes WHAT happened; `run` decides which attempt it was,
 * so no caller can forget to bump the counter and leave a repeat silent.
 */
export type FeedbackDraft = Omit<Feedback, "attempt">;

export interface Feedback {
  readonly kind: FeedbackKind;
  readonly title: string;
  readonly body: string;
  /**
   * [Issue #697] Which submission produced this, counting from 1.
   *
   * React reuses the DOM node when the rendered banner is identical, so
   * resubmitting a wrong answer and getting the same rejection replayed no
   * animation and changed no pixel -- the live run reported it as
   * 「提出しているのに反応がないからわからん」, and a player who cannot tell
   * "rejected again" from "nothing happened" stops being able to iterate. Used
   * as the banner's React key (so the node remounts and the pop replays) and
   * shown on the banner from the second attempt onward.
   */
  readonly attempt: number;
  readonly reward?: number;
  readonly total?: number;
  /**
   * [Issue #659] What the participant just DID, named.
   *
   * The point of this Battle is that a player leaves understanding secure
   * computation, homomorphic encryption and zero-knowledge proofs — the
   * primitives blockchains are built on. They already perform all three: an FHE
   * Order is homomorphic addition, an MPC Order is secure multi-party
   * computation, a PROVE is a zero-knowledge proof.
   *
   * They were never told. Before this, the words 準同型暗号 / 秘密計算 /
   * ゼロ知識証明 appeared ZERO times anywhere a participant could see, and the
   * only mention of blockchain was a disclaimer saying a Contract is NOT one.
   * A player finished the match having done all three and could not have named
   * any of them.
   *
   * So the name arrives at the moment the move succeeds, which is when it
   * attaches to something the player actually did rather than to a definition
   * they read first. One sentence: what it is called, and where it is used.
   */
  readonly lesson?: string;
}

/** Exported for `game/src/portal.test.ts` — the copy IS the teaching here. */
export const FAST_MOVE_COPY = {
  en: {
    title: "MAKE A MOVE",
    selectOrder: "1. PICK AN ORDER",
    noOrder: "No Order is open right now.",
    choose: "Choose how to answer",
    /*
      [Issue #702] Free, and on the card rather than behind a hint. The live run
      bought all three hint levels on this Order (-14) and came back with
      「Share ってそもそもなに？」 -- the ladder explains WHICH BUTTON TO PRESS
      and never once says what the noun means. Charging points to learn the
      vocabulary is the wrong trade, and a player who does not have the noun
      cannot use the strategy the hints are selling.
    */
    shareWhat: "A share is one of the 5 pieces your secret was split into — #1 to #5 in MY VAULT.",
    shareDo: (indices: readonly number[]) =>
      `This Order asks for ${indices.map((i) => `#${i}`).join(", ")}. LEAK hands it over and completes the Order in one press — no calculation. PROVE answers without handing it over.`,
    leak: "LEAK",
    leakHint: "One press · no calculation",
    prove: "PROVE",
    proveHint: "Choose a table · fill four cells",
    proveOpen: "Relabel and submit",
    constraintNone: "any method",
    constraintNoRaw: (methods: readonly string[]) =>
      `${methods.join(" / ").toUpperCase()} only — the raw value must not be published`,
    /*
      [Issue #659] One message per method, not one message reused.
      
      There was a single string naming LEAK, and it was shown whenever EITHER
      button was unavailable — so a ladder Order, which accepts LEAK and refuses
      PROVE, told the reader that LEAK was refused while the LEAK button sat
      right there enabled. A hint that contradicts the button beside it is worse
      than none.
    */
    scoreLabel: "SCORE",
    scoreHint: "Unanswered at deadline → lose points",
    leakBlocked: "This Order does not accept LEAK.",
    proveBlocked: "This Order does not accept PROVE.",
    hunt: "HUNT FROM LEDGER",
    /*
      [Issue #696] The price of a miss is on the card BEFORE the attempt, in the
      same sentence that says what to do. A wrong HUNT used to be refused, so it
      cost nothing and there was nothing to disclose; now it lands, is charged,
      and spends one of a small budget per target -- a cost the player only
      learns from the banner after paying it is not a choice they made.
    */
    huntHint: (cost: number) =>
      `Pick a team / generation you inspected in the Public Ledger. A wrong secret costs ${cost} points and one of your attempts against that team -- the count is on each chip.`,
    huntAttemptsLeft: (left: number, max: number) => `${left}/${max} attempts left`,
    huntExhausted: "No attempts left against this team's generation.",
    noHuntTarget: "No opponent share is public yet.",
    recovered: "recovered secret",
    rotate: "ROTATE",
    rotateHint: "Switch to a fresh generation.",
    rotateSudokuHunted: "This generation's sudoku solution has been recovered by another team. A fresh generation gets a fresh solution.",
    rotateSudokuExhausted: "Every fresh relabelling table on this generation is spent. ROTATE before the next PROVE, or the next table would be a reuse.",
    rotateCost: (orders: number) => `Voids your ${orders} open Order${orders === 1 ? "" : "s"} -- each costs you points, exactly as letting it expire would.`,
    // [Issue #659 §9] The hint ladder. The price is on the button, always,
    // because a cost the player only discovers after paying it is not a choice
    // they made.
    hintsTitle: "HINTS",
    hintsHint: "Open hints one step at a time. Check the next penalty before opening.",
    hintBuy: (cost: number) => cost === 0 ? "OPEN THE NEXT HINT (no penalty)" : `OPEN THE NEXT HINT (-${cost})`,
    hintsExhausted: "Every hint on this Order is open.",
    hintOpened: "HINT OPENED",
    hintOpenedBody: (cost: number) => cost === 0 ? "No penalty · the next step is in this Order’s hints." : `-${cost} · the next step is in this Order’s hints.`,
    send: "SUBMIT",
    running: "SUBMITTING…",
    leakRate: "pass",
    leakSuccess: "LEAK SUCCESS",
    leakBody: (points: number, shares: readonly number[]) => `+${points} · shares ${shares.map((x) => `#${x}`).join(", ")} added to the public record.`,
    leakPairBody: (points: number, pairsToBreak: number) =>
      `+${points} · your row and its answer → PUBLIC LEDGER. ${pairsToBreak} pair${pairsToBreak === 1 ? "" : "s"} recovers your key.`,
    // [Issue #709] PROVE is a hand relabelling of the vault's sudoku.
    proveTitle: "SHOW IT WITHOUT SHOWING IT — a zero-knowledge proof",
    proveUse: "USED FOR: having the judge check your solution without directly handing the full original to another team",
    proveWhy: "WHY IT WORKS: relabelling the digits keeps every row, column and box valid — the judge sees a real solution, everyone else sees 1-4 in some order",
    proveHelp: "An unused replacement table is ready. Follow its arrows and fill the four blue cells. You do not need to choose a table.",
    proveTable: "1. Choose a relabelling table",
    proveChooseTable: "Choose a table…",
    proveReused: "used in this generation — reuse exposes your solution",
    proveExample: (from: number, to: number) => `Example: a ${from} on the left becomes ${to} on the right. Use the same table for the four holes.`,
    proveSolution: "your solution (private)",
    proveUsed: "tables you already used this generation",
    proveNoneUsed: "none yet — any table that uses each of 1-4 once, other than 1→1 2→2 3→3 4→4, is fresh",
    proveGrid: "Enter here: four blue cells",
    proveIncomplete: "Fill the four blue cells with 1–4.",
    proveSuccess: "PROVE SUCCESS",
    proveBody: (points: number, group: string) => `+${points} · ${group} of your RELABELLED grid is on the Public Ledger; your solution is not`,
    proveMiss: "PROVE MISS",
    proveMissBody: (cost: number) => `-${cost} · that grid is not a relabelling of your solution. Check that the table sends 1-4 to 1-4 with no digit used twice, then check it against every cell.`,
    proveUnread: "PROVE SUBMITTED",
    proveUnreadBody: "The result could not be read. Check your score and the Order.",
    proveLesson:
      "You explored the idea behind ZK: the trusted game judge checked your solution, while other teams saw one relabelled group. A full ZK protocol also hides the solution from its verifier.",
    huntSuccess: "HUNT SUCCESS",
    huntBody: "Recovered secret accepted.",
    /*
      [Issue #696] A miss is reported as a miss. The SDK answers a landed HUNT
      with ok whether it hit or missed, and this banner used to key SUCCESS on
      ok -- so a wrong guess lost 8 points, burned an attempt, and was told it
      had been accepted. The numbers come from the projection, never a literal.
    */
    huntMiss: "HUNT MISS",
    huntMissBody: (cost: number, left: number | undefined) =>
      left === undefined ? `-${cost}` : `-${cost} · ${left} attempt${left === 1 ? "" : "s"} left`,
    huntUnknownPoints: (left?: number) => `This older result has no recorded score change.${left === undefined ? "" : ` ${left} attempt${left === 1 ? "" : "s"} left.`}`,
    huntUnread: "HUNT SUBMITTED",
    huntUnreadBody: "The result could not be read. Check your score and the attempts left on the target.",
    huntCipherBody: "Recovered key accepted — that rung is broken until they rotate.",
    rotateSuccess: "ROTATE",
    rotateBody: (from: number, to: number) => `GEN ${from} → GEN ${to}`,
    rejected: "REJECTED",
    attemptLabel: (n: number) => ` · attempt ${n}`,
    unavailable: "The match service is unavailable.",
    ended: "MATCH ENDED",
    endedBody:
      "This match ran its full length and is over. Scores and the Public Ledger are kept as they finished. An organiser can start a fresh match for this event from the admin API; re-deploying the problem does not, on purpose, because it would wipe a match other teams are still playing.",
    waitingTitle: "WAITING FOR THE ROOM",
    waitingBody:
      "Nothing is running yet. The match begins once every team says it is ready — Orders start arriving then, and the clock starts with them. A match set up ahead of time costs you nothing while it waits.",
    waitingNote: (minutes: number) => `Once started, the match runs ${minutes} minutes.`,
    ready: "I'M READY",
    readyDone: "READY — waiting for the others",
    readyCount: (count: number, total: number) => `${count} of ${total} teams ready`,
    startAnyway: "start without waiting",
    start: "START THE MATCH",
    starting: "STARTING…",
    startSuccess: "MATCH STARTED",
    startBody: "The first Orders are on the belt.",
    fheTitle: "ENCRYPTED ADDITION — FHE (homomorphic encryption)",
    fheUse: "USED FOR: verifying a total without seeing anyone's amount",
    fheWhy: "WHY IT WORKS: the sum contains the content total plus the hiding-number total; the judge uses the separate input keys and original left values to subtract the hiding numbers",
    fheHelp: "DO THIS: add the lefts and the rights separately, then take each remainder after dividing by p",
    fheInputs: "the Order's ciphertexts",
    fheAnswerR: "your answer: left part",
    fheAnswerY: "your answer: right part",
    fhe: "SUBMIT CIPHERTEXT",
    fheHint: "COMPUTE / NOTHING REVEALED",
    fheSuccess: "FHE SUCCESS",
    fheBody: (points: number) => `+${points} · ADDED WITHOUT DECRYPTING`,
    fheLesson:
      "That was HOMOMORPHIC ENCRYPTION: you computed on numbers you could not read, and the answer came out right. Blockchains use it so a chain can verify a total without anyone publishing the amounts.",
    mpcTitle: "MASKED SUBTOTAL — MPC (secure multi-party computation)",
    mpcUse: "USED FOR: offices finding a total while keeping each input private",
    mpcWhy: "A mask is a number shared privately by two offices. One adds it and the other subtracts it, so the masks cancel when all subtotals are added.",
    mpcHelp: "DO THIS: your number + masks received − masks sent, then the remainder after dividing by p",
    mpcMine: "your number (private)",
    mpcIncoming: "masks received",
    mpcOutgoing: "masks sent",
    mpcAnswer: "your masked subtotal",
    mpc: "SUBMIT SUBTOTAL",
    mpcHint: "COMPUTE / INPUT STAYS PRIVATE",
    mpcSuccess: "MPC SUCCESS",
    mpcBody: (points: number) => `+${points} · YOUR NUMBER STAYED PRIVATE`,
    mpcLesson:
      "You submitted a masked subtotal. Adding every office’s subtotal cancels the masks and gives the remainder of the combined total. This is the secure-computation (MPC) mechanism.",
    prime: "p (the divisor)",
    cipher: "CIPHER",
    huntCipher: "HUNT · CIPHER KEY",
    huntCipherHint:
      "These teams have published enough pairs to give their key away on the rung shown. Subtract the plaintext from the ciphertext, position by position, and take the remainder -- on a Caesar rung the first column is enough. Submit the key as a number.",
    cipherTitle: "ENCRYPT WITH YOUR KEY",
    cipherUse: "USED FOR: the oldest cipher there is — here to show you what breakable feels like",
    cipherWhy: "WHY IT BREAKS: shifting is reversible, and the shift IS the key — one leaked pair gives it away",
    cipherHelp:
      "DO THIS: shift each symbol forward by your key, wrapping at the end. Symbols or numbers both work",
    cipherKey: "your key (private)",
    cipherAlphabet: "the symbols, in order",
    cipherAnswer: "your encrypted row",
    cipherCost: (pairs: number) =>
      `LEAK instead and this row is published next to its answer. ${pairs} such pair${pairs === 1 ? "" : "s"} recovers your key.`,
    cipherSuccess: "CIPHER SUCCESS",
    cipherBody: (points: number) => `+${points} · NOTHING PUBLISHED`,
    huntSudoku: "HUNT · REUSED RELABELLING",
    huntSudokuHint: (cost: number) =>
      `Find two or more of one team's sudoku rows, same generation, SAME TAG — they came from one relabelled grid. Line those cells up against the team's public puzzle to recover the table, undo it, and fill in the rest. The judge accepts this HUNT only once those same-tag groups pin a single solution; if two still leave a choice, wait for the next one. A wrong grid costs ${cost} points and one attempt.`,
    huntSudokuPuzzle: "their public puzzle",
    huntSudokuReveals: "their opened groups",
    huntSudokuGrid: "their solution, as you recovered it",
    noSudokuTarget: "No other team has PROVEd yet.",
    recoveredKey: "recovered key",
    huntSudokuBody: "Recovered solution accepted — relabelling reuse punished.",
    tactics: "NEXT TACTIC FROM THE PUBLIC RECORD",
    tacticsHint: "Open this when a public share, an opened sudoku row, reused RPS hiding numbers, or one of your exposed shares gives you another move.",
    exposure: "EXPOSURE",
    exposureHint: (threshold: number) =>
      `${threshold} shares of one generation reconstruct that team's secret. This is how close everyone is.`,
    exposureSelf: "you",
    exposureSafe: "safe",
    exposureWarn: "at risk — ROTATE clears it",
    exposureHuntable: "can be hunted",
    exposureSolo: "This event has one team, so nothing can be hunted and LEAK carries no risk here. The trade this Battle is about only appears with a second team.",
  },
  ja: {
    title: "MAKE A MOVE",
    selectOrder: "1. ORDER を選ぶ",
    noOrder: "現在 open な Order はありません。",
    choose: "答え方を選ぶ",
    // [Issue #702] 無料、 かつヒントの裏ではなくカード上。 ライブ実戦では 3 段すべて
    // (-14 点) 買ったうえで 「Share ってそもそもなに？」 と返ってきた。
    // 用語を知るのに得点を払わせない。
    shareWhat: "かけら (share) = 秘密を 5 個に分けたうちの 1 個。MY VAULT の #1〜#5 がそれです。",
    shareDo: (indices: readonly number[]) =>
      `この Order が要求しているのは ${indices.map((i) => `#${i}`).join("・")} です。LEAK を押すとそれを渡して即完了 — 計算はありません。PROVE は渡さずに答えます。`,
    leak: "LEAK",
    leakHint: "押すだけで完了・計算なし",
    prove: "PROVE",
    proveHint: "表を選んで、4 マスを穴埋め",
    proveOpen: "付け替えて出す",
    constraintNone: "方法は自由",
    constraintNoRaw: (methods: readonly string[]) =>
      `${methods.join(" / ").toUpperCase()} のみ — 生の値を公開してはいけない`,
    scoreLabel: "スコア",
    scoreHint: "未回答のまま締切 → 減点",
    leakBlocked: "この Order は LEAK を受け付けません。",
    proveBlocked: "この Order は PROVE を受け付けません。",
    hunt: "公開されたシェアから秘密を計算する",
    // [Issue #696] 外したときの代償は、提出する前にカードに書く。
    huntHint: (cost: number) =>
      `下で相手を選び、表の数を式に入れます。外すと ${cost} 点減り、残り回数を1回使います。`,
    huntAttemptsLeft: (left: number, max: number) => `あと ${left}/${max} 回`,
    huntExhausted: "この相手・世代への HUNT はもう残っていません。",
    noHuntTarget: "まだ相手のかけらは公開されていません。",
    recovered: "計算した秘密の数",
    rotate: "ROTATE",
    rotateHint: "新しい世代へ切り替えます。",
    rotateSudokuHunted: "この世代の数独の解は他チームに割り出されています。新しい世代は新しい解になります。",
    rotateSudokuExhausted: "この世代で未使用の付け替え表がもうありません。次の PROVE の前に ROTATE しないと、次の表は使い回しになります。",
    rotateCost: (orders: number) => `未処理の ORDER ${orders} 件が無効になります。期限切れと同じだけ減点されます。`,
    hintsTitle: "ヒント",
    hintsHint: "1 段ずつ説明を開きます。次の減点を確認してから開いてください。",
    hintBuy: (cost: number) => cost === 0 ? "次のヒントを開く（減点なし）" : `次のヒントを開く（-${cost}）`,
    hintsExhausted: "この Order のヒントはすべて開きました。",
    hintOpened: "ヒントを開きました",
    hintOpenedBody: (cost: number) => cost === 0 ? "減点なし · 下に表示されています" : `-${cost} · 下に表示されています`,
    send: "答えを送る",
    running: "送信中…",
    leakRate: "パス",
    leakSuccess: "公開して得点！",
    leakBody: (points: number, shares: readonly number[]) => `+${points} · シェア ${shares.map((x) => `#${x}`).join(", ")} を全員に見える公開記録へ追加しました。`,
    leakPairBody: (points: number, pairsToBreak: number) =>
      `+${points} · 記号列と答えが対で公開されました。この段は ${pairsToBreak} 組で鍵が割れます。`,
    // [Issue #709] PROVE は MY VAULT の数独を手で付け替えて出す。
    proveTitle: "解を見せずに示す ― ゼロ知識証明",
    proveUse: "つかいみち: 相手チームに元の解全体を直接渡さず、解を持っていることを審判に確認してもらう",
    proveWhy: "しくみ: 数字を付け替えても行・列・箱の性質は崩れない ── 審判には本物の解、相手には「1〜4 の並び替え」にしか見えない",
    proveHelp: "置き換え表はこちらで用意します。表を選ぶ必要はありません。元の盤面の数字を矢印で読み替え、青い4マスに入力します。",
    proveTable: "1. 付け替え表を選ぶ",
    proveChooseTable: "表を選んでください",
    proveReused: "この世代で使用済み — 再利用すると解が漏れる危険あり",
    proveExample: (from: number, to: number) => `見本: 左の「${from}」は、表の矢印をたどると右の「${to}」になります。同じ表を使って、空欄4マスも読み替えてください。`,
    proveSolution: "自分の解 (非公開)",
    proveUsed: "この世代で使った表",
    proveNoneUsed: "まだなし ── 1〜4 を 1 回ずつ使う表なら、1→1 2→2 3→3 4→4 以外はどれでも新品",
    proveGrid: "ここに入力：青い4マス",
    proveIncomplete: "青い4マスに1〜4を入れてください。",
    proveSuccess: "正解！",
    proveBody: (points: number, group: string) => `+${points} · 付け替えたマス目の${group}が公開記録に載りました。解そのものは載っていません`,
    proveMiss: "PROVE MISS",
    proveMissBody: (cost: number) => `-${cost} · そのマス目は自分の解の付け替えになっていません。表が 1〜4 を 1〜4 へ、同じ数字を 2 回使わずに送っているか確かめてから、全マスに当て直してください。`,
    proveUnread: "PROVE を送信しました",
    proveUnreadBody: "結果を読み取れませんでした。スコアと Order を確認してください。",
    proveLesson:
      "いま体験したのは ZK の考え方です。ゲームの審判が解を検査し、相手には付け替えた 1 組だけを見せました。本来の ZK では審判にも解を渡しません。",
    huntSuccess: "秘密を見破った！",
    huntBody: "計算した秘密が正解でした。",
    // [Issue #696] 外れは外れと言う。 ok だけを見て SUCCESS を出していたのが不具合。
    huntMiss: "HUNT MISS",
    huntMissBody: (cost: number, left: number | undefined) =>
      left === undefined ? `-${cost}` : `-${cost} · あと ${left} 回`,
    huntUnknownPoints: (left?: number) => `この古い結果には得点変化の記録がありません。${left === undefined ? "" : `あと ${left} 回。`}`,
    huntUnread: "HUNT を送信しました",
    huntUnreadBody: "結果を読み取れませんでした。スコアと、相手チップの残り回数を確認してください。",
    huntCipherBody: "割り出した鍵が受理されました。相手が ROTATE するまで、この段は破れたままです。",
    rotateSuccess: "ROTATE",
    rotateBody: (from: number, to: number) => `世代 ${from} → 世代 ${to}`,
    rejected: "REJECTED",
    attemptLabel: (n: number) => ` · ${n} 回目`,
    unavailable: "試合サービスに接続できません。",
    ended: "MATCH ENDED",
    endedBody:
      "この試合は時間いっぱい進んで終了しました。得点と Public Ledger は終了時のまま残ります。新しい試合を始めるには運営が admin API から reset します。問題を deploy し直しても再開しないのは意図的で、他チームが進行中の試合を消してしまうためです。",
    waitingTitle: "全員がそろうのを待っています",
    waitingBody:
      "まだ何も動いていません。全チームが準備完了になった時点で始まり、そこから ORDER が届き、時計も動きはじめます。先に用意しておいた試合が、待っているあいだに減点されることはありません。",
    waitingNote: (minutes: number) => `始めると ${minutes} 分の試合になります。`,
    ready: "準備完了",
    readyDone: "準備完了 — 相手を待っています",
    readyCount: (count: number, total: number) => `${total} チーム中 ${count} チームが準備完了`,
    startAnyway: "全員を待たずに始める",
    start: "試合を始める",
    starting: "開始中…",
    startSuccess: "MATCH STARTED",
    startBody: "最初の ORDER が届きました。",
    fheTitle: "暗号文のまま足す ― FHE (準同型暗号)",
    /*
      [Issue #659] 1 Order = 3 行。「つかいみち / しくみ / やること」。
      
      これまでは手順だけを段落で書いていたので、通っても**なぜ成り立つのか**が
      残らなかった。かといって解説を長くすると遊べない。だから 1 項目 1 行に絞る:
      何のための技術か、なぜ成り立つのか (式 1 本)、手を何回動かすか。
    */
    fheUse: "つかいみち: 誰がいくら持っているか見ずに、合計だけ検証する",
    fheWhy: "しくみ: 足すと「中身の合計 + 隠す数の合計」になる ── 判定側は各入力の鍵と左の値から隠す数を求めて引ける",
    fheHelp: "やること: 2つの暗号文を左どうし・右どうし足して、p で割った余り",
    fheInputs: "Order の暗号文",
    fheAnswerR: "答え: 左の値",
    fheAnswerY: "答え: 右の値",
    fhe: "暗号文を提出",
    fheHint: "計算 / 何も明かさない",
    fheSuccess: "正解！",
    fheBody: (points: number) => `+${points} · 復号せずに足した`,
    fheLesson:
      "いまのが「準同型暗号」です。中身を読めない数のまま計算して、答えは正しく出ました。ブロックチェーンでは、金額を誰も公開せずに合計を検証するのに使われています。",
    mpcTitle: "自分の数を隠して合計する ― MPC (秘密計算)",
    mpcUse: "つかいみち: 各拠点が自分の数を隠し、合計の余りだけを出す",
    mpcWhy: "覆面は、2つの拠点が内緒で共有する数です。片方が足し、もう片方が引くので、全拠点の小計を足すと覆面は打ち消し合います。",
    mpcHelp: "やること: 自分の数 + 受け取った覆面 − 送った覆面 を、p で割った余り",
    mpcMine: "自分の数 (非公開)",
    mpcIncoming: "受け取った覆面",
    mpcOutgoing: "送った覆面",
    mpcAnswer: "公開する小計",
    mpc: "小計を提出",
    mpcHint: "計算 / 自分の数は出ない",
    mpcSuccess: "正解！",
    mpcBody: (points: number) => `+${points} · 自分の数は公開されていない`,
    mpcLesson:
      "覆面を足し引きした小計を提出しました。各拠点の小計を足すと覆面が打ち消し合い、合計を割る数で割った余りが得られます。これが秘密計算 (MPC) の仕組みです。",
    prime: "p (割る数)",
    cipher: "CIPHER",
    huntCipher: "HUNT · 暗号鍵",
    huntCipherHint:
      "以下のチームは、表示された段で鍵が割れるだけの対を公開しています。暗号文から平文を位置ごとに引いて余りを取ってください。シーザーの段なら最初の 1 列で足ります。鍵は数字で提出します。",
    cipherTitle: "自分の鍵で暗号にする",
    cipherUse: "つかいみち: 一番古い暗号。ここで「破れる暗号」を体験しておく",
    cipherWhy: "しくみ: ずらして戻すだけ。ずらし幅が鍵 ── だから 1 組漏れると引き算で割れる",
    cipherHelp:
      "やること: 各記号を鍵の数だけ後ろへずらし、終わりまで来たら先頭へ戻る。記号でも数字でも入力できます",
    cipherKey: "自分の鍵 (非公開)",
    cipherAlphabet: "記号の並び順",
    cipherAnswer: "暗号にした列",
    cipherCost: (pairs: number) =>
      `LEAK すると、この列と答えが対で公開されます。この段は ${pairs} 組で鍵が割れます。`,
    cipherSuccess: "正解！",
    cipherBody: (points: number) => `+${points} · 何も公開されない`,
    huntSudoku: "HUNT · 付け替えの使い回し",
    huntSudokuHint: (cost: number) =>
      `同じチーム・同じ世代で「付け替え」のタグが同じ数独の行を 2 つ以上、Ledger から探してください。同じ付け替えの写しから出た行です。そのマスをそのチームの公開問題と突き合わせると表が割れ、表を戻せば解が出ます。審判がこの HUNT を受け付けるのは、同じタグのグループで解が 1 つに絞れたときだけです。2 つでまだ絞れないなら、次の公開を待ってください。外すと ${cost} 点減り、回数を 1 回使います。`,
    huntSudokuPuzzle: "相手の公開問題",
    huntSudokuReveals: "相手が公開したグループ",
    huntSudokuGrid: "割り出した相手の解",
    noSudokuTarget: "まだ PROVE した他チームはいません。",
    recoveredKey: "復元した鍵",
    huntSudokuBody: "割り出した解が受理されました — 付け替えの使い回しを突きました。",
    tactics: "公開記録からできる次の作戦",
    tacticsHint: "公開されたかけら・数独の行・じゃんけんの使い回し、または自分の公開済みかけらがあるときに開きます。",
    exposure: "危険度",
    exposureHint: (threshold: number) =>
      `同じ世代のかけらが ${threshold} 個そろうと、そのチームの秘密は復元されます。いま全員が何個まで来ているかです。`,
    exposureSelf: "あなた",
    exposureSafe: "まだ安全",
    exposureWarn: "危険 — ROTATE で消せます",
    exposureHuntable: "HUNT できます",
    exposureSolo: "このイベントは 1 チームなので HUNT は起きず、LEAK に危険もありません。この Battle の駆け引きは 2 チーム目がいて初めて現れます。",
  },
} as const;

function outcomeError(outcome: PortalCoordinationOutcome, locale: Locale): string {
  if (outcome.kind === "rejected") return rpsRejection(outcome.error, locale);
  if (outcome.kind === "not_configured") return locale === "ja" ? "coordination が未設定です。" : "Coordination is not configured.";
  return FAST_MOVE_COPY[locale].unavailable;
}

function liveProjection(outcome: PortalCoordinationOutcome): CryptoBattleProjection | undefined {
  return outcome.kind === "ok" && isCryptoBattleProjection(outcome.projection) ? outcome.projection : undefined;
}

function isClosed(projection: CryptoBattleProjection | null): boolean {
  if (!projection || projection.phase === "waiting") return false;
  return projection.phase === "ended" || (projection.matchRemainingMs ?? 1) <= 0;
}

/** [Issue #677] Deployed, nobody has started it: the belt is empty on purpose. */
function isWaiting(projection: CryptoBattleProjection | null): boolean {
  return projection?.phase === "waiting";
}

/**
 * How long the match will run, in minutes, read off the clock the projection
 * already carries rather than from a constant the portal would have to keep in
 * step with the reducer's config.
 */
function matchMinutes(projection: CryptoBattleProjection): number {
  return (projection.matchRemainingMs ?? 0) / 60_000;
}

function openOrders(projection: CryptoBattleProjection | null): readonly ContractProjection[] {
  if (!projection || isClosed(projection)) return [];
  return projection.myContracts.filter((order) => order.status === "open" && order.remainingMs > 0);
}


/**
 * [Issue #696] What to tell the player after a Shamir HUNT the service
 * accepted.
 *
 * Accepted is not the same as hit. Since #696 a wrong secret is a move that
 * lands -- `validateOp` no longer refuses it, `applyHunt` charges
 * `wrongHunt` and spends an attempt -- so the plugin SDK answers a miss with
 * the same `{ ok: true }` it answers a hit with. This panel used to key the
 * SUCCESS banner on that ok alone, and a player who guessed wrong lost points,
 * burned an attempt, and read 「復元した secret が受理されました」.
 *
 * So SUCCESS requires the projection to SAY hit. A miss is named as a miss,
 * with the price and the attempts left read off the projection; and an
 * accepted op whose result cannot be read is reported as exactly that, never
 * rounded up to a success.
 *
 * Exported for `game/src/portal.test.ts`.
 */
export function huntFeedback(
  next: CryptoBattleProjection | undefined,
  targetTeamId: string,
  locale: Locale,
  via?: "sudoku" | "rotor",
): FeedbackDraft {
  const copy = FAST_MOVE_COPY[locale];
  const outcome = next?.lastHunt;
  // [Issue #709] The projection remembers WHICH secret the last HUNT went
  // after. A sudoku miss must not be read off the Shamir budget, and a Shamir
  // hit must not be reported as a recovered solution.
  const matches = outcome !== undefined && outcome.targetTeamId === targetTeamId && (outcome.via ?? undefined) === via;
  if (next !== undefined && matches && outcome?.outcome === "hit") {
    const body = via === "rotor" ? (locale === "ja" ? "相手のRotorの初期位置が一致し、攻撃が成功しました。" : "The recovered Rotor initial positions match; the attack succeeded.") : via === "sudoku" ? copy.huntSudokuBody : copy.huntBody;
    return { kind: "hunt", title: copy.huntSuccess, body: outcome.points === undefined ? `${body} ${copy.huntUnknownPoints()}` : body, reward: outcome.points };
  }
  if (next !== undefined && matches && outcome?.outcome === "miss") {
    const budget = (via === "sudoku" ? next.sudokuHuntAttempts : next.huntAttempts)[targetTeamId];
    const left = budget === undefined ? undefined : Math.max(0, budget.max - budget.spent);
    return { kind: "error", title: copy.huntMiss, body: outcome.points === undefined ? copy.huntUnknownPoints(left) : copy.huntMissBody(Math.abs(outcome.points), left) };
  }
  return { kind: "error", title: copy.huntUnread, body: copy.huntUnreadBody };
}

/**
 * [Issue #709] What to tell the player after a PROVE the service accepted.
 *
 * Accepted is not the same as verified: a wrong grid is a move that lands,
 * charges `wrongProve`, and comes back `{ ok: true }` like a hit. Only the
 * projection's `lastProve` can say which it was, so SUCCESS requires it to say
 * hit, for THIS Order; a miss is named as a miss with the price; and an
 * accepted op whose result cannot be read is reported as exactly that.
 *
 * Exported for `game/src/portal.test.ts`.
 */
export function proveFeedback(
  next: CryptoBattleProjection | undefined,
  contractId: string,
  points: number,
  locale: Locale,
): FeedbackDraft {
  const copy = FAST_MOVE_COPY[locale];
  const outcome = next?.lastProve;
  points = outcome?.points ?? points;
  if (next !== undefined && outcome?.contractId === contractId && outcome.outcome === "hit") {
    const reveal = next.publicLedger.find(
      (a): a is SudokuRevealArtifact => a.kind === "sudoku-reveal" && a.contractId === contractId,
    );
    const group = reveal ? describeRevealGroup(reveal.group, locale) : locale === "ja" ? "1 グループ" : "one group";
    return { kind: "prove", title: copy.proveSuccess, body: copy.proveBody(points, group), reward: points, lesson: copy.proveLesson };
  }
  if (next !== undefined && outcome?.contractId === contractId && outcome.outcome === "miss") {
    return { kind: "error", title: copy.proveMiss, body: copy.proveMissBody(next.wrongProveCost) };
  }
  return { kind: "error", title: copy.proveUnread, body: copy.proveUnreadBody };
}

/** A well-formed Vigenère miss is accepted and charged, so SDK ok alone is insufficient. */
export function cipherFeedback(next: CryptoBattleProjection | undefined, contractId: string, locale: Locale): FeedbackDraft {
  const last = next?.lastCipher;
  if (!last || last.contractId !== contractId) return { kind: "error", title: locale === "ja" ? "CIPHERを送信しました" : "CIPHER submitted",
    body: locale === "ja" ? "裁定を読み取れませんでした。お題とスコアを確認してください。" : "Could not read the verdict. Check the Order and score." };
  if (last.outcome === "miss") return { kind: "error", title: locale === "ja" ? "暗号の答えが違います" : "Incorrect ciphertext",
    body: locale === "ja" ? `${last.points} 点。このお題は以後0点で再挑戦できます。期限内に正しく完了すれば、期限切れの減点を避けられます。` : `${last.points} pt. Retry this Order for 0 points. Completing it correctly before its deadline avoids the expiry penalty.` };
  return { kind: "prove", title: FAST_MOVE_COPY[locale].cipherSuccess, reward: last.points,
    body: last.points === 0 ? locale === "ja" ? "+0 点 · 正しく完了しました。公開せず、期限切れの減点もありません。" : "+0 pt · Correctly completed without publication or an expiry penalty."
      : FAST_MOVE_COPY[locale].cipherBody(last.points) };
}

export function CipherScoring({ order, wrongCost, locale }: { readonly order: ContractProjection; readonly wrongCost: number; readonly locale: Locale }) {
  return <p className="tc-card-warn" data-testid="cipher-scoring">{locale === "ja"
    ? order.cipherFailed ? `このお題は0点で再挑戦 · 誤答 −${wrongCost} 点。期限内に正しく完了すれば期限切れ減点を避けられます。`
      : `正解 +${order.points} 点 / 誤答 −${wrongCost} 点、このお題は以後0点で再挑戦。未入力・範囲外は誤答に数えません。`
    : order.cipherFailed ? `Retry for 0 points · wrong answer −${wrongCost} pt. Correct completion before the deadline avoids expiry penalties.`
      : `Correct +${order.points} pt / wrong answer −${wrongCost} pt, then retry this Order for 0 points. Empty/out-of-range input is not a wrong answer.`}</p>;
}

function ownExposedShareCount(projection: CryptoBattleProjection | null): number {
  if (!projection) return 0;
  const indices = new Set<number>();
  for (const entry of projection.publicLedger) {
    if (
      entry.kind === "share" &&
      entry.teamId === projection.vault.teamId &&
      entry.generation === projection.vault.generation
    ) {
      indices.add(entry.shareIndex);
    }
  }
  return indices.size;
}

/**
 * [Issue #682] Every team's distance from being hunted, in one list.
 *
 * The Battle's whole tension is that LEAK is fast and PROVE is safe, and that
 * only holds if a player can see the danger accumulating. Until now they could
 * not: HUNT, ROTATE and both key-recovery moves were rendered only once the
 * evidence for them already existed, and even then inside a collapsed
 * `<details>`. A first-time player therefore met a queue of puzzles with no
 * opponent in it, pressed LEAK because it was the fast button, and never
 * learned that the fast button was the dangerous one. 「これだと単に問題を解いて
 * いるだけ」 was an exact description of what the code did.
 *
 * So the lane is computed for EVERY team including the ones at zero, and it is
 * rendered whether or not anything is actionable. Watching a rival go 1/3 then
 * 2/3 is the information that makes the next LEAK a decision, and watching your
 * own row climb is what makes ROTATE mean something before it is too late.
 *
 * Counted per team's CURRENT generation only: a ROTATE makes every share
 * published before it worthless, so old rows must not keep a team looking
 * exposed after it has already escaped.
 */
export interface ExposureRow {
  readonly teamId: string;
  /** [Issue #3172] 表示名。 platform が解決できなければ teamId のまま。 */
  readonly teamName: string;
  readonly isSelf: boolean;
  readonly generation: number;
  readonly exposed: number;
  readonly shareIndices: readonly number[];
  /** At or past the threshold — this team's current secret can be reconstructed. */
  readonly huntable: boolean;
}

export function exposureRows(projection: CryptoBattleProjection | null): readonly ExposureRow[] {
  if (!projection) return [];
  const generationOf = new Map<string, number>();
  const nameOf = new Map<string, string>();
  for (const team of Object.values(projection.teams)) {
    generationOf.set(team.teamId, team.generation);
    nameOf.set(team.teamId, team.teamName || team.teamId);
  }
  // The vault is authoritative for our own generation: `teams` carries it too,
  // but the vault is what every other control on this surface reads.
  generationOf.set(projection.vault.teamId, projection.vault.generation);

  const indices = new Map<string, Set<number>>();
  for (const entry of projection.publicLedger) {
    if (entry.kind !== "share") continue;
    if (entry.generation !== generationOf.get(entry.teamId)) continue;
    const set = indices.get(entry.teamId) ?? new Set<number>();
    set.add(entry.shareIndex);
    indices.set(entry.teamId, set);
  }

  const rows = [...generationOf.entries()].map(([teamId, generation]): ExposureRow => {
    const exposed = [...(indices.get(teamId) ?? [])].sort((a, b) => a - b);
    return {
      teamId,
      teamName: nameOf.get(teamId) ?? teamId,
      isSelf: teamId === projection.vault.teamId,
      generation,
      exposed: exposed.length,
      shareIndices: exposed,
      huntable: exposed.length >= projection.threshold,
    };
  });
  // Own row first — it is the one that decides the next move — then the teams
  // closest to being hunted.
  return rows.sort((a, b) =>
    a.isSelf === b.isSelf ? b.exposed - a.exposed : a.isSelf ? -1 : 1,
  );
}

/**
 * [Issue #659] How many Orders a ROTATE would void right now.
 *
 * ROTATE expires every Order the team still has open, and since #659 each of
 * those costs what letting it expire costs -- so rotating mid-batch can be a
 * whole batch's worth of points. The number is computed here, from the same
 * projection the board renders, so the warning states what is actually at stake
 * instead of quoting a rule the participant then has to apply themselves.
 *
 * Exported as a pure function because this panel reads its projection from a
 * polling effect, which static rendering never runs -- the same reason
 * `tacticAvailability` below is shaped this way.
 */
export function rotateVoidCount(projection: CryptoBattleProjection | null): number {
  return openOrders(projection).filter(order => order.task.kind !== "rps-duel").length;
}


/**
 * [Issue #659 §9] The next unopened rung of this Order's hint ladder, or
 * `undefined` when every rung is open.
 *
 * Found by looking for the first rung with no `text`, rather than by counting
 * how many the Portal thinks are open. `projectForTeam` decides which rungs
 * carry text and the reducer decides which one a HINT op opens; a counter here
 * would be a third opinion, free to disagree with both -- and the way it would
 * disagree is by charging for a hint the player already owns.
 *
 * Exported for `game/src/portal.test.ts`: `renderToStaticMarkup` never runs the
 * polling effect, so the panel has no projection to render under test and the
 * decision has to be reachable on its own (see that file's header).
 */
export function nextHintFor(order: ContractProjection | undefined): HintProjection | undefined {
  return order?.hints.find((hint) => hint.text === undefined);
}

/**
 * [Issue #659] Whether the LEAK / PROVE action area belongs on screen for this
 * Order, and which of the two it may actually run.
 *
 * Gated on what the Order ACCEPTS, never on which task it is. Those were the
 * same thing while `reveal-share` was the only Order taking LEAK; the ladder
 * Order takes it too, and a task-name test hid the button on the one Order
 * whose whole point is choosing between computing and passing.
 *
 * Visible-and-disabled beats hidden for a method the Order refuses: the
 * participant sees the option exists and reads why, rather than watching
 * controls appear and vanish as they click between cards. Hidden entirely only
 * when neither applies -- an FHE Order has its own panel, and two permanently
 * dead buttons above it would be noise.
 */
export function primaryActionsFor(order: ContractProjection | undefined): {
  readonly visible: boolean;
  readonly leakAllowed: boolean;
  readonly proveAllowed: boolean;
} {
  const leakAllowed = order?.allowedMethods.includes("leak") ?? false;
  const proveAllowed = order?.allowedMethods.includes("prove") ?? false;
  return { visible: !order || leakAllowed || proveAllowed, leakAllowed, proveAllowed };
}

/** The advanced controls that have relevant public material right now. */
export function tacticAvailability(projection: CryptoBattleProjection | null): {
  readonly hunt: boolean;
  readonly sudokuHunt: boolean;
  readonly cipherHunt: boolean;
  readonly rpsHunt: boolean;
  readonly rotate: boolean;
} {
  return {
    hunt: ledgerTargets(projection).length > 0,
    sudokuHunt: sudokuHuntCandidates(projection).length > 0,
    cipherHunt: cipherHuntCandidates(projection).length > 0,
    rpsHunt: (projection?.rpsHunt?.targets.length ?? 0) > 0,
    rotate: Boolean(projection?.lastBreach && projection.lastBreach.generation === projection.vault.generation) || (projection?.myContracts.some(order => order.status === "open" && order.remainingMs > 0 && order.privacyConstraint === "must-disclose") ?? false) || ownExposedShareCount(projection) > 0 || sudokuRotatePressure(projection) !== undefined
      || (projection?.publicRsaKeys?.some(key => key.teamId === projection.vault.teamId && key.generation === projection.vault.generation) ?? false),
  };
}

/**
 * [Issue #709] Why the sudoku side of the vault wants a ROTATE, if it does.
 *
 * Shares are not the only material a generation can run out of. There are 23
 * usable relabellings, the belt keeps serving PROVE-capable Orders, and a team
 * that has spent every table can only reuse one (and become huntable) or LEAK
 * to reach the ROTATE card -- unless the card opens on this too. And a
 * generation whose solution was recovered is exposed the same way a hunted
 * Shamir generation is; ROTATE is the answer to both.
 */
export function sudokuRotatePressure(
  projection: CryptoBattleProjection | null,
): "hunted" | "exhausted" | undefined {
  if (!projection) return undefined;
  const { vault } = projection;
  if (vault.sudokuHuntedGenerations.includes(vault.generation)) return "hunted";
  if (vault.usedPermutations.length >= ALL_PERMUTATIONS.length - 1) return "exhausted";
  return undefined;
}


const CSS = `
${BOARD_CSS}
${DIE_CSS}
${SUDOKU_CSS}
${GUIDE_CSS}
${HUNT_GUIDE_CSS}
${SUCCESS_CSS}
.tc-sudoku-row{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start}
.tc-sudoku-block{display:grid;gap:3px;justify-items:start}
.tc-reveal-list{list-style:none;margin:0;padding:0;display:grid;gap:4px;font-size:12px}
.tc-reveal-list li{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.tc-reveal-tag{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;border:1px solid #cfd8e3;border-radius:6px;padding:1px 6px;background:#fff}
.tc-die-legend{display:inline-flex;gap:8px;flex-wrap:wrap;margin-left:6px;vertical-align:middle}
.tc-die-legend-item{display:inline-flex;flex-direction:column;align-items:center;gap:1px}
.tc-die-legend-item small{font-size:9px;color:#5f6b7a;font-weight:700}

/* [Issue #659] The board paints its own light surfaces, so it has to state its
   own text colour too. Without this it inherits the text colour from whatever
   the host page happens to set -- and on a dark host that is white, which
   rendered the Order id and the reward as white-on-white and washed the method
   chips out. A component that is only legible when the host picks a compatible
   colour is not self-contained; the dev harness renders these same components
   on a dark page, which is how it surfaced. */
/* [Issue #677] The plugin's panels line up with each other, and do so without
   depending on the host page.

   Three slots stack on the problem page and each drew its own frame at its own
   inset: this shell at 12px padding inside a 2px border, StatusPanel and
   HelpDrawer at 16px inside 1px. The outer edges agreed, so the difference read
   as frames that do not quite line up rather than as a spacing choice -- and
   nesting multiplied it, putting three different content edges at the same
   depth. One inset for all three fixes it; the emphasis the thicker border
   carried now comes from its colour alone.

   box-sizing is declared here rather than assumed because a plugin renders
   inside someone else's page. Without it these widths are correct only on a
   host that ships the usual border-box reset -- the same way this file's colour
   and background were once correct only on a host that happened to match. */
.tc-move-shell,.tc-move-shell *,.tc-game-shell,.tc-game-shell *{box-sizing:border-box}
/* [Issue #677] The Order belt scrolls; it does not widen the page.

   Both shells are grids, and a grid item is min-width:auto by default -- it
   refuses to shrink below its content. The belt is a flex row of six 180px
   cards with overflow-x:auto, so "its content" is about 1150px: instead of
   scrolling inside its track, it pushed the track, the shell, and the page out
   to 1184px inside a 1000px window. The panel then ran off the right edge while
   the host's own cards stopped at the window, which is what read as frames that
   do not line up. min-width:0 is what lets the overflow container do its job. */
.tc-move-shell>*,.tc-game-shell>*,.tc-board-grid>*{min-width:0}
.tc-move-shell{border:1px solid #202b3c;border-radius:12px;padding:16px;background:#f8fafc;color:#16212e;display:grid;gap:12px;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.tc-move-title{font-size:12px;font-weight:900;letter-spacing:.12em}
.tc-order-picks{display:flex;gap:7px;overflow-x:auto;padding-bottom:4px}
/* [Issue #659] The picker is a SELECTOR, not a second board.
   It used to repeat every Order's reward, task, rule and pass rate — the same
   detail the board above already shows, in the same six cards, so the screen
   said everything twice and neither copy read as the one to use. It now carries
   only what you need to pick one: which Order, and how long it has. */
.tc-order-pick{min-width:96px;border:1px solid #b6c2cf;border-radius:9px;padding:8px;background:#fff;cursor:pointer;text-align:left}
.tc-order-pick[aria-pressed="true"]{border:2px solid #0972d3;background:#f1f8ff;padding:7px}
.tc-order-pick strong,.tc-order-pick span{display:block}.tc-order-pick span{font-size:11px;color:#5f6b7a;margin-top:2px}
.tc-order-rule{font-size:10px;letter-spacing:.02em}
.tc-order-rule-strict{color:#7c4a03;font-weight:600}
.tc-action:disabled{opacity:.45;cursor:not-allowed}
.tc-share-primer{margin:0 0 8px;padding:9px 11px;border:1px solid #cfe3f5;border-left:3px solid #4a90d9;border-radius:8px;background:#f4f9fe;font-size:12px;line-height:1.6}
.tc-share-primer strong{display:block;margin-bottom:3px}
.tc-share-primer span{display:block;color:#3f4b57}
.tc-primary-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.tc-action{color:#16212e;border:0;border-radius:12px;padding:16px 12px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;font-weight:900;font-size:18px}
.tc-action small{font-size:10px;font-weight:800;letter-spacing:.06em}
.tc-action:disabled{cursor:not-allowed;opacity:.45}
.tc-leak-button{background:#ffefd1;box-shadow:inset 0 0 0 2px #d8a657}
.tc-prove-button{background:#e7f6ec;box-shadow:inset 0 0 0 2px #69b482}
.tc-prove-step{margin:0 0 6px;font-size:12px;line-height:1.6;color:#3f4b57}
.tc-prove-challenge{margin:0 0 6px;font-size:13px}
.tc-prove-challenge strong{font-size:18px;letter-spacing:.02em}
.tc-input-panel{border:1px solid #cfd8e3;border-radius:9px;padding:9px;background:#fff;display:grid;gap:6px}
.tc-input-panel input,.tc-input-panel select{background:#fff;color:#16212e;padding:8px;border:1px solid #aab7c4;border-radius:6px;font-size:12px;min-width:0}
.tc-secondary-grid{display:grid;grid-template-columns:1.3fr .7fr;gap:10px}
.tc-tactics{border:1px solid #cfd8e3;border-radius:10px;background:#eef3f8}.tc-tactics>summary{cursor:pointer;padding:10px 12px;font-size:12px;font-weight:900}.tc-tactics>summary span{display:block;margin-top:3px;color:#5f6b7a;font-size:11px;font-weight:500}.tc-tactics-body{display:grid;gap:10px;padding:0 10px 10px}
.tc-hunt-card,.tc-rotate-card{border:1px solid #cfd8e3;border-radius:10px;padding:10px;background:#fff}
.tc-hunt-workspace{scroll-margin-top:calc(48vh + 24px)}
.tc-card-title{font-size:12px;font-weight:900;letter-spacing:.07em}.tc-card-hint{font-size:11px;color:#5f6b7a;margin:3px 0 8px}.tc-card-warn{font-size:11px;font-weight:700;color:#a4341c;margin:0 0 8px}
.tc-target-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:7px}
.tc-target-chip{border:1px solid #b6c2cf;border-radius:999px;background:#fff;padding:6px 9px;cursor:pointer;font-size:11px}
.tc-target-chip[aria-pressed="true"]{background:#eef3f8;border-color:#516a84;font-weight:800}
.tc-submit-small{padding:7px 10px;border:0;border-radius:7px;background:#202b3c;color:#fff;font-weight:800;cursor:pointer}.tc-submit-small:disabled{opacity:.45;cursor:not-allowed}
.tc-feedback{border-radius:10px;padding:10px 12px;font-weight:900;animation:tc-feedback-pop .35s ease-out both}
.tc-feedback span{display:block;font-size:11px;font-weight:600;margin-top:2px}
.tc-feedback-attempt{font-style:normal;font-weight:600;font-size:11px;opacity:.75}
.tc-feedback-lesson{margin-top:6px!important;font-weight:500!important;line-height:1.5;opacity:.92}
/* [Issue #659] つかいみち / しくみ を手順の上に置く。段落 1 つより 3 行の方が
   読まれるし、通ったあとに残るのは「何のためか」と「なぜ成り立つか」の方。 */
.tc-lesson{border-left:3px solid #9ec8ee;padding:2px 0 2px 8px;margin:0 0 7px;display:grid;gap:3px}
.tc-lesson-use{font-size:11px;font-weight:800;color:#0b4c8c}
.tc-lesson-why{font-size:11px;color:#41556b;line-height:1.5}
.tc-ticket{border:2px solid #202b3c;border-radius:10px;background:#fff;padding:9px 11px;margin-bottom:10px}
.tc-ticket-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.tc-ticket-head strong{font-size:17px;font-weight:900}
.tc-ticket-head span{font-size:12px;color:#41556b}
.tc-ticket-clock{margin-left:auto;font-size:18px;font-weight:900;font-variant-numeric:tabular-nums}
.tc-ticket-track{height:7px;border-radius:99px;background:#e6ebf1;margin-top:7px;overflow:hidden}
.tc-ticket-fill{height:100%;background:#2e9e5b;transition:width .4s linear}
.tc-ticket-urgent{border-color:#d13212;background:#fff6f5}
.tc-ticket-urgent .tc-ticket-fill{background:#d13212}
.tc-ticket-urgent .tc-ticket-clock{color:#d13212}
.tc-hints{margin-top:9px;border-top:1px dashed #c6d0da;padding-top:8px}
.tc-hint-text{font-size:12px;color:#1f2c3d;line-height:1.6;margin:0 0 6px;overflow-wrap:anywhere}
.tc-hint-step{flex:none;width:17px;height:17px;border-radius:99px;background:#0b4c8c;color:#fff;font-size:10px;font-weight:900;display:inline-flex;align-items:center;justify-content:center;margin-top:2px}
.tc-hint-button{width:100%;padding:7px 9px;border:2px solid #0b4c8c;border-radius:8px;background:#fff;color:#0b4c8c;font-size:11px;font-weight:900;letter-spacing:.05em;cursor:pointer}
.tc-hint-button:disabled{opacity:.5;cursor:not-allowed}
.tc-feedback-leak{background:#fff0d6;border:1px solid #d8a657}.tc-feedback-prove{background:#e7f6ec;border:1px solid #69b482}.tc-feedback-hunt{background:#f0eaff;border:1px solid #9a7bd1}.tc-feedback-rotate{background:#e8f3ff;border:1px solid #6ba8df}.tc-feedback-hint{background:#eef4fb;border:1px solid #7ea8d4}.tc-feedback-error{background:#fff0f0;border:1px solid #d13212}
@keyframes tc-feedback-pop{0%{transform:translateY(7px) scale(.97);opacity:0}60%{transform:translateY(0) scale(1.02);opacity:1}100%{transform:scale(1)}}
/* [Issue #682] The exposure lane. Always on screen, because its job is to be
   watched while it is still boring: a rival at 1/3 is the reason the next LEAK
   is a decision rather than the fast button. */
.tc-exposure{border:1px solid #cfd8e3;border-radius:12px;padding:12px;background:#fff;margin-top:10px}
.tc-exposure-rows{display:grid;gap:6px;margin-top:8px}
.tc-exposure-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center;padding:6px 8px;border:1px solid #eaeded;border-radius:8px;background:#fbfcfd}
.tc-exposure-self{border-color:#b6d7f2;background:#f5fbff}
.tc-exposure-hot{border-color:#e0b36a;background:#fff7e8}
.tc-exposure-team{font-size:11px;font-weight:800;letter-spacing:.04em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tc-exposure-pips{display:flex;gap:3px}
.tc-pip{width:9px;height:9px;border-radius:99px;border:1px solid #b8c4ce;background:#fff}
.tc-pip-on{background:#d97706;border-color:#b45309}
.tc-exposure-state{font-size:10px;font-weight:700;color:#5f6b7a;white-space:nowrap}
.tc-exposure-state-hot{color:#a4341c}
.tc-exposure-note{font-size:11px;color:#5f6b7a;margin:8px 0 0;line-height:1.6}
@media(max-width:720px){.tc-primary-actions,.tc-secondary-grid{grid-template-columns:1fr}}
/* [Issue #677] The two gate screens -- waiting to start, and finished. Both are
   a single centred message, because in both cases there is exactly one thing to
   say and at most one thing to press. */
.tc-gate{display:grid;justify-items:start;gap:10px;padding:18px;border:1px solid #cfd8e3;border-radius:12px;background:#fff;width:100%;min-width:0}
.tc-gate-title{font-size:15px;font-weight:900;letter-spacing:.08em}
.tc-gate-body{margin:0;font-size:13px;line-height:1.7;color:#3b4a5a}
.tc-gate-note{margin:0;font-size:11px;color:#5f6b7a}
.tc-start-button{font-size:15px;font-weight:900;letter-spacing:.06em;padding:12px 22px;border-radius:10px;border:1px solid #0f5c9e;background:#0972d3;color:#fff;cursor:pointer}
.tc-start-button:disabled{opacity:.6;cursor:default}
.tc-start-button:not(:disabled):hover{background:#0f5c9e}
/* [Issue #688] The escape, deliberately quieter than READY. */
.tc-start-anyway{font-size:12px;padding:6px 12px;border-radius:8px;border:1px solid #cfd8e3;background:#fff;color:#5f6b7a;cursor:pointer}
.tc-start-anyway:hover{border-color:#8c9bab;color:#16212e}

.tc-calculation-guide>p{font-size:13px;line-height:1.7;margin:0 0 12px}.tc-calculation-steps{list-style:none;margin:0;padding:0;display:grid;gap:10px}.tc-calculation-steps li{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:#f7f9fc;border:1px solid #e0e7ef;border-radius:8px;font-size:13px}.tc-calculation-number{flex:none;background:#315f91;color:white;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:12px}.tc-calculation-steps code{display:block;margin-top:4px;font:650 17px/1.6 system-ui;overflow-wrap:anywhere}.tc-calculation-steps p{font-size:12px;margin:2px 0 0;color:#526277;line-height:1.6}.tc-answer-label{display:grid;gap:6px;font-size:13px;font-weight:650}.tc-answer-label>input{max-width:220px;font-size:17px}
.tc-chosen-method{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;font-size:14px;color:#315f91}
.tc-chosen-method button{border:1px solid #b9cbe0;border-radius:6px;color:#42536a;background:#fff;font-size:12px;padding:6px 10px;cursor:pointer}
.tc-why{font-size:12px;color:#42536a}.tc-why>summary{cursor:pointer}.tc-why[open]>summary{margin-bottom:8px}
.tc-move-shell{width:100%;min-width:0;margin:0;padding:0;gap:12px;border:0;background:transparent}
.tc-scoreline-value{font-size:24px}.tc-scoreline-hint{font-size:12px}
.tc-scoreline{justify-content:space-between}.tc-scoreline .tc-rival-score{margin:0;display:flex;gap:12px;flex-wrap:wrap;font-size:12px}
.tc-records{font-size:13px;color:#42536a}
.tc-records>summary{padding:8px 0;cursor:pointer}
.tc-result-anchor:empty{display:none}.tc-result-anchor:focus{outline:2px solid #2563a6;outline-offset:3px;border-radius:10px}
.tc-workspace{display:grid;gap:12px;background:#fff;border:1px solid #b9cbe0;border-top:4px solid #315f91;border-radius:12px;padding:16px;box-shadow:0 3px 10px #1e3a5f08}
.tc-ticket{border:0;border-radius:0;padding:0;margin:0;background:transparent}
.tc-ticket-head{align-items:center}.tc-ticket-head>span{font-size:12px;color:#556579}
.tc-ticket-head .tc-ticket-clock{font-size:14px}.tc-order-heading{margin:6px 0 8px;font-size:24px;line-height:1.45;font-weight:800;letter-spacing:0}
.tc-ticket-track{height:3px;margin-top:0}.tc-ticket-fill{background:#7995b4}
.tc-ticket-urgent .tc-ticket-clock{color:#b52815}.tc-ticket-urgent{background:transparent}
.tc-card-title{font-size:13px;letter-spacing:0}.tc-share-primer{padding:0;border:0;background:transparent;margin:6px 0 8px;font-size:13px;line-height:1.65}
.tc-primary-actions{margin-top:8px;gap:12px}.tc-action{align-items:stretch;text-align:left;padding:12px;font-size:16px;font-weight:750;gap:6px;border:1px solid #b6c8dc;border-radius:10px;box-shadow:none;line-height:1.5}
.tc-action-heading{display:flex;align-items:baseline;justify-content:space-between;gap:10px}.tc-action-heading b{white-space:nowrap;font-size:18px}
.tc-action small{font-size:12px;font-weight:500;letter-spacing:0}.tc-action-risk{font-size:12px;font-weight:500;line-height:1.65}
.tc-leak-button{background:#fffbf3;border-color:#decba7}.tc-prove-button{background:#edf5ff;border-color:#8badd3}
.tc-prove-button[aria-expanded="true"]{border-color:#315f91;box-shadow:0 0 0 1px #315f91}
.tc-action:not(:disabled):hover{border-color:#315f91;box-shadow:0 2px 6px #20395815}
.tc-action:focus-visible,.tc-submit-small:focus-visible,summary:focus-visible{outline:3px solid #3372b5;outline-offset:3px}
.tc-input-panel{border:0;border-top:1px solid #e2e8f0;border-radius:0;padding:16px 0 0;gap:10px}
.tc-input-panel>.tc-submit-small{justify-self:start;min-width:180px;padding:11px 18px;background:#315f91;font-size:14px}
.tc-input-panel input[aria-label="fast-cipher-answer"]{scroll-margin-top:calc(48vh + 24px);scroll-margin-bottom:64px}
.tc-input-panel>strong{font-size:16px!important}.tc-card-hint,.tc-lesson-use,.tc-lesson-why{font-size:12px;line-height:1.65}
.tc-hints{border-top:1px solid #e2e8f0;margin:0;padding-top:12px}.tc-hints>summary{font-size:13px;color:#42536a;cursor:pointer}.tc-hints[open]>summary{margin-bottom:10px}
.tc-hint-text{white-space:pre-line;line-height:1.85}.tc-hint-button{width:auto;font-size:12px;font-weight:600;border:1px solid #a1b5cf;letter-spacing:0;padding:8px 12px}
.tc-exposure{margin:0;padding:12px;border-color:#dce3ec;background:transparent;font-size:12px}.tc-exposure>summary{cursor:pointer;font-weight:650}.tc-exposure>summary>span{margin-left:16px;color:#556579;font-weight:500}
.tc-tactics{background:transparent;border-color:#dce3ec}.tc-tactics>summary{font-weight:650}.tc-tactics>summary span{display:none}.tc-tactics[open]>summary span{display:block}
.tc-records>.tc-board-grid{margin-top:8px}
@media(max-width:720px){.tc-workspace{padding:15px;gap:12px}.tc-order-heading{font-size:20px}.tc-primary-actions{grid-template-columns:1fr}.tc-action{padding:14px}.tc-exposure>summary>span{display:block;margin:5px 0 0}.tc-scoreline{gap:6px}}

@media(prefers-reduced-motion:reduce){.tc-feedback{animation:none!important}}
`;

/**
 * [Issue #682] The same projection, aged by the wall clock.
 *
 * Every duration on a projection is only true at the instant it was fetched —
 * `types.ts` says so on each field, and `StatusPanelCore` has always aged them
 * before display. The battle surface did not, so with a 30-second poll every
 * Order countdown sat on one number for half a minute and an Order that had
 * already lapsed stayed on the belt at 0:00 until the next poll replaced it.
 * The owner read that as the clock being frozen, which is exactly what it was.
 *
 * Ageing the whole projection once, rather than at each of the dozen places
 * that read a duration, is what keeps the belt, the ticket, the ROTATE cooldown
 * and the match clock from disagreeing with each other.
 */
export function ageProjection(
  projection: CryptoBattleProjection | null,
  elapsedMs: number,
): CryptoBattleProjection | null {
  if (!projection || elapsedMs <= 0) return projection;
  const drop = (ms: number) => Math.max(0, ms - elapsedMs);
  return {
    ...projection,
    ...(projection.rpsHunt ? { rpsHunt: { ...projection.rpsHunt, targets: projection.rpsHunt.targets.map(t => ({ ...t, remainingMs: drop(t.remainingMs) })) } } : {}),
    matchRemainingMs:
      projection.matchRemainingMs === undefined ? undefined : drop(projection.matchRemainingMs),
    ...ageHintBooster(projection, elapsedMs),
    ...(projection.lightning ? { lightning: { ...projection.lightning,
      remainingMs: drop(projection.lightning.remainingMs),
      startsInMs: projection.lightning.startsInMs === undefined ? undefined : drop(projection.lightning.startsInMs),
    } } : {}),
    vault: {
      ...projection.vault,
      rotateCooldownRemainingMs: drop(projection.vault.rotateCooldownRemainingMs),
    },
  };
}

export default function FastMovePanel(props: PortalSlotProps) {
  const locale: Locale = props.locale === "ja" ? "ja" : "en";
  const copy = FAST_MOVE_COPY[locale];
  const client = props.coordinationClient;
  const polled = usePolledProjection(client);
  const [polledProjection, setPolledProjection] = useState<CryptoBattleProjection | null>(null);
  // [Issue #682] When `polledProjection` was set, by the portal's own wall
  // clock. An op's response replaces the projection too, so this cannot be read
  // off the poller alone — doing that would keep ageing a projection that had
  // just been refreshed, and the countdown would run fast after every move.
  const [projectionAtMs, setProjectionAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selectedOrderId, setSelectedOrderId] = useState("");
  // [Issue #709] Sixteen typed cells for the relabelled grid, and sixteen for
  // a recovered solution. Strings until submit: a half-typed grid is a normal
  // state, and Number("") would silently be 0.
  const [proveCells, setProveCells] = useState<readonly string[]>(() => emptyCells());
  const [proveOpen, setProveOpen] = useState(false);
  const [orderReceipt, setOrderReceipt] = useState<OrderReceipt | undefined>();
  const workspaceRef = useRef<HTMLElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const cipherInputRef = useRef<HTMLInputElement>(null);
  // [Issue #645] One box per component of an FHE answer, one for an MPC
  // subtotal. Keep decimal strings through the wire boundary: the default
  // field is 97, but a configured larger field must not be rounded by Number().
  const [fheR, setFheR] = useState("");
  const [fheY, setFheY] = useState("");
  const [mpcPartial, setMpcPartial] = useState("");
  const [cipherAnswer, setCipherAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const attemptRef = useRef(0);
  useEffect(() => {
    setFeedback(null);
    attemptRef.current = 0;
    setOrderReceipt(undefined);
  }, [polled.projection?.vault.teamId]);
  useEffect(() => {
    if (feedback && feedback.kind !== "hint") {
      feedbackRef.current?.focus({ preventScroll: true });
      feedbackRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [feedback?.attempt]);

  const snapshotClock = useRef<{ clockMs: number; anchorMs: number; teamId: string } | null>(null);
  const setProjection = (next: CryptoBattleProjection) => {
    const receivedAt = Date.now();
    const previous = snapshotClock.current;
    const sameTeam = previous?.teamId === next.vault.teamId;
    // Ignore a late poll that was computed before the operation response.
    if (sameTeam && next.clockMs !== undefined && next.clockMs < previous.clockMs) return;
    const anchorMs = sameTeam && next.clockMs !== undefined
      ? Math.min(receivedAt, previous.anchorMs + next.clockMs - previous.clockMs) : receivedAt;
    snapshotClock.current = next.clockMs === undefined ? null : { clockMs: next.clockMs, anchorMs, teamId: next.vault.teamId };
    setPolledProjection(next);
    setProjectionAtMs(anchorMs);
  };

  useEffect(() => {
    if (polled.projection) setProjection(polled.projection);
  }, [polled.projection]);

  // One second, because that is the resolution the numbers are shown at.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const projection = useMemo(
    () => ageProjection(polledProjection, projectionAtMs === null ? 0 : nowMs - projectionAtMs),
    [polledProjection, projectionAtMs, nowMs],
  );

  const orders = useMemo(() => openOrders(projection), [projection]);
  const selectedOrder = orders.find((order) => order.id === selectedOrderId) ?? orders[0];
  const selectedCipher = selectedOrder?.task.kind === "caesar-shift" ? selectedOrder.task : undefined;
  const cipherFormatExample = selectedCipher?.plaintext
    .map((_, index) => (index + 1) % selectedCipher.symbols.length).join(" ");
  // Pin the initial/fallback choice too: a newly arriving rush Order must not
  // replace the Order whose answer the participant is typing.
  useEffect(() => {
    if (selectedOrder && selectedOrderId !== selectedOrder.id) setSelectedOrderId(selectedOrder.id);
  }, [selectedOrder?.id, selectedOrderId]);
  // [Issue #645] Read from the Order, never re-derived here: the game rules
  // decide which methods an Order accepts, and a portal that recomputed them
  // would be a second implementation free to disagree with the judge.
  const { visible: primaryActionsVisible, leakAllowed, proveAllowed } =
    primaryActionsFor(selectedOrder);
  const nextHint = nextHintFor(selectedOrder);
  const tactics = useMemo(() => tacticAvailability(projection), [projection]);
  const sudokuPressure = useMemo(() => sudokuRotatePressure(projection), [projection]);
  const exposure = useMemo(() => exposureRows(projection), [projection]);
  const usedProveTables = JSON.stringify(projection?.vault.usedPermutations ?? []);
  // Stable across clock updates and equivalent poll responses, private to this client.
  const proveTable = useMemo(() => chooseProveTable(JSON.parse(usedProveTables)),
    [projection?.vault.teamId, projection?.vault.generation, selectedOrder?.id, usedProveTables]);
  const proveGivens = proveTable && projection
    ? sudokuFillInGivens(projection.vault.sudokuSolution, proveTable) : undefined;
  const proveGrid = proveGivens
    ? parseCells(proveCells.map((value, index) => proveGivens[index] || value)) : undefined;
  // [Issue #709 review] A typed grid belongs to the Order (and generation) it
  // was typed for, and a recovered solution to the target it was recovered
  // from. Left in place, a grid that just PROVEd would be one click from being
  // submitted again on the next Order -- the same table twice, which is the
  // exact reuse the HUNT punishes -- and a solution recovered from one team
  // would be one click from being charged as a miss against another. So the
  // buffers empty whenever their context moves.
  const selectedOrderIdForProve = selectedOrder?.id;
  const ownGeneration = projection?.vault.generation;
  useEffect(() => {
    setProveCells(emptyCells());
    setProveOpen(selectedOrderIdForProve?.endsWith("-c0") === true);
    setFheR("");
    setFheY("");
    setMpcPartial("");
    setCipherAnswer("");
  }, [selectedOrderIdForProve, ownGeneration]);
  // [Issue #696] `success` receives the projection the op came back with.
  // An accepted op is not always a success -- a HUNT miss lands and returns
  // ok -- and the projection is the only thing that can say which it was.
  const run = async (
    task: () => Promise<PortalCoordinationOutcome>,
    success: (next: CryptoBattleProjection | undefined) => FeedbackDraft,
  ) => {
    if (submitting) return;
    setSubmitting(true);
    setFeedback(null);
    // [Issue #697] Counted per submission, not per distinct message: two
    // identical rejections in a row are two answers to two questions, and the
    // banner has to say so. Stamped here rather than at each call site so no
    // outcome can be reported without one.
    attemptRef.current += 1;
    const attempt = attemptRef.current;
    try {
      const outcome = await task();
      const next = liveProjection(outcome);
      if (next) setProjection(next);
      if (outcome.kind !== "ok") {
        setFeedback({ kind: "error", title: copy.rejected, body: outcomeError(outcome, locale), attempt });
      } else {
        const draft = success(next);
        if (draft.reward !== undefined && selectedOrder && next?.myContracts.some(order => order.id === selectedOrder.id && order.status === "completed")) {
          setOrderReceipt({ id: selectedOrder.id, points: draft.reward });
        }
        setFeedback({ ...draft, attempt });
      }
    } catch {
      setFeedback({ kind: "error", title: copy.rejected, body: copy.unavailable, attempt });
    } finally {
      setSubmitting(false);
    }
  };

  if (!client) return <p role="status">{locale === "ja" ? "試合に接続できません。ページを再読み込みし、直らなければ運営に連絡してください。" : "Cannot connect to the match. Reload the page; if the problem persists, contact the event organizer."}</p>;
  if (!projection) return <section className="tc-move-shell"><style>{CSS}</style><div role="status">{polled.status === null ? (locale === "ja" ? "最初の更新を待っています" : "Waiting for the first match update") : copy.unavailable}</div></section>;
  {/*
    [Issue #677] Two dead ends used to look identical: a match that had not
    started and a match that was over both rendered the words MATCH ENDED
    against a blank panel, with nothing to press and nothing to read. One of
    them is not an ending at all.
  */}
  if (isWaiting(projection)) {
    return (
      <section className="tc-move-shell" aria-label="crypto-battle-start">
        <style>{CSS}</style>
        <div className="tc-gate">
          <strong className="tc-gate-title">{copy.waitingTitle}</strong>
          <p className="tc-gate-body">{copy.waitingBody}</p>
          {/*
            [Issue #688] READY is the button, not START. The first team to press
            START used to start the match for everyone, including teams that had
            not opened the portal — their Orders began arriving and lapsing at
            -15 each while nobody was there. So the ordinary path says only "I am
            ready", and the match begins when the roster agrees.

            START stays, because a team that never arrives would otherwise hold
            the room forever. It is the second button and it says what it does.
          */}
          <button
            type="button"
            className="tc-start-button"
            disabled={submitting || projection.ready.me}
            onClick={() => void run(
              () => submitReady(client),
              () => ({ kind: "prove", title: copy.readyDone, body: copy.readyCount(projection.ready.count + 1, projection.ready.total) }),
            )}
          >{submitting ? copy.starting : projection.ready.me ? copy.readyDone : copy.ready}</button>
          <p className="tc-gate-note">
            {copy.readyCount(projection.ready.count, projection.ready.total)}
            {" · "}
            {copy.waitingNote(Math.round(matchMinutes(projection)))}
          </p>
          {projection.ready.total > 1 ? (
            <button
              type="button"
              className="tc-start-anyway"
              disabled={submitting}
              onClick={() => void run(
                () => submitStart(client),
                () => ({ kind: "prove", title: copy.startSuccess, body: copy.startBody }),
              )}
            >{copy.startAnyway}</button>
          ) : null}
          {feedback ? <p className="tc-gate-note">{feedback.body}</p> : null}
        </div>
      </section>
    );
  }
  if (isClosed(projection)) {
    return (
      <section className="tc-move-shell" aria-label="crypto-battle-ended">
        <style>{CSS}</style>
        <div className="tc-gate">
          <strong className="tc-gate-title">{copy.ended}</strong>
          <p className="tc-gate-body">{copy.endedBody}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="tc-move-shell" aria-label="crypto-battle-fast-moves">
      <style>{CSS}</style>
      {/*
        [Issue #659] One surface: score, tickets, the counter you work at, then
        the public record. It used to be two host slots — the board in one, the
        controls in another — so the game read as two unrelated screens.
      */}
      <div className="tc-scoreline">
        <div className="tc-scoreline-main">
          <span className="tc-scoreline-label">{copy.scoreLabel}</span>
          <strong className="tc-scoreline-value">
            {projection.teams[projection.vault.teamId]?.score ?? 0}
          </strong>
        </div>
        <span className="tc-scoreline-hint">{copy.scoreHint}</span>
        <div className="tc-rival-score">{Object.values(projection.teams).filter(t => t.teamId !== projection.vault.teamId).map(t => <span key={t.teamId}>{locale === "ja" ? "相手" : "Opponent"} · {t.teamName || t.teamId} <strong>{t.score} {locale === "ja" ? "点" : "pt"}</strong></span>)}</div>
      </div>
      <BreachNotice key={`${props.team.eventId}:${projection.vault.teamId}:${projection.lastBreach?.sequence ?? 0}`} projection={projection} locale={locale} onDefend={()=>{
        const defense=document.getElementById("tc-breach-defense");
        defense?.scrollIntoView({block:"center",behavior:"smooth"});
        defense?.focus({preventScroll:true});
      }} />
      <RpsResult projection={projection} locale={locale} />
      <RpsHuntStatus projection={projection} locale={locale} />
      <OrderQueue key={`${props.team.eventId}:${projection.vault.teamId}`} projection={projection} locale={locale}
        selectedId={selectedOrder?.id} receipt={orderReceipt}
        onSelect={(id) => {
          setSelectedOrderId(id);
          setProveOpen(false);
          setFeedback(null);
          workspaceRef.current?.scrollIntoView({ block: "start" });
        }} />

      <div ref={feedbackRef} tabIndex={-1} className="tc-result-anchor" aria-live="polite" aria-atomic="true">
        {feedback && <FeedbackBanner key={feedback.attempt} feedback={{ ...feedback, total: projection.teams[projection.vault.teamId]?.score }} locale={locale} onContinue={orders.length ? () => { setFeedback(null); workspaceRef.current?.scrollIntoView({ block: "start" }); } : undefined} />}
      </div>

      <section ref={workspaceRef} className="tc-workspace" aria-label={locale === "ja" ? "いま答えるお題" : "Current Order"}>
      {selectedOrder && (
        <div className={`tc-ticket${selectedOrder.remainingMs <= 30_000 ? " tc-ticket-urgent" : ""}`}>
          <div className="tc-ticket-head">
            <span>{locale === "ja" ? "いまのお題" : "Current Order"} · {selectedOrder.id.replace(/^.*-c/, "ORDER #")}</span>
            <span className="tc-ticket-clock">{Math.ceil(selectedOrder.remainingMs / 1000)}s</span>
          </div>
          <h2 className="tc-order-heading">{proveAllowed && (proveOpen || selectedOrder.task.kind === "zk-sudoku") ? (locale === "ja" ? (selectedOrder.schnorr ? "ゼロ知識証明：秘密を送らず、応答を計算しよう" : "数独の模型：数字を置き換えて4マスを完成") : (selectedOrder.schnorr ? "Zero-knowledge proof: calculate a response without sending your secret" : "Sudoku model: rename the digits and complete four cells")) : orderHeading(selectedOrder, locale)}</h2>
          <div className="tc-ticket-track" aria-hidden="true">
            <div
              className="tc-ticket-fill"
              style={{ width: `${Math.max(2, Math.min(100, (selectedOrder.remainingMs / (selectedOrder.durationMs ?? 300_000)) * 100))}%` }}
            />
          </div>

        </div>
      )}

      {(projection.lightning?.status === "available" || projection.lightning?.status === "armed" || projection.lightning?.status === "spent") && <Lightning projection={projection} order={selectedOrder} locale={locale} busy={submitting}
        onSelect={id => { setSelectedOrderId(id); setProveOpen(false); }}
        onDeclare={id => void run(() => submitDeclareLightning(client, id), next => ({
          kind: next?.lightning?.status === "armed" && next.lightning.contractId === id ? "hint" : "error",
          title: locale === "ja" ? "ライトニングの指定" : "Lightning declaration",
          body: next?.lightning?.status === "armed" && next.lightning.contractId === id
            ? locale === "ja" ? `このお題の計算正解で +${next.lightning.points} 点。続けて解答してください。` : `A correct calculation on this Order earns +${next.lightning.points}. Continue to your answer.`
            : locale === "ja" ? "指定結果を読み取れませんでした。お題とカードの状態を確認してください。" : "Could not read the declaration result. Check the Order and card.",
        }))} />}

      {primaryActionsVisible && selectedOrder?.task.kind !== "zk-sudoku" && (
      <div>
        {proveOpen ? <div className="tc-chosen-method">
          <strong>{locale === "ja" ? `秘密を守って証明する · +${selectedOrder?.points} 点` : `PROVE · +${selectedOrder?.points} pt`}</strong>
          <button type="button" onClick={() => setProveOpen(false)}>{locale === "ja" ? "答え方を選び直す" : "Change answer method"}</button>
        </div> : <>
        <div className="tc-card-title">{copy.choose}</div>
        {/*
          [Issue #702] The noun, then the move, before the two buttons. Placed
          here and not in `QuickRules` because this is where the player is
          looking when they have to decide, and it is the only Order whose whole
          difficulty is knowing what it is asking for.
        */}
        {selectedOrder?.task.kind === "reveal-share" && (
          <p className="tc-share-primer">
            <span>{locale === "ja"
              ? `秘密分散：秘密を複数の数（シェア）に分けて保管。${projection.vault.shares.length} 個中 ${projection.threshold} 個で元の秘密を復元できます。`
              : `Secret sharing splits a secret into numbers called shares. Any ${projection.threshold} of ${projection.vault.shares.length} shares recover it.`}</span>
            {/*
              [Issue #740] The disclosure Order says what it is before the one
              button below it: the rules are asking for the share, it pays
              what computing would, and the cost is the exposure it adds --
              which the LEAK button's risk line counts. ROTATE is the way to
              retire that exposure, at the price of the Orders still open.
            */}
            {selectedOrder.privacyConstraint === "must-disclose" && (
              <span className="tc-share-primer-rule">{locale === "ja"
                ? " この依頼はかけらの公開が条件です。得点は計算と同じ満額で、未公開の番号なら公開数が増え、同じ番号なら増えません。公開専用Orderに答えた世代のROTATEは、未処理が0件でも最低1件分の失効点がかかります。増やしたくなければ、先に ROTATE で世代を変えます (開いている依頼は無効になります)。"
                : " This request requires publishing the share. It pays the full computing rate; a new index increases exposure; a duplicate does not. After fulfilling a disclosure Order, ROTATE costs at least one expiry penalty even with no unfinished work. To avoid that, ROTATE to a new generation first (open Orders are voided)."}</span>
            )}
          </p>
        )}
        <div className="tc-primary-actions">
          {(selectedOrder?.task.kind === "rotor-encrypt" || selectedOrder?.task.kind === "caesar-shift" || selectedOrder?.task.kind === "rsa-encrypt") && selectedOrder.allowedMethods.includes("cipher") && <button
            type="button"
            className="tc-action tc-prove-button"
            aria-controls="tc-cipher-answer"
            onClick={() => {
              cipherInputRef.current?.focus({ preventScroll: true });
              cipherInputRef.current?.scrollIntoView({ block: "center" });
            }}
          >
            <span className="tc-action-heading"><span>{locale === "ja" ? "計算して暗号化する" : selectedOrder.task.kind === "rsa-encrypt" ? "Calculate the encrypted number" : "Calculate the encrypted row"}</span><b>+{selectedOrder.points} {locale === "ja" ? "点" : "pt"}</b></span>
            <small>{selectedOrder.task.kind === "rotor-encrypt" ? (locale === "ja" ? "CIPHER · 表を引き、位置を進める" : "CIPHER · Look up tables and advance positions") : selectedOrder.task.kind === "rsa-encrypt" ? (locale === "ja" ? "CIPHER · 繰り返し掛けて余りを取る" : "CIPHER · Multiply repeatedly and take remainders") : (locale === "ja" ? "CIPHER · 各数字に鍵を足す" : "CIPHER · Add the key to each value")}</small>
            <span className="tc-action-risk">{selectedOrder.task.kind === "rsa-encrypt" ? (locale === "ja" ? "元の数と暗号の答えは公開しません。" : "The original and encrypted answer stay private.") : (locale === "ja" ? "元の列と暗号の組は公開しません。" : "The plaintext/ciphertext pair stays private.")}</span>
          </button>}
          {leakAllowed && <button
            type="button"
            className="tc-action tc-leak-button"
            disabled={!selectedOrder || submitting || !leakAllowed}
            title={selectedOrder && !leakAllowed ? copy.leakBlocked : undefined}
            onClick={() => selectedOrder && void run(
              () => submitLeak(client, selectedOrder.id),
              // [Issue #659] The confirmation has to name what actually became
              // public. A ladder LEAK publishes the row next to its answer, not
              // a share -- reporting "share → PUBLIC LEDGER" for it told the
              // participant the wrong thing about the one move whose whole cost
              // is what it publishes.
              () => ({
                kind: "leak",
                title: copy.leakSuccess,
                reward: selectedOrder.leakPoints,
                body:
                  selectedOrder.task.kind === "rotor-encrypt"
                    ? (locale === "ja" ? "元の4文字と暗号の4文字を公開しました。1組で初期位置を特定される場合もあります。" : "Published the four original and encrypted digits. Even one pair may reveal the initial positions.")
                    : selectedOrder.task.kind === "rsa-encrypt"
                    ? (locale === "ja" ? "元の数 m と暗号の答え c を公開しました。公開鍵だけでも因数分解で攻撃できます。" : "Published original m and encrypted answer c. The public key alone already allows a factoring attack.")
                    : selectedOrder.task.kind === "caesar-shift"
                    ? selectedOrder.task.rung === "vigenere"
                      ? `+${selectedOrder.leakPoints} · ${locale === "ja" ? `鍵の位置${(selectedOrder.task.keyPosition ?? 0) + 1}の元と答えを公開しました。異なる3位置が揃うと全鍵が分かります。` : `Published the original and answer at key position ${(selectedOrder.task.keyPosition ?? 0) + 1}. Three distinct positions reveal all keys.`}`
                      : copy.leakPairBody(selectedOrder.leakPoints, selectedOrder.task.pairsToBreak)
                    : copy.leakBody(
                        selectedOrder.leakPoints,
                        selectedOrder.task.kind === "reveal-share" ? selectedOrder.task.shareIndices : [],
                      ),
              }),
            )}
          >
            <span className="tc-action-heading"><span>{locale === "ja" ? "公開して答える" : "Publish to answer"}</span><b>+{selectedOrder?.leakPoints} {locale === "ja" ? "点" : "pt"}</b></span>
            <small>LEAK · {copy.leakHint}</small>
            <span className="tc-action-risk">{selectedOrder && disclosurePreview(projection, selectedOrder, locale)}</span>
          </button>}
          {proveAllowed && <button
            type="button"
            className="tc-action tc-prove-button"
            aria-expanded={proveOpen}
            disabled={!selectedOrder || submitting || !proveAllowed}
            title={selectedOrder && !proveAllowed ? copy.proveBlocked : undefined}
            onClick={() => setProveOpen((value) => !value)}
          >
            <span className="tc-action-heading"><span>{locale === "ja" ? "秘密を守って証明する" : "Prove while protecting your secret"}</span><b>+{selectedOrder?.points} {locale === "ja" ? "点" : "pt"}</b></span>
            <small>PROVE · {selectedOrder?.schnorr ? (locale === "ja" ? "先に a を送る → 届いた e で応答を計算" : "Send a → calculate a response to e") : copy.proveHint}</small>
            <span className="tc-action-risk">{selectedOrder?.schnorr ? (locale === "ja" ? "シェアは公開せず、検証できる会話 (a,e,z) を公開します。" : "Publishes the verifiable transcript (a,e,z), without a share.") : (locale === "ja" ? "シェアは公開せず、数独模型の一部を公開します。" : "Publishes part of the Sudoku model, without a share.")}</span>
          </button>}
        </div>
        {selectedOrder?.task.kind === "reveal-share" && <ConceptExplanation key={selectedOrder.id} locale={locale} topic="sharing" task={selectedOrder.task} prime={projection.prime} />}
        </>}
      </div>
      )}

      {/*
        [Issue #645 Phase 2] Everything the participant needs is on screen: the
        Order's two ciphertexts, and two boxes for the answer. The panel does
        NOT compute it for them -- the whole exercise is performing an operation
        on data you cannot read, and a "compute for me" button would delete it.
      */}
      {selectedOrder?.task.kind === "homomorphic-sum" && (
        <div className="tc-input-panel">
          <strong style={{ fontSize: "12px" }}>{copy.fheTitle} · {selectedOrder.id.replace(/^.*-c/, "ORDER #")}</strong>
          <div className="tc-lesson">
            <div className="tc-lesson-use">{copy.fheUse}</div>
            <div className="tc-lesson-why">{copy.fheWhy}</div>
          </div>
          <p className="tc-card-hint">{locale === "ja" ? `左どうし・右どうしを足し、それぞれ ${projection.prime} で割った余りを入力します。合計が ${projection.prime} 未満なら、その数のままです。` : `Add the left numbers and the right numbers separately. Enter each remainder after division by ${projection.prime}; a smaller total stays unchanged.`}</p>
          <label className="tc-answer-label">{locale === "ja" ? "① 左の数を足す" : "1. Add the left numbers"}
            <div><code>{selectedOrder.task.inputs.map(input => input.r).join(" + ")}</code> → {locale === "ja" ? `${projection.prime} で割った余り` : `remainder after division by ${projection.prime}`}</div>
            <input aria-label="fast-fhe-r" inputMode="numeric" value={fheR} onChange={(event) => setFheR(event.target.value)} placeholder={locale === "ja" ? "左の答え" : "Left answer"} />
          </label>
          <label className="tc-answer-label">{locale === "ja" ? "② 右の数を足す" : "2. Add the right numbers"}
            <div><code>{selectedOrder.task.inputs.map(input => input.y).join(" + ")}</code> → {locale === "ja" ? `${projection.prime} で割った余り` : `remainder after division by ${projection.prime}`}</div>
            <input aria-label="fast-fhe-y" inputMode="numeric" value={fheY} onChange={(event) => setFheY(event.target.value)} placeholder={locale === "ja" ? "右の答え" : "Right answer"} />
          </label>
          <ConceptExplanation key={selectedOrder.id} locale={locale} topic="fhe" task={selectedOrder.task} prime={projection.prime} />
          <button
            type="button"
            className="tc-submit-small tc-fhe-button"
            disabled={submitting || !fheR.trim() || !fheY.trim()}
            onClick={() => void run(
              () => submitFhe(client, selectedOrder.id, { r: fheR.trim(), y: fheY.trim() }),
              (next) => { const points = next?.myContracts.find(c => c.id === selectedOrder.id && c.status === "completed")?.points ?? selectedOrder.points; return { kind: "prove", title: copy.fheSuccess, body: copy.fheBody(points), reward: points, lesson: copy.fheLesson }; },
            )}
          >{submitting ? copy.running : `${copy.fhe} · +${selectedOrder.points}`}</button>
        </div>
      )}

      {/*
        [Issue #659] The ladder Order's working surface.

        Everything a participant needs is on screen at once: the row to encrypt,
        the alphabet that defines the modulus, and their own key. The key
        arrives on this Order's projection because it belongs to this team --
        the same boundary the MPC panel below already sits on.

        The cost of NOT doing the calculation is stated here rather than left to
        the LEAK button, because this is the moment the choice is actually made.
      */}
      {(selectedOrder?.task.kind === "rotor-encrypt" || selectedOrder?.task.kind === "caesar-shift" || selectedOrder?.task.kind === "rsa-encrypt") && (
        <div id="tc-cipher-answer" className="tc-input-panel">
          <strong style={{ fontSize: "12px" }}>{selectedOrder.task.kind === "rotor-encrypt" ? "Rotor · CIPHER" : selectedOrder.task.kind === "rsa-encrypt" ? "RSA · CIPHER" : copy.cipherTitle} · {selectedOrder.id.replace(/^.*-c/, "ORDER #")}</strong>
          {selectedOrder.task.kind === "caesar-shift" && selectedOrder.task.rung === "vigenere" && <CipherScoring order={selectedOrder} wrongCost={projection.wrongProveCost} locale={locale} />}
          {selectedOrder.task.kind === "rotor-encrypt" ? <RotorMaterials task={selectedOrder.task} locale={locale} /> : selectedOrder.task.kind === "rsa-encrypt" ? <RsaMaterials task={selectedOrder.task} locale={locale} /> : selectedOrder.task.rung === "vigenere" ? <VigenereMaterials task={selectedOrder.task} locale={locale} /> : <>
          <div className="tc-lesson">
            <div className="tc-lesson-use">{copy.cipherUse}</div>
            <div className="tc-lesson-why">{copy.cipherWhy}</div>
          </div>
          <div className="tc-card-hint">{copy.cipherHelp}</div>
          <ConceptExplanation key={selectedOrder.id} locale={locale} topic="caesar" task={selectedOrder.task} prime={projection.prime} />
          <ul className="tc-material-list">
            <li>
              {copy.cipherAlphabet}:
              <span className="tc-die-legend">
                {selectedOrder.task.symbols.map((symbol, value) => (
                  <span className="tc-die-legend-item" key={symbol}>
                    <DieFace value={value} size={20} />
                    <small>{value}</small>
                  </span>
                ))}
              </span>
            </li>
            <li><DieRow values={selectedOrder.task.plaintext} size={28} /></li>
            <li>{copy.cipherKey}: <code>{String(selectedOrder.task.myKey)}</code></li>
          </ul>
          <div className="tc-card-warn">{copy.cipherCost(selectedOrder.task.pairsToBreak)}</div>
          </>}
          {(selectedOrder.task.kind === "rsa-encrypt" || selectedOrder.task.kind === "rotor-encrypt") && <CipherScoring order={selectedOrder} wrongCost={projection.wrongProveCost} locale={locale} />}
          {selectedOrder.task.kind === "caesar-shift" && <p id="tc-caesar-input-format" className="tc-card-hint">
            {selectedOrder.task.plaintext.length === 1
              ? (locale === "ja" ? "暗号にした数字を1個だけ入力してください。" : "Enter one encrypted number.")
              : locale === "ja"
              ? `暗号にした数字を、左から順に ${selectedOrder.task.plaintext.length} 個、半角スペースで区切って入力してください。`
              : `Enter all ${selectedOrder.task.plaintext.length} encrypted numbers in left-to-right order, separated by spaces.`}
            {selectedOrder.task.plaintext.length > 1 && <><br />{locale === "ja" ? "区切り方の例：" : "Spacing example: "}<code>{cipherFormatExample}</code></>}
          </p>}
          <input
            ref={cipherInputRef}
            aria-describedby={selectedOrder.task.kind === "caesar-shift" ? "tc-caesar-input-format" : undefined}
            aria-label="fast-cipher-answer"
            value={cipherAnswer}
            onChange={(event) => setCipherAnswer(event.target.value)}
            placeholder={selectedOrder.task.kind === "rotor-encrypt" ? (locale === "ja" ? "暗号の4文字（0〜3、空白区切り）" : "Four encrypted digits (0–3, spaces)") : selectedOrder.task.kind === "rsa-encrypt" ? (locale === "ja" ? "暗号の答え（整数1個）" : "Encrypted answer (one integer)") : selectedOrder.task.kind === "caesar-shift" ? (selectedOrder.task.plaintext.length === 1 ? (locale === "ja" ? "数字1個" : "One number") : (locale === "ja" ? "数字を半角スペースで区切って入力" : "Numbers separated by spaces")) : copy.cipherAnswer}
          />
          <button
            type="button"
            className="tc-submit-small tc-cipher-button"
            disabled={submitting || !cipherAnswer.trim()}
            onClick={() => void run(
              () => submitCipher(client, selectedOrder.id, cipherAnswer.trim().split(/\s+/)),
              (next) => cipherFeedback(next, selectedOrder.id, locale),
            )}
          >{submitting ? copy.running : `${copy.cipher} · +${selectedOrder.points}`}</button>
        </div>
      )}

      {/*
        [Issue #645 Phase 3] The team's own number and its four masks are shown
        here and nowhere else -- they arrive on this Order's projection because
        it belongs to this team. What leaves the browser is the subtotal only.
      */}
      {selectedOrder?.task.kind === "rps-duel" && selectedOrder.allowedMethods.includes("duel") && <RpsDuel
        key={`${projection.vault.teamId}:${selectedOrder.id}`} order={selectedOrder} locale={locale} submitting={submitting}
        opponentName={projection.teams[selectedOrder.task.opponentTeamId]?.teamName ?? selectedOrder.task.opponentTeamId}
        prediction={<RpsOrderPrediction order={selectedOrder} projection={projection} locale={locale} submitting={submitting}
          onSubmit={op => run(() => client.submitOp(op), next => next ? ({ kind: "hunt", title: locale === "ja" ? "予測を預けました" : "Prediction submitted", body: locale === "ja" ? "まだ採点していません。回答欄で開封の進み具合を確認できます。" : "Not scored yet. The answer area shows opening progress." }) : ({ kind: "error", title: copy.rejected, body: copy.unavailable }))} />}
        onSubmit={op => run(() => client.submitOp(op), next => next ? ({ kind: "prove", title: locale === "ja" ? (op.kind === "rps-commit" ? "数字を封じました" : "手を審判へ渡しました") : (op.kind === "rps-commit" ? "Number sealed" : "Opening submitted"), body: locale === "ja" ? "じゃんけんの進み具合は回答欄、決着した勝敗と点数は上に表示されます。" : "The answer area shows progress; a settled result and points appear above." }) : ({ kind: "error", title: locale === "ja" ? "結果を確認できません" : "Result unavailable", body: copy.unavailable }))}
      />}
      {selectedOrder?.task.kind === "anamorphic-rejection" && <AnamorphicWorksheet wrongCost={projection.wrongProveCost} key={`anamorphic:${selectedOrder.id}`} task={selectedOrder.task} locale={locale} busy={submitting} onSubmit={answer=>void run(
        ()=>client.submitOp({kind:"anamorphic",contractId:selectedOrder.id,answer}),
        next=>{
          if(!next)return {kind:"error",title:copy.unavailable,body:copy.unavailable};
          const hit=next.myContracts.some(c=>c.id===selectedOrder.id&&c.status==="completed");
          const delta=next.myContracts.find(c=>c.id===selectedOrder.id)?.lastSubmissionPoints;
          if(delta===undefined)return {kind:"error",title:copy.unavailable,body:copy.unavailable};
          return hit?{kind:"prove",reward:orderReward(selectedOrder,next),title:locale==="ja"?"暗号文の選択・復号・確率計算に成功！":"Ciphertext selection, decryption and probability complete!",body:locale==="ja"?"通常鍵の復号と、乱数くじを変えたときの送信確率を確認できました。":"You checked ordinary decryption and sending probability under changed randomness."}:{kind:"error",title:locale==="ja"?"比較結果が違います":"Incorrect comparison",body:locale==="ja"?`${delta} 点。上から順に、候補の選択・復号・受理くじの合計を確認してください。`:`${delta} pt. Check candidate selection, decryption and total accepted tickets.`};
        }
       )}/> }
      {selectedOrder?.task.kind === "stark-trace" && <StarkWorksheet wrongCost={projection.wrongProveCost} key={`stark:${selectedOrder.id}`} task={selectedOrder.task} locale={locale} busy={submitting} onSubmit={answer=>void run(
        ()=>client.submitOp({kind:"stark",contractId:selectedOrder.id,answer}),
        next=>{
          if(!next)return {kind:"error",title:copy.unavailable,body:copy.unavailable};
          const hit=next.myContracts.some(c=>c.id===selectedOrder.id&&c.status==="completed");
          const delta=next.myContracts.find(c=>c.id===selectedOrder.id)?.lastSubmissionPoints;
          if(delta===undefined)return {kind:"error",title:copy.unavailable,body:copy.unavailable};
          return hit?{kind:"prove",reward:orderReward(selectedOrder,next),title:locale==="ja"?"実行表と折り畳みの検査に成功！":"Trace and fold check complete!",body:locale==="ja"?"実行表のずれと折り畳みを別々に確認できました。":"You checked execution mismatches and the fold separately."}:{kind:"error",title:locale==="ja"?"比較結果が違います":"Incorrect comparison",body:locale==="ja"?`${delta} 点。上から順に、7で割った余りを確認してください。`:`${delta} pt. Check the four remainders by 7 in order.`};
        }
       )}/> }
      {selectedOrder?.task.kind === "io-equivalence" && <IoWorksheet wrongCost={projection.wrongProveCost} key={`io:${selectedOrder.id}`} task={selectedOrder.task} locale={locale} busy={submitting} onSubmit={answer=>void run(
        ()=>client.submitOp({kind:"io",contractId:selectedOrder.id,answer}),
        next=>{
          if(!next)return {kind:"error",title:copy.unavailable,body:copy.unavailable};
          const hit=next.myContracts.some(c=>c.id===selectedOrder.id&&c.status==="completed");
          const delta=next.myContracts.find(c=>c.id===selectedOrder.id)?.lastSubmissionPoints;
          if(delta===undefined)return {kind:"error",title:copy.unavailable,body:copy.unavailable};
          return hit?{kind:"prove",reward:orderReward(selectedOrder,next),title:locale==="ja"?"計算と分布の比較に成功！":"Function and distribution check complete!",body:locale==="ja"?"同じ機能かどうかと、公開データの分布を別々に確認できました。":"You checked functional equivalence and the published distributions separately."}:{kind:"error",title:locale==="ja"?"比較結果が違います":"Incorrect comparison",body:locale==="ja"?`${delta} 点。空欄の余りと、rを含む公開データの組を確認してください。`:`${delta} pt. Check the missing remainders and complete outcomes including r.`};
        }
       )}/> }
      {(selectedOrder?.task.kind === "enigma-encrypt" || selectedOrder?.task.kind === "ecdsa-sign" || selectedOrder?.task.kind === "rsa-decrypt") && <EvolutionWorksheet wrongCost={projection.wrongProveCost} key={`evolution:${selectedOrder.id}`} task={selectedOrder.task} locale={locale} busy={submitting} onSubmit={answer=>void run(
        ()=>client.submitOp({kind:"evolution",contractId:selectedOrder.id,answer}), next=>{
          if(!next)return {kind:"error",title:copy.unavailable,body:copy.unavailable};
          const result=next.myContracts.find(c=>c.id===selectedOrder.id);
          if(result?.lastSubmissionPoints===undefined)return {kind:"error",title:copy.unavailable,body:copy.unavailable};
          return result.status==="completed"?{kind:"prove",reward:orderReward(selectedOrder,next),title:locale==="ja"?"正解！":"Correct!",body:locale==="ja"?"式を使って変換できました。":"You completed the transformation."}:{kind:"error",title:locale==="ja"?"表と余りを確認してください":"Check the table and remainders",body:`${result.lastSubmissionPoints} pt`};
        }
      )}/>}
      {selectedOrder?.task.kind === "snark-constraints" && <SnarkWorksheet wrongCost={projection.wrongProveCost} key={`snark:${selectedOrder.id}`} task={selectedOrder.task} locale={locale} busy={submitting} onSubmit={answer=>void run(
        ()=>client.submitOp({kind:"snark",contractId:selectedOrder.id,answer}), next=>{
          if(!next)return {kind:"error",title:copy.unavailable,body:copy.unavailable};
          const hit=next.myContracts.some(c=>c.id===selectedOrder.id&&c.status==="completed");
          const delta=next.myContracts.find(c=>c.id===selectedOrder.id)?.lastSubmissionPoints;
          if(delta===undefined)return {kind:"error",title:copy.unavailable,body:copy.unavailable};
          return hit?{kind:"prove",reward:orderReward(selectedOrder,next),title:locale==="ja"?"制約の検査に成功！":"Constraint check complete!",body:answer.split(" ").every(v=>v==="0")?(locale==="ja"?"全て0：計算も配線も一致しています。":"All zero: gates and wires agree."):(locale==="ja"?"0でない箇所があり、不正な計算か配線を検出しました。":"Nonzero remainders expose incorrect gates or wires.")}:{kind:"error",title:locale==="ja"?"余りを確認してください":"Check the remainders",body:`${delta} pt`};
        }
      )}/>}
      {selectedOrder?.task.kind === "ec-add" && <EcWorksheet key={`ec:${selectedOrder.id}`} task={selectedOrder.task} locale={locale} busy={submitting} onSubmit={answer=>void run(
        ()=>client.submitOp({kind:"ec",contractId:selectedOrder.id,answer}),
        next=>{
          if(!next)return {kind:"error",title:copy.unavailable,body:copy.unavailable};
          const hit=next.myContracts.some(c=>c.id===selectedOrder.id&&c.status==="completed");
          const delta=next.myContracts.find(c=>c.id===selectedOrder.id)?.lastSubmissionPoints;
          if(delta===undefined)return {kind:"error",title:copy.unavailable,body:copy.unavailable};
          return hit?{kind:"prove",reward:orderReward(selectedOrder,next),title:locale==="ja"?"点加算に成功！":"Point addition complete!",body:`P + Q = ${answer}`,lesson:locale==="ja"?"点加算を繰り返すと、秘密の整数から公開鍵の点を作る計算につながります。":"Repeated point addition turns a private integer into a public-key point."}:{kind:"error",title:locale==="ja"?"答えが違います":"Incorrect point",body:locale==="ja"?`${delta} 点。傾き、x、yの順に、7で割った余りを確認してください。`:`${delta} pt. Check the slope, x, and y remainders modulo7.`};
        }
      )}/>}

      {selectedOrder?.task.kind === "masked-total" && (
        <div className="tc-input-panel">
          <strong style={{ fontSize: "12px" }}>{copy.mpcTitle} · {selectedOrder.id.replace(/^.*-c/, "ORDER #")}</strong>
          <p className="tc-card-hint">{locale === "ja" ? "秘密計算（MPC）は、自分の数を明かさず、みんなで計算する技術です。ここではランダムに選んだ数を内緒で交換して、自分の数を隠します。この隠す数をマスクと呼びます。" : "MPC computes together without revealing each input. Here, participants privately exchange random numbers to hide their inputs. These hiding numbers are called masks."}</p>
          <MpcMaskDiagram locale={locale} />
          <MpcWorksheet task={selectedOrder.task} prime={projection.prime} locale={locale} />
          <label className="tc-answer-label">{copy.mpcAnswer} · {locale === "ja" ? `④ の答えを 1 つ入力（0〜${BigInt(projection.prime) - 1n}）` : `Enter the result of step 4 (0–${BigInt(projection.prime) - 1n})`}
            <input aria-label={copy.mpcAnswer} inputMode="numeric" value={mpcPartial} onChange={(event) => setMpcPartial(event.target.value)} placeholder={locale === "ja" ? "最後に出た数" : "Your final number"} />
          </label>
          <button
            type="button"
            className="tc-submit-small tc-mpc-button"
            disabled={submitting || !mpcPartial.trim()}
            onClick={() => void run(
              () => submitMpc(client, selectedOrder.id, mpcPartial.trim()),
              (next) => { const points = next?.myContracts.find(c => c.id === selectedOrder.id && c.status === "completed")?.points ?? selectedOrder.points; return { kind: "prove", title: copy.mpcSuccess, body: `${copy.mpcBody(points)} · ${copy.mpcAnswer}: ${mpcPartial.trim()}`, reward: points, lesson: copy.mpcLesson }; },
            )}
          >{submitting ? copy.running : `${copy.mpc} · +${selectedOrder.points}`}</button>
          <ConceptExplanation key={selectedOrder.id} locale={locale} topic="mpc" task={selectedOrder.task} prime={projection.prime} />
          <details className="tc-why"><summary>{locale === "ja" ? "なぜ、足し引きすると秘密が隠れる？" : "Why do these additions and subtractions hide my input?"}</summary><p className="tc-card-hint">{copy.mpcWhy}</p></details>
        </div>
      )}

      {/*
        [Issue #645] Gated on the task, not only on `proveOpen`. The LEAK/PROVE
        buttons above are already task-gated, but this editor is a separate
        block: leaving it ungated let a participant open it on a share Order,
        select an FHE Order, and submit a PROVE the new Order cannot accept.
        `setProveOpen(false)` on selection is the other half — a form that
        reappears still bound to a different Order is its own surprise.

        The participant chooses the relabelling and completes four cells;
        twelve worked cells reduce transcription under the five-minute limit.
        The judge still receives and checks the complete grid. Used tables stay
        selectable so reuse remains a real decision, with its risk labelled.
      */}
      {(proveOpen || selectedOrder?.task.kind === "zk-sudoku") && selectedOrder?.schnorr && proveAllowed && <SchnorrProof key={`schnorr:${selectedOrder.id}`} order={selectedOrder} teamId={projection.vault.teamId} locale={locale} busy={submitting} onSubmit={op=>void run(()=>client.submitOp(op),next=>{
        if(op.kind === "schnorr-commit") return {kind:"hint",title:locale === "ja"?"検証者から e が届きました":"Verifier challenge received",body:locale === "ja"?"下の③で応答 z を計算してください。":"Calculate response z in step ③ below."};
        const proof=next?.publicLedger.find(entry=>entry.kind === "proof" && entry.contractId === selectedOrder.id);
        return proof?.kind === "proof" && proof.publicKey ? {kind:"prove",reward:selectedOrder.points,title:locale === "ja"?"証明成功！":"Proof verified!",body:`${locale === "ja" ? "検証式が一致" : "Verification matches"}: ${power(2,Number(proof.response))} = ${Number(proof.commitment)*power(Number(proof.publicKey),Number(proof.challenge))%23}。${locale === "ja"?"秘密 x を送らず検証できました。":"Verified without sending x."}`} : {kind:"error",title:locale === "ja"?"検証式が一致しません":"Verification failed",body:selectedOrder.allowedMethods.length === 1 ? (locale === "ja" ? "このお題は不合格で終了しました。追加の期限切れ減点はありません。次のお題へ進んでください。" : "This Order ended with a failed proof. No additional deadline penalty applies. Continue to the next Order.") : (locale === "ja" ? "応答は1回だけです。期限までにLEAKへ切り替えるか、次のお題へ進んでください。" : "Only one proof response is accepted. Switch to LEAK before the deadline or continue to the next Order.")};
      })} />}
      {(proveOpen || selectedOrder?.task.kind === "zk-sudoku") && selectedOrder && !selectedOrder.schnorr && proveAllowed && (
        <div className="tc-input-panel tc-proof-inputs">
          <strong>{locale === "ja" ? "青い4マスに、置き換えた数字を入力" : "Fill the four blue cells with the renamed digits"}</strong>

          <div className="tc-card-hint">{copy.proveHelp}</div>
          {!proveTable && <p role="status">{locale === "ja" ? "この世代の置き換えをすべて使いました。下の「秘密を作り直す」で新しい世代に進めます。" : "All replacements in this generation have been used. Use the defense control below to start a new generation."}</p>}
          {proveTable && <div className="tc-prove-table">
            <strong>{locale === "ja" ? "今回の置き換え" : "Replacements for this answer"}</strong>
            <PermutationChips pi={proveTable} />
            <p className="tc-card-hint">{locale === "ja" ? "矢印の左が元の数字、右が入力する数字です。どのマスでも同じ表を使います。" : "The arrow points from the original digit to the digit to enter. Use the same table for every cell."}</p>
          </div>}
          {proveTable && proveGivens && <>
          <RelabelDiagram solution={projection.vault.sudokuSolution} table={proveTable} locale={locale} />
          <div className="tc-sudoku-row">
            <div className="tc-sudoku-block">
              <span className="tc-sudoku-caption">{copy.proveSolution}</span>
              <SudokuBoard cells={projection.vault.sudokuSolution} size={44} lit={proveGivens.map((v, i) => v ? -1 : i).filter(i => i >= 0)} label="my-solution" />
            </div>
            <div className="tc-sudoku-block">
              <span className="tc-sudoku-caption">{copy.proveGrid}</span>
              <SudokuInput numberedHoles size={44} value={proveCells} givens={proveGivens} onChange={setProveCells} ariaLabel="fast-prove-grid" />
            </div>
          </div>
          </>}
          {projection.vault.usedPermutations.length > 0 && <div className="tc-card-hint">
            {copy.proveUsed}:{" "}
            {projection.vault.usedPermutations.length === 0
              ? copy.proveNoneUsed
              : projection.vault.usedPermutations.map((pi) => (
                  <span key={pi.join("")} style={{ marginRight: 8 }}><PermutationChips pi={pi} /></span>
                ))}
          </div>}
          <button
            type="button"
            className="tc-submit-small tc-prove-submit"
            disabled={submitting || proveGrid === undefined}
            title={proveGrid === undefined ? copy.proveIncomplete : undefined}
            onClick={() => proveGrid && void run(
              () => submitProveSudoku(client, selectedOrder.id, proveGrid),
              // [Issue #709] Hit or miss is read off the projection the op
              // came back with -- a wrong grid lands and returns ok. A hit
              // empties the grid: that relabelling is spent now, and the next
              // Order needs a different one. A miss keeps it, to be corrected.
              (next) => {
                const draft = proveFeedback(next, selectedOrder.id, selectedOrder.points, locale);
                if (draft.kind === "prove") { setProveCells(emptyCells()); }
                return draft;
              },
            )}
          >{submitting ? copy.running : `${copy.send} · +${selectedOrder.points}`}</button>
          <ConceptExplanation key={selectedOrder.id} locale={locale} topic="zk" task={selectedOrder.task} prime={projection.prime} />
          <details className="tc-why">
            <summary>{locale === "ja" ? "何を証明している？" : "What am I proving?"}</summary>
            <div className="tc-lesson-use">{copy.proveUse}</div>
            <div className="tc-lesson-why">{copy.proveWhy}</div>
          </details>
        </div>
      )}

      {projection.hintBooster?.status === "active" && <HintBooster projection={projection} locale={locale} />}
      {selectedOrder ? (
          <details className="tc-hints" key={selectedOrder.id}>
            <summary>{locale === "ja" ? `このお題のヒント${nextHint ? (nextHint.cost === 0 ? "（次は減点なし）" : `（次は −${nextHint.cost} 点）`) : "（すべて開いた）"}` : `Hints for this Order${nextHint ? (nextHint.cost === 0 ? " (next: no penalty)" : ` (next: −${nextHint.cost})`) : " (all opened)"}`}</summary>
            <div className="tc-card-hint">{copy.hintsHint}</div>
            {selectedOrder.hints.filter(hint => hint.text !== undefined).map(hint => (
              <details className="tc-hint-rung" key={`${hint.id}:${selectedOrder.hints.filter(h => h.text).length}`} open={hint.level === selectedOrder.hints.filter(h => h.text).length - 1}>
                <summary>{hint.level + 1}. {locale === "ja" ? ["しくみ", "小さな数の例", "自分の数でやる"][hint.level] : ["The mechanism", "A small example", "Use your own values"][hint.level]}</summary>
                {/* [Issue #740] The sudoku guide is the PROVE procedure; a disclosure Order (LEAK only) keeps its own rung-3 text. */}
                {hint.level === 2 && !selectedOrder.schnorr && (selectedOrder.task.kind === "reveal-share" || selectedOrder.task.kind === "zk-sudoku") && selectedOrder.allowedMethods.includes("prove") ?
                  <SudokuGuide order={selectedOrder} projection={projection} table={proveTable} locale={locale} onOpenProof={() => { setProveOpen(true); requestAnimationFrame(() => document.querySelector(".tc-proof-inputs")?.scrollIntoView({ block: "start" })); }} /> :
                  <p className="tc-hint-text"><MathText>{hint.text?.[locale] ?? ""}</MathText></p>}
              </details>
            ))}
            {nextHint ? (
              <button
                type="button"
                className="tc-hint-button"
                disabled={submitting}
                onClick={() => void run(
                  () => submitRevealHint(client, selectedOrder.id, nextHint.cost),
                  () => ({
                    kind: "hint",
                    title: copy.hintOpened,
                    body: copy.hintOpenedBody(nextHint.cost),
                  }),
                )}
              >
                {copy.hintBuy(nextHint.cost)}
              </button>
            ) : (
              <div className="tc-card-hint">{copy.hintsExhausted}</div>
            )}
          </details>
      ) : <p className="tc-card-hint">{copy.noOrder}</p>}
      </section>

      {/*
        [Issue #682] The exposure lane, always on screen. See `exposureRows`
        for why it is not gated on anything being actionable yet.
      */}
      <details className="tc-exposure">
        <summary>{locale === "ja" ? `秘密の公開状況 · あなた ${ownExposedShareCount(projection)}/${projection.threshold} 個` : `Secret exposure · you ${ownExposedShareCount(projection)}/${projection.threshold}`}
          <span>{exposure.filter((row) => !row.isSelf).map((row) => `${row.teamName} ${row.exposed}/${projection.threshold}`).join(" · ")}</span>
        </summary>
        <div className="tc-card-hint">{copy.exposureHint(projection.threshold)}</div>
        <div className="tc-exposure-rows">
          {exposure.map((row) => (
            <div
              key={row.teamId}
              className={`tc-exposure-row${row.isSelf ? " tc-exposure-self" : ""}${row.huntable || (row.isSelf && row.exposed > 0) ? " tc-exposure-hot" : ""}`}
            >
              <span className="tc-exposure-team">{row.isSelf ? copy.exposureSelf : row.teamName}</span>
              <span className="tc-exposure-pips" aria-label={`${row.exposed}/${projection.threshold}`}>
                {Array.from({ length: projection.threshold }, (_, i) => (
                  <span key={i} className={`tc-pip${i < row.exposed ? " tc-pip-on" : ""}`} />
                ))}
              </span>
              <span
                className={`tc-exposure-state${row.huntable || (row.isSelf && row.exposed > 0) ? " tc-exposure-state-hot" : ""}`}
              >
                {row.huntable
                  ? row.isSelf
                    ? copy.exposureWarn
                    : copy.exposureHuntable
                  : row.isSelf && row.exposed > 0
                    ? copy.exposureWarn
                    : copy.exposureSafe}
              </span>
            </div>
          ))}
        </div>
        {exposure.length <= 1 ? <p className="tc-exposure-note">{copy.exposureSolo}</p> : null}
      </details>

      <HuntPanel projection={projection} locale={locale} submitting={submitting}
        onSubmit={(op) => run(() => client.submitOp(op), (next) => {
          if (op.kind === "hunt" || op.kind === "hunt-sudoku" || op.kind === "hunt-rotor") return huntFeedback(next, op.targetTeamId, locale, op.kind === "hunt-rotor" ? "rotor" : op.kind === "hunt-sudoku" ? "sudoku" : undefined);
          if (op.kind === "hunt-rsa" && !next?.completedHunts?.some(h => h.via === "rsa" && h.targetTeamId === op.targetTeamId && h.generation === op.generation)) return { kind: "error", title: copy.rejected, body: copy.unavailable };
          if (op.kind === "hunt-rsa") return { kind: "hunt", title: copy.huntSuccess, body: locale === "ja" ? "公開nの素数2個が一致し、攻撃が成功しました。" : "The two prime factors match public n; the attack succeeded.", reward: next ? projection.huntWinPoints : undefined };
          if (op.kind === "hunt-cipher") return { kind: "hunt", title: copy.huntSuccess, body: copy.huntCipherBody, reward: next ? rungSpec(op.rung).huntBonus : undefined };
          return next ? { kind: "hunt", title: locale === "ja" ? "予測を預けました" : "Prediction submitted", body: locale === "ja" ? "試行回数を1回使いました。対戦の開封後に採点します。" : "One attempt reserved. Scoring waits for the duel's public openings." } : { kind: "error", title: copy.rejected, body: copy.unavailable };
        })} />

        {tactics.rotate && <div id="tc-breach-defense" tabIndex={-1} className="tc-rotate-card">
          <div className="tc-card-title">{locale === "ja" ? "自分の防御 · 秘密を作り直す（ROTATE）" : "Defend yourself · Replace your secrets (ROTATE)"}</div>
          <div className="tc-card-hint">{copy.rotateHint}</div>
          {projection.vault.rotatePenalty !== undefined && <p><strong>{locale === "ja" ? `実行すると −${projection.vault.rotatePenalty} 点` : `This action costs ${projection.vault.rotatePenalty} points`}</strong></p>}
          {projection.publicRsaKeys?.length ? <p className="tc-card-hint">{locale === "ja" ? "RSAの新しい公開n/eも全員に見えます。小さい鍵の数は再登場する場合があり、ROTATEで因数分解を防げるわけではありません。" : "Everyone also sees the new RSA n/e. Tiny key numbers can recur; ROTATE does not prevent factoring."}</p> : null}
          {sudokuPressure === "hunted" && <div className="tc-card-hint">{copy.rotateSudokuHunted}</div>}
          {sudokuPressure === "exhausted" && <div className="tc-card-hint">{copy.rotateSudokuExhausted}</div>}
          {/*
            [Issue #659] ROTATE voids every Order still open, and each one now
            costs what letting it expire costs -- up to a whole batch. That is a
            bigger surprise than the LEAK rate this panel already discloses, and
            it arrives at the worst moment: a team rotates because it is under
            attack. State the price while the button is still unpressed, and
            count the Orders actually at stake rather than quoting a rule.
          */}
          {(projection.vault.rotateMinimumPenalty ?? 0) > 0 && <div className="tc-card-warn">{locale === "ja" ? `公開専用Orderに回答済み：ROTATEは少なくとも −${projection.vault.rotateMinimumPenalty} 点。未処理Orderの減点がこれ以上なら、その減点だけです。` : `A disclosure Order was answered: ROTATE costs at least −${projection.vault.rotateMinimumPenalty} points, or the unanswered-Order penalty if larger.`}</div>}
          {rotateVoidCount(projection) > 0 ? (
            <div className="tc-card-warn">{copy.rotateCost(rotateVoidCount(projection))}</div>
          ) : null}
          <button
            type="button"
            className="tc-submit-small"
            disabled={submitting || projection.vault.rotateCooldownRemainingMs > 0}
            onClick={() => {
              const before = projection.vault.generation;
              void run(
                () => submitRotate(client),
                () => ({ kind: "rotate", title: copy.rotateSuccess, body: copy.rotateBody(before, before + 1) }),
              );
            }}
          >{projection.vault.rotateCooldownRemainingMs > 0 ? `${Math.ceil(projection.vault.rotateCooldownRemainingMs / 1000)}s` : copy.rotate}</button>
        </div>}

      <MatchRecords projection={projection} locale={locale} />
    </section>
  );
}

/**
 * The banner a submission leaves behind. Keyed by `attempt` at the call site
 * so a repeat remounts and the pop replays (Issue #697).
 *
 * Its own component, exported, so `game/src/portal.test.ts` can render what a
 * HUNT miss actually puts on the screen: the panel itself has no projection
 * under `renderToStaticMarkup` (see this file's header), so the banner is the
 * seam the miss-versus-success check has to go through.
 */
export function FeedbackBanner({ feedback, locale, onContinue }: { readonly feedback: Feedback; readonly locale: Locale; readonly onContinue?: () => void }) {
  const copy = FAST_MOVE_COPY[locale];
  const reward = feedback.kind !== "error" && (feedback.reward ?? 0) > 0;
  return (
    <div className={`tc-feedback tc-feedback-${feedback.kind}${reward ? " tc-feedback-reward" : ""}`}>
      {reward && <SuccessCelebration points={feedback.reward!} locale={locale} />}
      <div className={reward ? "tc-reward-heading" : undefined}>
        {reward && <span className="tc-reward-icon" aria-hidden="true">✓</span>}
        <strong>{feedback.title}</strong>
        {reward && <span className="tc-reward-points">+{feedback.reward} {locale === "ja" ? "点" : "pt"}</span>}
        {!reward && feedback.attempt > 1 ? <em className="tc-feedback-attempt">{copy.attemptLabel(feedback.attempt)}</em> : null}
      </div>
      {reward && feedback.total !== undefined && <span className="tc-feedback-total">{locale === "ja" ? "現在のスコア" : "Current score"}: {feedback.total} {locale === "ja" ? "点" : "pt"}</span>}
      <span>{feedback.body}</span>
      {feedback.lesson ? <details className="tc-why"><summary>{locale === "ja" ? "いま、何ができた？" : "What did I just do?"}</summary><span className="tc-feedback-lesson">{feedback.lesson}</span></details> : null}
      {reward && onContinue && <button type="button" className="tc-submit-small" onClick={onContinue}>{locale === "ja" ? "次のお題へ →" : "Next Order →"}</button>}
    </div>
  );
}
