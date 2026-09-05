import { useEffect, useMemo, useRef, useState } from "react";
import type { PortalCoordinationClient, PortalCoordinationOutcome, PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import { isCryptoBattleProjection, usePolledProjection } from "./coordination.ts";
import {
  submitCipher,
  submitFhe,
  submitHunt,
  submitHuntCipher,
  submitHuntSudoku,
  submitLeak,
  submitMpc,
  submitProveSudoku,
  submitRevealHint,
  submitReady,
  submitRotate,
  submitStart,
} from "./RegistrationPanelCore.tsx";
import { taskDetail, taskLabel } from "./orderTask.ts";
import { DIE_CSS, DieFace, DieRow } from "./DieFace.tsx";
import { BOARD_CSS, Ledger, OrderBelt, Vault } from "./GameBoard.tsx";
import QuickRules from "./QuickRules.tsx";
import {
  describeRevealGroup,
  emptyCells,
  parseCells,
  PermutationChips,
  SudokuBoard,
  SudokuInput,
  SUDOKU_CSS,
} from "./SudokuGrid.tsx";
import { rungSpec } from "../game/src/ladder.ts";
import { ALL_PERMUTATIONS } from "../game/src/sudoku.ts";
import type { CipherRung } from "../game/src/ladder.ts";
import type {
  CipherPairArtifact,
  ContractProjection,
  CryptoBattleProjection,
  HintProjection,
  HuntBudgetProjection,
  SudokuRevealArtifact,
} from "../game/src/types.ts";

type Locale = "ja" | "en";
type FeedbackKind = "leak" | "prove" | "hunt" | "rotate" | "hint" | "error";

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
    choose: "2. CHOOSE ONE",
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
    leakHint: "FAST / PUBLIC",
    prove: "PROVE",
    proveHint: "COMPUTE / PROTECTED",
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
    scoreHint: "Answer an Order to gain. Let one expire and you lose points.",
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
    hintsHint: "Each one explains a little more. You pay for it whether or not you finish the Order.",
    hintBuy: (cost: number) => `OPEN THE NEXT HINT (-${cost})`,
    hintsExhausted: "Every hint on this Order is open.",
    hintOpened: "HINT OPENED",
    hintOpenedBody: (cost: number) => `-${cost} · read it below`,
    send: "SUBMIT",
    running: "SUBMITTING…",
    leakRate: "pass",
    leakSuccess: "LEAK SUCCESS",
    leakBody: (points: number, shares: readonly number[]) => `+${points} · share ${shares.map((x) => `#${x}`).join(", ")} → PUBLIC LEDGER`,
    leakPairBody: (points: number, pairsToBreak: number) =>
      `+${points} · your row and its answer → PUBLIC LEDGER. ${pairsToBreak} pair${pairsToBreak === 1 ? "" : "s"} recovers your key.`,
    // [Issue #709] PROVE is a hand relabelling of the vault's sudoku.
    proveTitle: "SHOW IT WITHOUT SHOWING IT — a zero-knowledge proof",
    proveUse: "USED FOR: proving you hold a solution while showing nobody which digit sits where",
    proveWhy: "WHY IT WORKS: relabelling the digits keeps every row, column and box valid — the judge sees a real solution, everyone else sees 1-4 in some order",
    proveHelp: "DO THIS: write a table (1→?, 2→?, 3→?, 4→?) in which each of 1, 2, 3, 4 appears exactly once on the right — a swap, not a merge — rewrite all 16 cells of your solution through it, type them in. Never the same table twice.",
    proveSolution: "your solution (private)",
    proveUsed: "tables you already used this generation",
    proveNoneUsed: "none yet — any table that uses each of 1-4 once, other than 1→1 2→2 3→3 4→4, is fresh",
    proveGrid: "your relabelled grid",
    proveIncomplete: "Fill all 16 cells with 1-4.",
    proveSuccess: "PROVE SUCCESS",
    proveBody: (points: number, group: string) => `+${points} · ${group} of your RELABELLED grid is on the Public Ledger; your solution is not`,
    proveMiss: "PROVE MISS",
    proveMissBody: (cost: number) => `-${cost} · that grid is not a relabelling of your solution. Check that the table sends 1-4 to 1-4 with no digit used twice, then check it against every cell.`,
    proveUnread: "PROVE SUBMITTED",
    proveUnreadBody: "The result could not be read. Check your score and the Order.",
    proveLesson:
      "That was a ZERO-KNOWLEDGE PROOF: the judge is now certain you hold the solution, and every other team learned only that one row of a relabelled copy reads 1-4 in some order. This is what zk-rollups prove on-chain.",
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
    fheWhy: "WHY IT WORKS: Enc(a) + Enc(b) = Enc(a+b) — adding then locking equals locking then adding",
    fheHelp: "DO THIS: add the two ciphertexts position by position, remainder mod p",
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
    mpcUse: "USED FOR: three companies publishing a combined total, none revealing its own",
    mpcWhy: "WHY IT WORKS: the masks cancel — (a+r₁−r₂)+(b+r₂−r₃)+(c+r₃−r₁) = a+b+c",
    mpcHelp: "DO THIS: your number + masks received − masks sent, remainder mod p",
    mpcMine: "your number (private)",
    mpcIncoming: "masks received",
    mpcOutgoing: "masks sent",
    mpcAnswer: "your masked subtotal",
    mpc: "SUBMIT SUBTOTAL",
    mpcHint: "COMPUTE / INPUT STAYS PRIVATE",
    mpcSuccess: "MPC SUCCESS",
    mpcBody: (points: number) => `+${points} · YOUR NUMBER STAYED PRIVATE`,
    mpcLesson:
      "That was SECURE COMPUTATION (MPC): three parties learned the total and nobody learned anyone else's number. The masks cancelled. Blockchains use it for shared settlement without a trusted middleman.",
    prime: "p (the modulus)",
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
    tacticsHint: "Open this when a public share, an opened sudoku row, or one of your exposed shares gives you another move.",
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
    choose: "2. どちらかを選ぶ",
    // [Issue #702] 無料、 かつヒントの裏ではなくカード上。 ライブ実戦では 3 段すべて
    // (-14 点) 買ったうえで 「Share ってそもそもなに？」 と返ってきた。
    // 用語を知るのに得点を払わせない。
    shareWhat: "かけら (share) = 秘密を 5 個に分けたうちの 1 個。MY VAULT の #1〜#5 がそれです。",
    shareDo: (indices: readonly number[]) =>
      `この Order が要求しているのは ${indices.map((i) => `#${i}`).join("・")} です。LEAK を押すとそれを渡して即完了 — 計算はありません。PROVE は渡さずに答えます。`,
    leak: "LEAK",
    leakHint: "速い / 公開",
    prove: "PROVE",
    proveHint: "計算 / 守る",
    proveOpen: "付け替えて出す",
    constraintNone: "方法は自由",
    constraintNoRaw: (methods: readonly string[]) =>
      `${methods.join(" / ").toUpperCase()} のみ — 生の値を公開してはいけない`,
    scoreLabel: "スコア",
    scoreHint: "ORDER に答えると増えます。期限切れにすると減ります。",
    leakBlocked: "この Order は LEAK を受け付けません。",
    proveBlocked: "この Order は PROVE を受け付けません。",
    hunt: "LEDGER から HUNT",
    // [Issue #696] 外したときの代償は、提出する前にカードに書く。
    huntHint: (cost: number) =>
      `Public Ledger で見つけた相手チーム / 世代を選びます。外すと ${cost} 点減り、その相手・世代への HUNT 回数を 1 回使います。残り回数は各チップに出ています。`,
    huntAttemptsLeft: (left: number, max: number) => `あと ${left}/${max} 回`,
    huntExhausted: "この相手・世代への HUNT はもう残っていません。",
    noHuntTarget: "まだ相手のかけらは公開されていません。",
    recovered: "復元した secret",
    rotate: "ROTATE",
    rotateHint: "新しい世代へ切り替えます。",
    rotateSudokuHunted: "この世代の数独の解は他チームに割り出されています。新しい世代は新しい解になります。",
    rotateSudokuExhausted: "この世代で未使用の付け替え表がもうありません。次の PROVE の前に ROTATE しないと、次の表は使い回しになります。",
    rotateCost: (orders: number) => `未処理の ORDER ${orders} 件が無効になります。期限切れと同じだけ減点されます。`,
    hintsTitle: "ヒント",
    hintsHint: "1 段ごとに少しずつ説明します。Order を解けなくても得点は引かれます。",
    hintBuy: (cost: number) => `次のヒントを開く（-${cost}）`,
    hintsExhausted: "この Order のヒントはすべて開きました。",
    hintOpened: "ヒントを開きました",
    hintOpenedBody: (cost: number) => `-${cost} · 下に表示されています`,
    send: "SUBMIT",
    running: "送信中…",
    leakRate: "パス",
    leakSuccess: "LEAK SUCCESS",
    leakBody: (points: number, shares: readonly number[]) => `+${points} · share ${shares.map((x) => `#${x}`).join(", ")} → PUBLIC LEDGER`,
    leakPairBody: (points: number, pairsToBreak: number) =>
      `+${points} · 記号列と答えが対で公開されました。この段は ${pairsToBreak} 組で鍵が割れます。`,
    // [Issue #709] PROVE は MY VAULT の数独を手で付け替えて出す。
    proveTitle: "解を見せずに示す ― ゼロ知識証明",
    proveUse: "つかいみち: 「解を持っている」ことだけを示し、どのマスに何があるかは誰にも見せない",
    proveWhy: "しくみ: 数字を付け替えても行・列・箱の性質は崩れない ── 審判には本物の解、相手には「1〜4 の並び替え」にしか見えない",
    proveHelp: "やること: 表 (1→?、2→?、3→?、4→?) を 1 つ決める。右側には 1・2・3・4 をちょうど 1 回ずつ使う (入れ替えであって、まとめではない)。解の 16 マスをその表で書き換えて入力する。同じ表は 2 度使わない。",
    proveSolution: "自分の解 (非公開)",
    proveUsed: "この世代で使った表",
    proveNoneUsed: "まだなし ── 1〜4 を 1 回ずつ使う表なら、1→1 2→2 3→3 4→4 以外はどれでも新品",
    proveGrid: "付け替えたマス目",
    proveIncomplete: "16 マスすべてに 1〜4 を入れてください。",
    proveSuccess: "PROVE SUCCESS",
    proveBody: (points: number, group: string) => `+${points} · 付け替えたマス目の${group}が公開記録に載りました。解そのものは載っていません`,
    proveMiss: "PROVE MISS",
    proveMissBody: (cost: number) => `-${cost} · そのマス目は自分の解の付け替えになっていません。表が 1〜4 を 1〜4 へ、同じ数字を 2 回使わずに送っているか確かめてから、全マスに当て直してください。`,
    proveUnread: "PROVE を送信しました",
    proveUnreadBody: "結果を読み取れませんでした。スコアと Order を確認してください。",
    proveLesson:
      "いまのが「ゼロ知識証明」です。審判はあなたが解を持っていると確信し、相手チームは「付け替えた写しの 1 行が 1〜4 の並び替えである」ことしか知りませんでした。zkRollup がチェーン上で証明しているのはこれです。",
    huntSuccess: "HUNT SUCCESS",
    huntBody: "復元した secret が受理されました。",
    // [Issue #696] 外れは外れと言う。 ok だけを見て SUCCESS を出していたのが不具合。
    huntMiss: "HUNT MISS",
    huntMissBody: (cost: number, left: number | undefined) =>
      left === undefined ? `-${cost}` : `-${cost} · あと ${left} 回`,
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
    fheWhy: "しくみ: Enc(a) + Enc(b) = Enc(a+b) ── 足してから閉じても、閉じてから足しても同じ",
    fheHelp: "やること: 2つの暗号文を左どうし・右どうし足して、p で割った余り",
    fheInputs: "Order の暗号文",
    fheAnswerR: "答え: 左の値",
    fheAnswerY: "答え: 右の値",
    fhe: "暗号文を提出",
    fheHint: "計算 / 何も明かさない",
    fheSuccess: "FHE SUCCESS",
    fheBody: (points: number) => `+${points} · 復号せずに足した`,
    fheLesson:
      "いまのが「準同型暗号」です。中身を読めない数のまま計算して、答えは正しく出ました。ブロックチェーンでは、金額を誰も公開せずに合計を検証するのに使われています。",
    mpcTitle: "覆面をかけた小計 ― MPC (秘密計算)",
    mpcUse: "つかいみち: 3社が売上の合計だけ出す。各社の売上は誰にも見せない",
    mpcWhy: "しくみ: 覆面は足すと打ち消し合う ── (a+r₁−r₂)+(b+r₂−r₃)+(c+r₃−r₁) = a+b+c",
    mpcHelp: "やること: 自分の数 + 受け取った覆面 − 送った覆面 を、p で割った余り",
    mpcMine: "自分の数 (非公開)",
    mpcIncoming: "受け取った覆面",
    mpcOutgoing: "送った覆面",
    mpcAnswer: "覆面をかけた小計",
    mpc: "小計を提出",
    mpcHint: "計算 / 自分の数は出ない",
    mpcSuccess: "MPC SUCCESS",
    mpcBody: (points: number) => `+${points} · 自分の数は公開されていない`,
    mpcLesson:
      "いまのが「秘密計算 (MPC)」です。3 者が合計だけを知り、誰も他人の数を知りませんでした。覆面が打ち消し合ったからです。ブロックチェーンでは、信頼できる仲介者なしの決済に使われています。",
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
    cipherSuccess: "CIPHER SUCCESS",
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
    tacticsHint: "公開されたかけら・数独の行、または自分の公開済みかけらがあるときに開きます。",
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
  if (outcome.kind === "rejected") return outcome.error;
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

function ledgerTargets(projection: CryptoBattleProjection | null) {
  if (!projection) return [];
  const seen = new Set<string>();
  const targets: { teamId: string; generation: number; shareIndices: number[] }[] = [];
  for (const entry of projection.publicLedger) {
    if (entry.kind !== "share" || entry.teamId === projection.vault.teamId) continue;
    const key = `${entry.teamId}:${entry.generation}`;
    let target = targets.find((candidate) => `${candidate.teamId}:${candidate.generation}` === key);
    if (!target) {
      target = { teamId: entry.teamId, generation: entry.generation, shareIndices: [] };
      targets.push(target);
    }
    const indexKey = `${key}:${entry.shareIndex}`;
    if (!seen.has(indexKey)) {
      seen.add(indexKey);
      target.shareIndices.push(entry.shareIndex);
    }
  }
  return targets;
}

/**
 * [Issue #696] The reader's HUNT budget against one target, or nothing if the
 * target's generation is not the one the budget counts against.
 *
 * `ledgerTargets` lists every `team:generation` the ledger has shares for,
 * including generations a ROTATE has already retired; `validateOp` refuses a
 * HUNT at any generation but the current one. Showing "3/3 attempts left" on a
 * chip the judge will refuse would advertise a budget that cannot be spent, so
 * the count appears only where the two agree.
 *
 * Exported for `game/src/portal.test.ts` (see this file's header on why the
 * panel itself cannot be rendered with a projection under test).
 */
export function huntBudgetFor(
  projection: CryptoBattleProjection | null,
  target: { readonly teamId: string; readonly generation: number },
): HuntBudgetProjection | undefined {
  const budget = projection?.huntAttempts[target.teamId];
  return budget !== undefined && budget.generation === target.generation ? budget : undefined;
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
  via?: "sudoku",
): FeedbackDraft {
  const copy = FAST_MOVE_COPY[locale];
  const outcome = next?.lastHunt;
  // [Issue #709] The projection remembers WHICH secret the last HUNT went
  // after. A sudoku miss must not be read off the Shamir budget, and a Shamir
  // hit must not be reported as a recovered solution.
  const matches = outcome !== undefined && (outcome.via ?? undefined) === via;
  if (next !== undefined && matches && outcome?.outcome === "hit") {
    return { kind: "hunt", title: copy.huntSuccess, body: via === "sudoku" ? copy.huntSudokuBody : copy.huntBody };
  }
  if (next !== undefined && matches && outcome?.outcome === "miss") {
    const budget = (via === "sudoku" ? next.sudokuHuntAttempts : next.huntAttempts)[targetTeamId];
    const left = budget === undefined ? undefined : Math.max(0, budget.max - budget.spent);
    return { kind: "error", title: copy.huntMiss, body: copy.huntMissBody(next.wrongHuntCost, left) };
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
  if (next !== undefined && outcome?.contractId === contractId && outcome.outcome === "hit") {
    const reveal = next.publicLedger.find(
      (a): a is SudokuRevealArtifact => a.kind === "sudoku-reveal" && a.contractId === contractId,
    );
    const group = reveal ? describeRevealGroup(reveal.group, locale) : locale === "ja" ? "1 グループ" : "one group";
    return { kind: "prove", title: copy.proveSuccess, body: copy.proveBody(points, group), lesson: copy.proveLesson };
  }
  if (next !== undefined && outcome?.contractId === contractId && outcome.outcome === "miss") {
    return { kind: "error", title: copy.proveMiss, body: copy.proveMissBody(next.wrongProveCost) };
  }
  return { kind: "error", title: copy.proveUnread, body: copy.proveUnreadBody };
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
  return openOrders(projection).length;
}

/**
 * [Issue #659 §2] Every other team whose ladder key is recoverable from the
 * public record right now.
 *
 * "Recoverable" means the rung's own threshold: a team that has published at
 * least `pairsToBreak` pairs of one rung, on its CURRENT generation, is broken
 * and can be hunted. Counting per (team, generation, rung) is what makes
 * 「相手の段を見て狩る価値があるか判断する」 (#659 §2) a decision a participant can
 * actually make from the board -- and it is why a rung that no number of pairs
 * breaks simply never appears here.
 *
 * Reads the public ledger only. Nothing here touches a target's own state,
 * because a hunter has nothing but the public record to work from.
 */
export interface CipherHuntCandidate {
  readonly teamId: string;
  readonly generation: number;
  readonly rung: CipherRung;
  readonly pairs: readonly CipherPairArtifact[];
  readonly pairsToBreak: number;
}

export function cipherHuntCandidates(
  projection: CryptoBattleProjection | null,
): readonly CipherHuntCandidate[] {
  if (!projection) return [];
  const byKey = new Map<string, CipherHuntCandidate>();
  for (const entry of projection.publicLedger) {
    if (entry.kind !== "cipher-pair") continue;
    // Never your own team: hunting yourself is refused by the reducer, and
    // offering it here would be offering a move that cannot be made.
    if (entry.teamId === projection.vault.teamId) continue;
    const key = `${entry.teamId}:${entry.generation}:${entry.rung}`;
    const current = byKey.get(key) ?? {
      teamId: entry.teamId,
      generation: entry.generation,
      rung: entry.rung,
      pairs: [],
      pairsToBreak: rungSpec(entry.rung).pairsToBreak,
    };
    byKey.set(key, { ...current, pairs: [...current.pairs, entry] });
  }
  return [...byKey.values()].filter((c) => c.pairs.length >= c.pairsToBreak);
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
  readonly rotate: boolean;
} {
  return {
    hunt: ledgerTargets(projection).length > 0,
    sudokuHunt: sudokuHuntCandidates(projection).length > 0,
    cipherHunt: cipherHuntCandidates(projection).length > 0,
    rotate: ownExposedShareCount(projection) > 0 || sudokuRotatePressure(projection) !== undefined,
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

/**
 * [Issue #709] Teams a sudoku HUNT can be aimed at: every OTHER team that has
 * PROVEd on its current generation, with its public puzzle and every group it
 * has had opened.
 *
 * What this deliberately does NOT do is decide whether any of them is
 * exploitable. The nonce-reuse card this replaces once scanned for two proof
 * rows sharing a commitment and listed only the teams where it found one -- so
 * the card went from "nobody" to naming a target at the exact moment the reuse
 * appeared, which is the Portal announcing the ledger pattern the participant
 * is supposed to notice. #486's rule (restated in #646's non-goals) forbids
 * exactly that. So every reveal is shown, tag and all, and whether two tags
 * match is a reading the participant does.
 *
 * Using each team's CURRENT generation is also what makes a stale target
 * impossible: `validateOp` refuses any other generation, so there is nothing
 * here that can be offered and then refused.
 *
 * Exported for `game/src/portal.test.ts`: `renderToStaticMarkup` never runs
 * the effect that would populate the panel.
 */
export interface SudokuHuntCandidate {
  readonly teamId: string;
  readonly teamName: string;
  readonly generation: number;
  readonly puzzle: readonly number[];
  readonly reveals: readonly SudokuRevealArtifact[];
}

export function sudokuHuntCandidates(
  projection: CryptoBattleProjection | null,
): readonly SudokuHuntCandidate[] {
  if (!projection) return [];
  const byTeam = new Map<string, SudokuHuntCandidate>();
  for (const entry of projection.publicLedger) {
    if (entry.kind !== "sudoku-reveal" || entry.teamId === projection.vault.teamId) continue;
    const team = projection.teams[entry.teamId];
    const puzzle = projection.publicPuzzles[entry.teamId];
    if (team === undefined || puzzle === undefined || team.generation !== entry.generation) continue;
    const current = byTeam.get(entry.teamId) ?? {
      teamId: entry.teamId,
      teamName: team.teamName || entry.teamId,
      generation: team.generation,
      puzzle,
      reveals: [],
    };
    byTeam.set(entry.teamId, { ...current, reveals: [...current.reveals, entry] });
  }
  return [...byTeam.values()];
}

const CSS = `
${BOARD_CSS}
${DIE_CSS}
${SUDOKU_CSS}
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
.tc-action{border:0;border-radius:12px;padding:16px 12px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;font-weight:900;font-size:18px}
.tc-action small{font-size:10px;font-weight:800;letter-spacing:.06em}
.tc-action:disabled{cursor:not-allowed;opacity:.45}
.tc-leak-button{background:#ffefd1;box-shadow:inset 0 0 0 2px #d8a657}
.tc-prove-button{background:#e7f6ec;box-shadow:inset 0 0 0 2px #69b482}
.tc-prove-step{margin:0 0 6px;font-size:12px;line-height:1.6;color:#3f4b57}
.tc-prove-challenge{margin:0 0 6px;font-size:13px}
.tc-prove-challenge strong{font-size:18px;letter-spacing:.02em}
.tc-input-panel{border:1px solid #cfd8e3;border-radius:9px;padding:9px;background:#fff;display:grid;gap:6px}
.tc-input-panel input,.tc-input-panel select{padding:8px;border:1px solid #aab7c4;border-radius:6px;font-size:12px;min-width:0}
.tc-secondary-grid{display:grid;grid-template-columns:1.3fr .7fr;gap:10px}
.tc-tactics{border:1px solid #cfd8e3;border-radius:10px;background:#eef3f8}.tc-tactics>summary{cursor:pointer;padding:10px 12px;font-size:12px;font-weight:900}.tc-tactics>summary span{display:block;margin-top:3px;color:#5f6b7a;font-size:11px;font-weight:500}.tc-tactics-body{display:grid;gap:10px;padding:0 10px 10px}
.tc-hunt-card,.tc-rotate-card{border:1px solid #cfd8e3;border-radius:10px;padding:10px;background:#fff}
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
.tc-hint-text{display:flex;gap:7px;font-size:12px;color:#1f2c3d;line-height:1.6;margin:0 0 6px}
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
.tc-gate{display:grid;justify-items:start;gap:10px;padding:18px;border:1px solid #cfd8e3;border-radius:12px;background:#fff;max-width:56ch}
.tc-gate-title{font-size:15px;font-weight:900;letter-spacing:.08em}
.tc-gate-body{margin:0;font-size:13px;line-height:1.7;color:#3b4a5a}
.tc-gate-note{margin:0;font-size:11px;color:#5f6b7a}
.tc-start-button{font-size:15px;font-weight:900;letter-spacing:.06em;padding:12px 22px;border-radius:10px;border:1px solid #0f5c9e;background:#0972d3;color:#fff;cursor:pointer}
.tc-start-button:disabled{opacity:.6;cursor:default}
.tc-start-button:not(:disabled):hover{background:#0f5c9e}
/* [Issue #688] The escape, deliberately quieter than READY. */
.tc-start-anyway{font-size:12px;padding:6px 12px;border-radius:8px;border:1px solid #cfd8e3;background:#fff;color:#5f6b7a;cursor:pointer}
.tc-start-anyway:hover{border-color:#8c9bab;color:#16212e}
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
    matchRemainingMs:
      projection.matchRemainingMs === undefined ? undefined : drop(projection.matchRemainingMs),
    myContracts: projection.myContracts.map((order) =>
      order.remainingMs <= 0 ? order : { ...order, remainingMs: drop(order.remainingMs) },
    ),
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
  const [huntCells, setHuntCells] = useState<readonly string[]>(() => emptyCells());
  const [proveOpen, setProveOpen] = useState(false);
  // [Issue #645] One box per component of an FHE answer, one for an MPC
  // subtotal. Keep decimal strings through the wire boundary: the default
  // field is 97, but a configured larger field must not be rounded by Number().
  const [fheR, setFheR] = useState("");
  const [fheY, setFheY] = useState("");
  const [mpcPartial, setMpcPartial] = useState("");
  const [cipherAnswer, setCipherAnswer] = useState("");
  const [huntTargetKey, setHuntTargetKey] = useState("");
  const [sudokuTargetKey, setSudokuTargetKey] = useState("");
  const [cipherTargetKey, setCipherTargetKey] = useState("");
  const [recoveredCipherKey, setRecoveredCipherKey] = useState("");
  const [recoveredSecret, setRecoveredSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const attemptRef = useRef(0);

  const setProjection = (next: CryptoBattleProjection) => {
    setPolledProjection(next);
    setProjectionAtMs(Date.now());
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
  // [Issue #645] Read from the Order, never re-derived here: the game rules
  // decide which methods an Order accepts, and a portal that recomputed them
  // would be a second implementation free to disagree with the judge.
  const { visible: primaryActionsVisible, leakAllowed, proveAllowed } =
    primaryActionsFor(selectedOrder);
  const nextHint = nextHintFor(selectedOrder);
  const targets = useMemo(() => ledgerTargets(projection), [projection]);
  const selectedTarget = targets.find((target) => `${target.teamId}:${target.generation}` === huntTargetKey) ?? targets[0];
  // [Issue #696] The cap is visible BEFORE the attempt is spent: a chip with no
  // attempts left says so, and the SUBMIT under it is disabled rather than
  // left to be refused by the judge.
  const selectedBudget = selectedTarget === undefined ? undefined : huntBudgetFor(projection, selectedTarget);
  const huntExhausted = selectedBudget !== undefined && selectedBudget.spent >= selectedBudget.max;
  const sudokuTargets = useMemo(() => sudokuHuntCandidates(projection), [projection]);
  const tactics = useMemo(() => tacticAvailability(projection), [projection]);
  const sudokuPressure = useMemo(() => sudokuRotatePressure(projection), [projection]);
  const exposure = useMemo(() => exposureRows(projection), [projection]);
  const selectedSudokuTarget =
    sudokuTargets.find((t) => `${t.teamId}:${t.generation}` === sudokuTargetKey) ?? sudokuTargets[0];
  const selectedSudokuBudget =
    selectedSudokuTarget === undefined ? undefined : projection?.sudokuHuntAttempts[selectedSudokuTarget.teamId];
  const sudokuHuntExhausted =
    selectedSudokuBudget !== undefined && selectedSudokuBudget.spent >= selectedSudokuBudget.max;
  const proveGrid = parseCells(proveCells);
  const huntGrid = parseCells(huntCells);
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
  }, [selectedOrderIdForProve, ownGeneration]);
  const sudokuTargetTeam = selectedSudokuTarget?.teamId;
  const sudokuTargetGeneration = selectedSudokuTarget?.generation;
  useEffect(() => {
    setHuntCells(emptyCells());
  }, [sudokuTargetTeam, sudokuTargetGeneration]);
  const cipherTargets = useMemo(() => cipherHuntCandidates(projection), [projection]);
  const selectedCipherTarget =
    cipherTargets.find((t) => `${t.teamId}:${t.generation}:${t.rung}` === cipherTargetKey) ??
    cipherTargets[0];

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
        setFeedback({ ...success(next), attempt });
      }
    } catch {
      setFeedback({ kind: "error", title: copy.rejected, body: copy.unavailable, attempt });
    } finally {
      setSubmitting(false);
    }
  };

  if (!client) return null;
  if (!projection) return <section className="tc-move-shell"><style>{CSS}</style><div>{copy.unavailable}</div></section>;
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
        [Issue #690] 「最初にやること」 is the first thing to read, so it is the
        first thing on the surface. It used to live at the bottom of the help
        drawer, below the board, the exposure lane, the Ledger and the Vault —
        a first-time player had to scroll past the whole game to find out how to
        start playing it.
      */}
      <QuickRules locale={props.locale} />
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
        <div className="tc-scoreline-hint">{copy.scoreHint}</div>
      </div>


      <div>
        {/*
          [Issue #659] The belt IS the picker, and the work surface is directly
          below it. There is no second list: choosing a ticket in one host slot
          and working on it in another, far apart down the page, is what made
          the screen unintuitive — "which Order" and "what do I do with it" were
          never in view together. Now they are.
        */}
        <OrderBelt
          projection={projection}
          locale={locale}
          selectedId={selectedOrder?.id}
          onSelect={(id) => {
            setSelectedOrderId(id);
            setProveOpen(false);
          }}
        />
      </div>

      {/*
        [Issue #645] The action area follows the Order's TASK. A share Order
        offers LEAK / PROVE; an encrypted-addition Order offers only the thing
        that can answer it. Showing all four buttons and rejecting three of them
        would teach a participant that the game is arbitrary, when the real rule
        is that a sudoku PROVE cannot add two ciphertexts.

        [Issue #659] Gated on what the Order ACCEPTS, not on which task it is.
        The two were the same thing while `reveal-share` was the only Order that
        took LEAK; the ladder Order takes it too, and the task-name test hid the
        button on the one Order whose entire point is the choice between
        computing and passing. The card advertised LEAK, the working panel
        warned what LEAKing would cost, and there was nothing to press.
      */}
      {/*
        [Issue #659] The ticket you are working on, on the surface you work at.
        
        The Order lived in one host slot and the controls in another, far apart
        down the page, so "which Order am I answering, and how long do I have"
        was never in view while answering it. In Overcooked the ticket and the
        counter are the same place; the slots cannot merge, so the ticket comes
        to the counter instead. The bar drains and changes colour, because a
        deadline you have to read a number to feel is not a deadline.
      */}
      {selectedOrder && (
        <div className={`tc-ticket${selectedOrder.remainingMs <= 30_000 ? " tc-ticket-urgent" : ""}`}>
          <div className="tc-ticket-head">
            <strong>{selectedOrder.id.replace(/^.*-c/, "ORDER #")}</strong>
            <span>{taskLabel(selectedOrder.task, locale)}</span>
            <span className="tc-ticket-clock">{Math.ceil(selectedOrder.remainingMs / 1000)}s</span>
          </div>
          <div className="tc-ticket-track" aria-hidden="true">
            <div
              className="tc-ticket-fill"
              style={{ width: `${Math.max(2, Math.min(100, (selectedOrder.remainingMs / 300_000) * 100))}%` }}
            />
          </div>
          {/*
            [Issue #659 §9] Help, attached to the ticket it is help WITH.

            It sits inside the ticket rather than in a drawer of its own because
            the moment a player needs it is the moment they are staring at an
            Order they cannot start, and a stuck player does not go looking. The
            price is printed on the button before it is pressed -- the whole
            mechanism is a trade, and a trade whose cost you learn afterwards is
            not one you made.

            Only opened rungs have any text to show: `projectForTeam` withholds
            the rest, so there is nothing here to reveal by reading the bundle.
          */}
          <div className="tc-hints">
            <div className="tc-card-title">{copy.hintsTitle}</div>
            <div className="tc-card-hint">{copy.hintsHint}</div>
            {selectedOrder.hints
              .filter((hint) => hint.text !== undefined)
              .map((hint) => (
                <p className="tc-hint-text" key={hint.id}>
                  <span className="tc-hint-step">{hint.level + 1}</span>
                  {hint.text?.[locale]}
                </p>
              ))}
            {nextHint ? (
              <button
                type="button"
                className="tc-hint-button"
                disabled={submitting}
                onClick={() => void run(
                  () => submitRevealHint(client, selectedOrder.id),
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
          </div>
        </div>
      )}

      {primaryActionsVisible && (
      <div>
        <div className="tc-card-title">{copy.choose}</div>
        {/*
          [Issue #702] The noun, then the move, before the two buttons. Placed
          here and not in `QuickRules` because this is where the player is
          looking when they have to decide, and it is the only Order whose whole
          difficulty is knowing what it is asking for.
        */}
        {selectedOrder?.task.kind === "reveal-share" && (
          <p className="tc-share-primer">
            <strong>{copy.shareWhat}</strong>
            <span>{copy.shareDo(selectedOrder.task.shareIndices)}</span>
          </p>
        )}
        <div className="tc-primary-actions">
          {/*
            [Issue #645] LEAK is disabled, not hidden, on an Order that forbids
            raw disclosure -- and the reason is spelled out below. Hiding it
            would leave the participant wondering where the option went; showing
            it live and rejecting the submission would spend their time to teach
            them a rule the card already stated.
          */}
          <button
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
                body:
                  selectedOrder.task.kind === "caesar-shift"
                    ? copy.leakPairBody(selectedOrder.leakPoints, selectedOrder.task.pairsToBreak)
                    : copy.leakBody(
                        selectedOrder.leakPoints,
                        selectedOrder.task.kind === "reveal-share" ? selectedOrder.task.shareIndices : [],
                      ),
              }),
            )}
          >
            {copy.leak}<small>{copy.leakHint}</small>
          </button>
          {/*
            [Issue #659] Disabled rather than hidden on an Order that PROVE
            cannot serve, for the same reason LEAK is: the participant sees the
            option exists and reads why it is unavailable here, instead of
            watching a button appear and disappear as they click between cards.
          */}
          <button
            type="button"
            className="tc-action tc-prove-button"
            disabled={!selectedOrder || submitting || !proveAllowed}
            title={selectedOrder && !proveAllowed ? copy.proveBlocked : undefined}
            onClick={() => setProveOpen((value) => !value)}
          >
            {copy.prove}<small>{copy.proveHint}</small>
          </button>
        </div>
        {selectedOrder && (!leakAllowed || !proveAllowed) && (
          <div className="tc-card-hint">
            {!leakAllowed ? copy.leakBlocked : copy.proveBlocked}
          </div>
        )}
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
          <div className="tc-card-hint">{copy.fheHelp}</div>
          <div className="tc-card-hint">{copy.fheInputs}</div>
          <ul className="tc-material-list">
            {selectedOrder.task.inputs.map((input, index) => (
              <li key={`${input.r}-${input.y}`}><code>#{index + 1} = ({input.r}, {input.y})</code></li>
            ))}
          </ul>
          <div className="tc-card-hint">{copy.prime}: <code>{projection.prime}</code></div>
          <input aria-label="fast-fhe-r" value={fheR} onChange={(event) => setFheR(event.target.value)} placeholder={copy.fheAnswerR} />
          <input aria-label="fast-fhe-y" value={fheY} onChange={(event) => setFheY(event.target.value)} placeholder={copy.fheAnswerY} />
          <button
            type="button"
            className="tc-submit-small tc-fhe-button"
            disabled={submitting || !fheR.trim() || !fheY.trim()}
            onClick={() => void run(
              () => submitFhe(client, selectedOrder.id, { r: fheR.trim(), y: fheY.trim() }),
              () => ({ kind: "prove", title: copy.fheSuccess, body: copy.fheBody(selectedOrder.points), lesson: copy.fheLesson }),
            )}
          >{submitting ? copy.running : copy.fhe}</button>
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
      {selectedOrder?.task.kind === "caesar-shift" && (
        <div className="tc-input-panel">
          <strong style={{ fontSize: "12px" }}>{copy.cipherTitle} · {selectedOrder.id.replace(/^.*-c/, "ORDER #")}</strong>
          <div className="tc-lesson">
            <div className="tc-lesson-use">{copy.cipherUse}</div>
            <div className="tc-lesson-why">{copy.cipherWhy}</div>
          </div>
          <div className="tc-card-hint">{copy.cipherHelp}</div>
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
            <li>{copy.cipherKey}: <code>{selectedOrder.task.myKey}</code></li>
          </ul>
          <div className="tc-card-warn">{copy.cipherCost(selectedOrder.task.pairsToBreak)}</div>
          <input
            aria-label="fast-cipher-answer"
            value={cipherAnswer}
            onChange={(event) => setCipherAnswer(event.target.value)}
            placeholder={copy.cipherAnswer}
          />
          <button
            type="button"
            className="tc-submit-small tc-cipher-button"
            disabled={submitting || !cipherAnswer.trim()}
            onClick={() => void run(
              () => submitCipher(client, selectedOrder.id, cipherAnswer.trim().split(/\s+/)),
              () => ({ kind: "prove", title: copy.cipherSuccess, body: copy.cipherBody(selectedOrder.points) }),
            )}
          >{submitting ? copy.running : copy.cipher}</button>
        </div>
      )}

      {/*
        [Issue #645 Phase 3] The team's own number and its four masks are shown
        here and nowhere else -- they arrive on this Order's projection because
        it belongs to this team. What leaves the browser is the subtotal only.
      */}
      {selectedOrder?.task.kind === "masked-total" && (
        <div className="tc-input-panel">
          <strong style={{ fontSize: "12px" }}>{copy.mpcTitle} · {selectedOrder.id.replace(/^.*-c/, "ORDER #")}</strong>
          <div className="tc-lesson">
            <div className="tc-lesson-use">{copy.mpcUse}</div>
            <div className="tc-lesson-why">{copy.mpcWhy}</div>
          </div>
          <div className="tc-card-hint">{copy.mpcHelp}</div>
          <ul className="tc-material-list">
            <li>{copy.mpcMine}: <code>{selectedOrder.task.myInput}</code></li>
            <li>{copy.mpcIncoming}: <code>{selectedOrder.task.incomingMasks.join(", ")}</code></li>
            <li>{copy.mpcOutgoing}: <code>{selectedOrder.task.outgoingMasks.join(", ")}</code></li>
          </ul>
          <div className="tc-card-hint">{copy.prime}: <code>{projection.prime}</code></div>
          <input aria-label="fast-mpc-partial" value={mpcPartial} onChange={(event) => setMpcPartial(event.target.value)} placeholder={copy.mpcAnswer} />
          <button
            type="button"
            className="tc-submit-small tc-mpc-button"
            disabled={submitting || !mpcPartial.trim()}
            onClick={() => void run(
              () => submitMpc(client, selectedOrder.id, mpcPartial.trim()),
              () => ({ kind: "prove", title: copy.mpcSuccess, body: copy.mpcBody(selectedOrder.points), lesson: copy.mpcLesson }),
            )}
          >{submitting ? copy.running : copy.mpc}</button>
        </div>
      )}

      {/*
        [Issue #645] Gated on the task, not only on `proveOpen`. The LEAK/PROVE
        buttons above are already task-gated, but this editor is a separate
        block: leaving it ungated let a participant open it on a share Order,
        select an FHE Order, and submit a PROVE the new Order cannot accept.
        `setProveOpen(false)` on selection is the other half — a form that
        reappears still bound to a different Order is its own surprise.

        [Issue #709] PROVE is one move now: relabel the vault's sudoku and
        submit the whole grid. Everything the participant needs is on screen --
        their solution, the tables they have already spent, sixteen boxes --
        and the one thing the panel does NOT do is apply a table for them. The
        relabelling is the work; a "fill it in" button would delete it. The
        ZK sudoku Order opens this directly (there is no LEAK to choose
        against), a share Order opens it from the PROVE button.
      */}
      {(proveOpen || selectedOrder?.task.kind === "zk-sudoku") && selectedOrder && proveAllowed && (
        <div className="tc-input-panel">
          <strong style={{ fontSize: "12px" }}>{copy.proveTitle} · {selectedOrder.id.replace(/^.*-c/, "ORDER #")}</strong>
          <div className="tc-lesson">
            <div className="tc-lesson-use">{copy.proveUse}</div>
            <div className="tc-lesson-why">{copy.proveWhy}</div>
          </div>
          <div className="tc-card-hint">{copy.proveHelp}</div>
          <div className="tc-sudoku-row">
            <div className="tc-sudoku-block">
              <span className="tc-sudoku-caption">{copy.proveSolution}</span>
              <SudokuBoard cells={projection.vault.sudokuSolution} label="my-solution" />
            </div>
            <div className="tc-sudoku-block">
              <span className="tc-sudoku-caption">{copy.proveGrid}</span>
              <SudokuInput value={proveCells} onChange={setProveCells} ariaLabel="fast-prove-grid" />
            </div>
          </div>
          <div className="tc-card-hint">
            {copy.proveUsed}:{" "}
            {projection.vault.usedPermutations.length === 0
              ? copy.proveNoneUsed
              : projection.vault.usedPermutations.map((pi) => (
                  <span key={pi.join("")} style={{ marginRight: 8 }}><PermutationChips pi={pi} /></span>
                ))}
          </div>
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
                if (draft.kind === "prove") setProveCells(emptyCells());
                return draft;
              },
            )}
          >{submitting ? copy.running : copy.send}</button>
        </div>
      )}

      {/*
        [Issue #682] The exposure lane, always on screen. See `exposureRows`
        for why it is not gated on anything being actionable yet.
      */}
      <div className="tc-exposure">
        <div className="tc-card-title">{copy.exposure}</div>
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
      </div>

      {(tactics.hunt || tactics.sudokuHunt || tactics.cipherHunt || tactics.rotate) && (
      <details className="tc-tactics" open={tactics.hunt || tactics.cipherHunt || tactics.sudokuHunt}>
        <summary>{copy.tactics}<span>{copy.tacticsHint}</span></summary>
        <div className="tc-tactics-body">
      {tactics.hunt && <div className="tc-secondary-grid">
        <div className="tc-hunt-card">
          <div className="tc-card-title">{copy.hunt}</div>
          <div className="tc-card-hint">{copy.huntHint(projection.wrongHuntCost)}</div>
          <>
              <div className="tc-target-row">
                {targets.map((target) => {
                  const key = `${target.teamId}:${target.generation}`;
                  const budget = huntBudgetFor(projection, target);
                  return <button key={key} type="button" className="tc-target-chip" aria-pressed={selectedTarget ? `${selectedTarget.teamId}:${selectedTarget.generation}` === key : false} onClick={() => setHuntTargetKey(key)}>{target.teamId} · gen {target.generation} · [{target.shareIndices.join(",")}]{budget ? ` · ${copy.huntAttemptsLeft(Math.max(0, budget.max - budget.spent), budget.max)}` : ""}</button>;
                })}
              </div>
              {huntExhausted ? <div className="tc-card-warn">{copy.huntExhausted}</div> : null}
              <div className="tc-input-panel">
                <input aria-label="fast-hunt-secret" value={recoveredSecret} onChange={(event) => setRecoveredSecret(event.target.value)} placeholder={copy.recovered} />
                <button
                  type="button"
                  className="tc-submit-small"
                  disabled={submitting || !selectedTarget || !recoveredSecret.trim() || huntExhausted}
                  onClick={() => selectedTarget && void run(
                    () => submitHunt(client, selectedTarget.teamId, selectedTarget.generation, recoveredSecret.trim()),
                    // [Issue #696] Hit or miss is read off the projection the
                    // op came back with -- see `huntFeedback`. The sudoku HUNT
                    // (#709) reads its verdict the same way; the cipher HUNT
                    // keeps its plain success draft because `validateOp` still
                    // refuses a wrong key there, so for it ok really means hit.
                    (next) => huntFeedback(next, selectedTarget.teamId, locale),
                  )}
                >{submitting ? copy.running : copy.send}</button>
              </div>
          </>
        </div>
      </div>}

        {/*
          [Issue #659 §2] The ladder HUNT. Only teams whose published pairs have
          actually reached their rung's threshold appear here, so the list is
          the answer to 「狩る価値があるか」 rather than a list of everyone.

          The pairs are shown, plaintext above ciphertext, because subtracting
          one from the other IS the attack -- a control that hid them would be
          asking for a key without showing where it comes from.
        */}
        {tactics.cipherHunt && <div className="tc-hunt-card">
          <div className="tc-card-title">{copy.huntCipher}</div>
          <div className="tc-card-hint">{copy.huntCipherHint}</div>
          <div className="tc-target-row">
            {cipherTargets.map((target) => {
              const key = `${target.teamId}:${target.generation}:${target.rung}`;
              return (
                <button
                  key={key}
                  type="button"
                  className="tc-target-chip"
                  aria-pressed={selectedCipherTarget ? `${selectedCipherTarget.teamId}:${selectedCipherTarget.generation}:${selectedCipherTarget.rung}` === key : false}
                  onClick={() => setCipherTargetKey(key)}
                >{target.teamId} · gen {target.generation} · {target.rung} {target.pairs.length}/{target.pairsToBreak}</button>
              );
            })}
          </div>
          {selectedCipherTarget && (
            <ul className="tc-material-list">
              {selectedCipherTarget.pairs.map((pair) => (
                <li key={pair.id}>
                  <DieRow values={pair.plaintext} size={18} />
                  <DieRow values={pair.ciphertext} size={18} />
                </li>
              ))}
            </ul>
          )}
          <div className="tc-input-panel">
            <input
              aria-label="fast-hunt-cipher-key"
              value={recoveredCipherKey}
              onChange={(event) => setRecoveredCipherKey(event.target.value)}
              placeholder={copy.recoveredKey}
            />
            <button
              type="button"
              className="tc-submit-small"
              disabled={submitting || !selectedCipherTarget || !recoveredCipherKey.trim()}
              onClick={() => selectedCipherTarget && void run(
                () => submitHuntCipher(
                  client,
                  selectedCipherTarget.teamId,
                  selectedCipherTarget.generation,
                  selectedCipherTarget.rung,
                  Number(recoveredCipherKey.trim()),
                ),
                // [Issue #659] A ladder HUNT recovered a KEY, not the Shamir
                // secret. The design keeps those two breaks apart on purpose
                // (see `cipherHuntedGenerations`); saying "recovered secret" here
                // would tell the player the reconstruction they did not do.
                () => ({ kind: "hunt", title: copy.huntSuccess, body: copy.huntCipherBody }),
              )}
            >{submitting ? copy.running : copy.send}</button>
          </div>
        </div>}

        {/*
          [Issue #709] The sudoku HUNT. Every opened group of every other team
          is shown with its tag, next to that team's public puzzle: the match
          between two tags is the participant's to spot, the lining-up against
          the puzzle is theirs to do, and the sixteen boxes are where the
          recovered solution goes. A control that showed only the "huntable"
          teams would be the Portal doing the noticing.
        */}
        {tactics.sudokuHunt && <div className="tc-hunt-card">
          <div className="tc-card-title">{copy.huntSudoku}</div>
          <div className="tc-card-hint">{copy.huntSudokuHint(projection.wrongHuntCost)}</div>
          <div className="tc-target-row">
            {sudokuTargets.map((target) => {
              const key = `${target.teamId}:${target.generation}`;
              const budget = projection.sudokuHuntAttempts[target.teamId];
              return (
                <button
                  key={key}
                  type="button"
                  className="tc-target-chip"
                  aria-pressed={selectedSudokuTarget ? `${selectedSudokuTarget.teamId}:${selectedSudokuTarget.generation}` === key : false}
                  onClick={() => setSudokuTargetKey(key)}
                >{target.teamName} · gen {target.generation} · ×{target.reveals.length}{budget ? ` · ${copy.huntAttemptsLeft(Math.max(0, budget.max - budget.spent), budget.max)}` : ""}</button>
              );
            })}
          </div>
          {selectedSudokuTarget && (
            <div className="tc-sudoku-row">
              <div className="tc-sudoku-block">
                <span className="tc-sudoku-caption">{copy.huntSudokuPuzzle}</span>
                <SudokuBoard cells={selectedSudokuTarget.puzzle} label={`puzzle-${selectedSudokuTarget.teamId}`} />
              </div>
              <div className="tc-sudoku-block">
                <span className="tc-sudoku-caption">{copy.huntSudokuReveals}</span>
                <ul className="tc-reveal-list">
                  {selectedSudokuTarget.reveals.map((reveal) => (
                    <li key={reveal.id}>
                      <span>{describeRevealGroup(reveal.group, locale)}</span>
                      <code>{reveal.cells.join(" ")}</code>
                      <span className="tc-reveal-tag">{reveal.tag}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="tc-sudoku-block">
                <span className="tc-sudoku-caption">{copy.huntSudokuGrid}</span>
                <SudokuInput value={huntCells} onChange={setHuntCells} ariaLabel="fast-hunt-sudoku-grid" />
              </div>
            </div>
          )}
          {sudokuHuntExhausted ? <div className="tc-card-warn">{copy.huntExhausted}</div> : null}
          <div className="tc-input-panel">
            <button
              type="button"
              className="tc-submit-small tc-hunt-sudoku-button"
              disabled={submitting || !selectedSudokuTarget || huntGrid === undefined || sudokuHuntExhausted}
              onClick={() => selectedSudokuTarget && huntGrid && void run(
                () => submitHuntSudoku(client, selectedSudokuTarget.teamId, selectedSudokuTarget.generation, huntGrid),
                // A hit empties the grid: that solution is recovered and
                // this target's generation is closed to a second HUNT.
                (next) => {
                  const draft = huntFeedback(next, selectedSudokuTarget.teamId, locale, "sudoku");
                  if (draft.kind === "hunt") setHuntCells(emptyCells());
                  return draft;
                },
              )}
            >{submitting ? copy.running : copy.send}</button>
          </div>
        </div>}

        {tactics.rotate && <div className="tc-rotate-card">
          <div className="tc-card-title">{copy.rotate}</div>
          <div className="tc-card-hint">{copy.rotateHint}</div>
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
        </div>
      </details>
      )}

      <div className="tc-board-grid">
        <Ledger projection={projection} locale={locale} />
        <Vault projection={projection} locale={locale} />
      </div>

      {feedback && <FeedbackBanner key={feedback.attempt} feedback={feedback} locale={locale} />}
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
export function FeedbackBanner({ feedback, locale }: { readonly feedback: Feedback; readonly locale: Locale }) {
  const copy = FAST_MOVE_COPY[locale];
  return (
    <div className={`tc-feedback tc-feedback-${feedback.kind}`}>
      <strong>
        {feedback.title}
        {feedback.attempt > 1 ? <em className="tc-feedback-attempt">{copy.attemptLabel(feedback.attempt)}</em> : null}
      </strong>
      <span>{feedback.body}</span>
      {feedback.lesson ? <span className="tc-feedback-lesson">{feedback.lesson}</span> : null}
    </div>
  );
}
