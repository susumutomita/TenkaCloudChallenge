import { useState } from "react";
import { handWork, HANDS, isHand, isRandomness, RPS_RANDOMNESS } from "../game/src/commitment.ts";
import type { ContractProjection, CryptoBattleOp, CryptoBattleProjection } from "../game/src/types.ts";
import ConceptExplanation from "./ConceptExplanation.tsx";

type Locale = "ja" | "en";
export const POWER_FOURS = HANDS.map(m => ({ m, value: handWork(m, 0).find(s => s.term === `4^${m}`)!.value }));
export const POWER_NINES = RPS_RANDOMNESS.map(r => ({ r, value: handWork(1, r).find(s => s.term === `9^${r}`)!.value }));
const names = { ja: ["グー", "チョキ", "パー"], en: ["Rock", "Scissors", "Paper"] } as const;
const inputStyle = { width: 80, padding: 8, border: "1px solid #8298b3", borderRadius: 6, background: "#fff", color: "#16212e", fontSize: 16 } as const;

export default function RpsDuel({ order, opponentName, locale, submitting, onSubmit }: {
  readonly order: ContractProjection; readonly opponentName: string; readonly locale: Locale;
  readonly submitting: boolean; readonly onSubmit: (op: CryptoBattleOp) => Promise<void>;
}) {
  const [handText, setHand] = useState("");
  const [randomText, setRandom] = useState("");
  const [sealedText, setSealed] = useState("");
  const task = order.task;
  if (task.kind !== "rps-duel") return null;
  const ja = locale === "ja";
  const hand = Number(handText), randomness = Number(randomText);
  const validChoice = /^(?:[0-9]|10)$/.test(randomText.trim()) && handText !== "" && isHand(hand) && isRandomness(randomness);
  const sealed = task.myCommitment !== undefined;
  const bothSealed = sealed && task.opponentCommitment !== undefined;
  const opened = task.myOpening !== undefined;
  return <section className="tc-input-panel" aria-label={ja ? "じゃんけんの回答" : "Rock-paper-scissors answer"}>
    <p className="tc-card-hint">{ja ? `対戦相手：${opponentName}。勝ち +${order.points}、引き分け +${task.drawPoints}、負け 0。必要な操作が残ったまま期限切れ：${task.expiryPenalty} 点。先に手を見せると相手に勝つ手を選ばれるので、数字に隠してから同時に開きます。` : `Opponent: ${opponentName}. Win +${order.points}, draw +${task.drawPoints}, loss 0; expiry with an action outstanding: ${task.expiryPenalty}. Hide your hand in a number first, then open together so nobody can counter a hand they have already seen.`}</p>
    <strong>{opened ? (ja ? "手を預けました。相手の開封待ちです" : "Opening accepted. Waiting for your opponent") : bothSealed ? (ja ? "② 控えた手と隠す数を、審判へ渡す" : "2. Give the judge the hand and hiding number from your notes") : sealed ? (ja ? "数字を封じました。相手の数字を待っています" : "Number sealed. Waiting for your opponent's number") : (ja ? "① 手を選び、隠した数字を 1 つ出す" : "1. Choose a hand and send one sealed number")}</strong>
    {!opened && <>
      <p className="tc-card-hint">{ja ? "手の番号 m は 1〜3。隠す数 r は 0〜10 のくじで毎回引き直してください（0〜10 の紙を 1 枚ずつ用意し、毎回戻して引きます）。同じ r の使い回しは手を読まれる原因になります。手と r は開くときに必要なので、紙にも控えてください。" : "Hand m is 1–3. Draw r from eleven slips marked 0–10, returning the slip each time; reuse makes hands predictable. Write both down: you need them to open."}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, margin: "12px 0" }}>
        <label>{ja ? "手の番号" : "Hand number"} <select aria-label={ja ? "手の番号" : "Hand number"} value={handText} onChange={e => setHand(e.target.value)} style={{ ...inputStyle, width: 140 }}>
          <option value="">{ja ? "選んでください" : "Choose a hand"}</option>
          {HANDS.map(m => <option key={m} value={m}>{m} = {names[locale][m - 1]}</option>)}
        </select></label>
        <label>{ja ? "隠す数 r（0〜10）" : "Hiding number r (0–10)"} <input aria-label={ja ? "隠す数" : "Hiding number"} value={randomText} inputMode="numeric" maxLength={2} onChange={e => setRandom(e.target.value)} style={inputStyle} /></label>
      </div>
    </>}
    {!sealed && <>
      <ol style={{ lineHeight: 1.9, paddingLeft: 24, fontSize: 14 }}>
        <li>{ja ? "4^m は 4 を m 回掛ける意味です。表で、選んだ m に対応する「4^m を 23 で割った余り」を読みます。" : "4^m means m factors of 4. Read the remainder of 4^m after division by 23 for your m."}<br />{POWER_FOURS.map(({m,value}) => `m=${m} → ${value}`).join("　/　")}</li>
        <li>{ja ? "表は 9^r を 23 で割った余りです。例：9^2=81、81−23−23−23=12。0 回掛ける値は 1 とします。" : "The table gives the remainder of 9^r after division by 23. Example: 9^2=81; 81−23−23−23=12. A zeroth power is 1."}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px" }}>{POWER_NINES.map(({r,value}) => <span key={r}>r={r} → {value}</span>)}</div>
        </li>
        <li>{ja ? "読んだ 2 つの値を掛け、23 で割った余りを入力します。23 以上なら 23 を引き、0〜22 に入るまで繰り返します。" : "Multiply those two values and enter the remainder after division by 23. Subtract 23 until you reach 0–22."}</li>
      </ol>
      <p className="tc-card-hint">{ja ? "見本：m=1、r=1 → 4×9=36 → 36−23=13。式では c = 4^m × 9^r mod 23（mod は割った余り）。表では途中の数も 23 で割った余りにしています。先に 23 の倍数を引いてから掛けると、積からも 23 の倍数が減るだけなので、最後の余りは変わりません。" : "Example: m=1, r=1 → 4×9=36 → 36−23=13. Formula: c = 4^m × 9^r mod 23; mod means the remainder. The tables reduce intermediate values too. Subtracting a multiple of 23 before multiplying only removes a multiple of 23 from the product, leaving its final remainder unchanged."}</p>
      <label className="tc-answer-label">{ja ? "封じる数字 c（計算した余り）" : "Sealed number c (your calculated remainder)"}
        <input aria-label={ja ? "封じる数字" : "Sealed number"} value={sealedText} inputMode="numeric" maxLength={2} onChange={e => setSealed(e.target.value)} />
      </label>
      <button type="button" className="tc-submit-small" disabled={submitting || !validChoice || !/^\d{1,2}$/.test(sealedText.trim())} onClick={() => void onSubmit({ kind: "rps-commit", contractId: order.id, commitment: Number(sealedText) })}>{ja ? "数字を封じる" : "Seal the number"}</button>
    </>}
    {sealed && <p className="tc-card-hint">{ja ? `自分の c=${task.myCommitment}。相手：${task.opponentCommitment === undefined ? "まだです" : `c=${task.opponentCommitment}`}。` : `Your c=${task.myCommitment}. Opponent: ${task.opponentCommitment === undefined ? "pending" : `c=${task.opponentCommitment}`}.`}</p>}
    {bothSealed && !opened && <>
      <p className="tc-card-hint">{ja ? "上の 2 つの欄を紙の控えと照らしてから押してください。審判は同じ計算で c を確かめ、両者の手がそろってから公開します。不一致なら減点なしで修正できます。開封した手と r が受理された後は、その開封内容を変更できません。" : "Check the two fields against your notes. The judge recomputes c and publishes only after both hands arrive. A mismatch can be corrected without a penalty. Once the hand and r are accepted, that opening cannot be replaced."}</p>
      <button type="button" className="tc-submit-small" disabled={submitting || !validChoice} onClick={() => void onSubmit({ kind: "rps-open", contractId: order.id, hand, randomness })}>{ja ? "手を審判へ渡す" : "Give my opening to the judge"}</button>
    </>}
    {opened && <p className="tc-card-hint">{ja ? "あなたの手は相手へまだ公開されていません。待つ間は『ほかのお題を選ぶ』から別のお題を進められます。" : "Your hand is still private from the opponent. You can work on another Order while waiting."}</p>}
    <details className="tc-why"><summary>{ja ? "待ち時間と、この教材の安全性" : "Waiting and this teaching model"}</summary><p className="tc-card-hint">{ja ? "相手が数字を出さない、または開かないまま期限を迎えた場合、自分が現在の段階を終えていれば不戦勝。自分の必要な操作が残っていれば通常の期限切れ減点です。秘密を作り直す操作（ROTATE）をしても、この対戦は続きます。23 という小さい数では別の手への開け方を探せるため、実用的な暗号の安全性はありません。審判の同時公開で後出しを防ぐ体験版です。" : "If the opponent never seals or opens, finishing your current stage earns a forfeit win at the deadline. An unfinished required action gets the ordinary expiry penalty. Rotating your long-lived secrets (ROTATE) does not cancel this duel. With modulus 23 you can find alternative openings: this is an insecure teaching model whose judge prevents adapting after seeing the other opening."}</p></details>
    <ConceptExplanation locale={locale} topic="commit" />
  </section>;
}

export function RpsResult({ projection, locale }: { readonly projection: CryptoBattleProjection; readonly locale: Locale }) {
  const order = [...projection.myContracts].reverse().find(c => c.task.kind === "rps-duel" && c.task.outcome);
  if (!order || order.task.kind !== "rps-duel") return null;
  const task = order.task, ja = locale === "ja";
  const labels = ja ? { win: "勝ち", loss: "負け", draw: "引き分け", "forfeit-win": "相手の時間切れで不戦勝" } : { win: "Win", loss: "Loss", draw: "Draw", "forfeit-win": "Forfeit win" };
  const points = task.outcome === "win" || task.outcome === "forfeit-win" ? order.points : task.outcome === "draw" ? task.drawPoints : 0;
  const records = projection.publicLedger.filter(a => a.kind === "rps-open" && a.duelId === task.duelId);
  return <div aria-live="polite" style={{ padding: "10px 14px", marginBottom: 12, background: "#edf7f0", borderRadius: 8 }}>
    <strong>{ja ? "じゃんけん" : "Rock-paper-scissors"}：{labels[task.outcome!]} +{points}</strong>
    {records.map(a => a.kind === "rps-open" && <span key={a.id} style={{ marginLeft: 12 }}>{projection.teams[a.teamId]?.teamName ?? a.teamId}：{names[locale][a.hand - 1]} (r={a.randomness})</span>)}
  </div>;
}

/** Translate known judge errors; an unfamiliar rejection remains visible. */
export function rpsRejection(error: string, locale: Locale): string {
  if (locale !== "ja") return error;
  const messages: Record<string, string> = {
    "Choose your open rock-paper-scissors Order.": "自分の未回答のじゃんけんのお題を選んでください。",
    "This duel has ended.": "この対戦は終了しています。ほかのお題を選んでください。",
    "Your sealed number was already submitted; it cannot be replaced.": "数字はすでに封じてあります。提出後の数字は変更できません。",
    "The sealed number must be a power of 4 after division by 23 (1–22). Check your calculation.": "封じる数字が計算の範囲に合いません。表の 2 つの値を掛け、23 で割った余りを確かめてください。",
    "Wait until both sealed numbers have been submitted.": "両者の数字がそろうまで待ってください。待つ間はほかのお題を進められます。",
    "Your opening was already accepted; it cannot be replaced.": "手はすでに審判へ預けてあります。開封した手と r が受理された後は、その開封内容を変更できません。",
    "The hand and hiding number do not reproduce your sealed number. Check your notes; no points were deducted.": "手と隠す数から計算した値が、先に封じた数字と一致しません。紙に控えた手と隠す数を確認してください。減点はありません。",
  };
  return messages[error] ?? error;
}
