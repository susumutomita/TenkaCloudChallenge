import { useState } from "react";
import type { CryptoBattleOp, CryptoBattleProjection, RpsHuntTarget } from "../game/src/types.ts";
import { HANDS, isHand } from "../game/src/commitment.ts";
import { POWER_FOURS, POWER_NINES } from "./RpsDuel.tsx";

type Locale = "ja" | "en";
const names = { ja: ["グー", "チョキ", "パー"], en: ["Rock", "Scissors", "Paper"] } as const;
const handName = (hand: number, locale: Locale) => `${hand} = ${names[locale][hand - 1]}`;

export function RpsHuntCandidate({ target, projection, locale, submitting, onSubmit }: {
  readonly target: RpsHuntTarget; readonly projection: CryptoBattleProjection; readonly locale: Locale;
  readonly submitting: boolean; readonly onSubmit: (op: CryptoBattleOp) => Promise<void>;
}) {
  const [choice, setChoice] = useState("");
  const ja = locale === "ja", budget = projection.huntAttempts[target.targetTeamId];
  const left = budget?.generation === target.generation ? Math.max(0, budget.max - budget.spent) : 0;
  const hand = Number(choice);
  const name = projection.teams[target.targetTeamId]?.teamName ?? target.targetTeamId;
  return <section className="tc-hunt-card" aria-label={ja ? `${name}の手を予測` : `Predict ${name}'s hand`}>
    <h3 style={{ fontSize: 17, margin: "4px 0" }}>{ja ? `${name}の手を、開く前に予測する` : `Predict ${name}'s hand before it opens`}</h3>
    <p className="tc-card-hint">{ja ? `HUNT · じゃんけん。的中 +${projection.rpsHunt!.winPoints}、外れ −${projection.wrongHuntCost}。かけらの HUNT と共通で、あと ${left} 回（相手の世代 ${target.generation}）。同じ対戦への予測は 1 回だけです。` : `HUNT · RPS. Hit +${projection.rpsHunt!.winPoints}, miss −${projection.wrongHuntCost}. ${left} attempts left, shared with share HUNT for target generation ${target.generation}. One prediction per duel.`}</p>
    <p className="tc-card-hint">{ja ? "c は手を隠して先に出した数字、m は手の番号、r はその手を隠すために混ぜた数です。" : "c is the sealed number, m is the hand number, and r is the number mixed in to hide the hand."}</p>
    <strong>{ja ? "① 過去の 2 回で、隠す数 r が同じか見る" : "1. Compare the hiding numbers r in two past rounds"}</strong>
    <table style={{ width: "100%", textAlign: "left", fontSize: 13, margin: "10px 0" }}>
      <thead><tr><th>{ja ? "公開記録" : "Public record"}</th><th>c</th><th>{ja ? "開いた手 m" : "Opened hand m"}</th><th>{ja ? "隠す数 r" : "Hiding number r"}</th></tr></thead>
      <tbody>{target.evidence.map((a, i) => <tr key={a.id}><td>{ja ? `過去 ${i + 1}（ORDER #${a.contractId.split("-c").pop()}）` : `Past ${i + 1} (ORDER #${a.contractId.split("-c").pop()})`}</td><td>{a.commitment}</td><td>{handName(a.hand, locale)}</td><td>{a.randomness}</td></tr>)}</tbody>
    </table>
    <p>{ja ? `今回、相手が封じた数字は c=${target.commitment}。まだ手は公開されていません。` : `The target has now sealed c=${target.commitment}. Their hand is still unpublished.`}</p>
    <details>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>{ja ? "計算のしかた（無料）" : "How to calculate (free)"}</summary>
    <strong>{ja ? "② 今回も同じ r を使ったと仮定し、3 つの手を試す" : "2. Assume r was reused again and try all three hands"}</strong>
    <p className="tc-card-hint">{ja ? "同じ r なら、9^r を 23 で割った余りも同じです。表の 2 つの値を掛けて 23 で割った余りを求め、今回の c と一致する手を予測します。4^m は 4 を m 回掛ける意味、9^r も同様です。0 回掛ける値は 1 とします。途中で 23 の倍数を引いてから掛けても、最後の余りは変わりません。" : "If r is unchanged, so is the remainder of 9^r after division by 23. Multiply the two table values, take the remainder after division by 23, and find the hand matching the current c. 4^m means m factors of 4; similarly for 9^r. Zero factors give 1. Subtracting multiples of 23 before multiplication does not change the final remainder."}</p>
    <p style={{ fontSize: 13 }}>{ja ? "手 m → 4^m の余り：" : "Hand m → remainder of 4^m: "}{POWER_FOURS.map(a => `${a.m} → ${a.value}`).join(" / ")}</p>
    <p style={{ fontSize: 13 }}>{ja ? "r → 9^r の余り：" : "r → remainder of 9^r: "}{POWER_NINES.map(a => `${a.r} → ${a.value}`).join(" / ")}</p>
    <p className="tc-card-hint">{ja ? "見本：r=1 なら表の値は 9。グーでは 4×9=36、36−23=13。チョキでは 16×9=144、144−23×6=6。パーでは 18×9=162、162−23×7=1。c=6 ならチョキと予測できます。ただし今回 r を引き直していれば、この推測は外れます。過去の使い回しは、今回も同じだという保証ではありません。" : "Example r=1 gives table value 9. Rock: 4×9=36→13. Scissors: 16×9=144−23×6=6. Paper: 18×9=162−23×7=1. Predict scissors for c=6. A fresh r can invalidate this assumption: past reuse does not guarantee reuse now."}</p>
    </details>
    <p className="tc-card-hint">{ja ? "今回も同じ隠す数を使った、と仮定して予測します。" : "Your prediction assumes the same hiding number was used again."}</p>
    <label>{ja ? "予測した手" : "Predicted hand"} <select aria-label={ja ? `${name}の予測した手` : `Predicted hand for ${name}`} value={choice} onChange={e => setChoice(e.target.value)}>
      <option value="">{ja ? "選んでください" : "Choose a hand"}</option>{HANDS.map(m => <option key={m} value={m}>{handName(m, locale)}</option>)}
    </select></label>
    <button type="button" className="tc-submit-small" disabled={submitting || !choice || !isHand(hand) || left === 0 || target.remainingMs <= 0} onClick={() => void onSubmit({ kind: "hunt-rps", targetTeamId: target.targetTeamId, duelId: target.duelId, predictedHand: hand })}>{ja ? "予測を審判へ預ける" : "Submit prediction to the judge"}</button>
    <p className="tc-card-hint">{ja ? "予測は非公開・変更不可。相手の開封前に送信。両者の公開後に採点し、時間切れなら回数を返します。" : "Private, final prediction. Submit before the target opens. Score after both openings; timeout refunds the attempt."}</p>
  </section>;
}

export default function RpsHunt({ projection, locale, submitting, onSubmit }: {
  readonly projection: CryptoBattleProjection; readonly locale: Locale; readonly submitting: boolean;
  readonly onSubmit: (op: CryptoBattleOp) => Promise<void>;
}) {
  const [selected, setSelected] = useState("");
  const targets = projection.rpsHunt?.targets ?? [];
  const key = (t: RpsHuntTarget) => `${t.targetTeamId}:${t.duelId}:${t.generation}`;
  const target = targets.find(t => key(t) === selected) ?? targets[0];
  if (!target) return null;
  return <>
    {targets.length > 1 && <label>{locale === "ja" ? "予測する相手・対戦を選ぶ" : "Choose a target and round"} <select value={key(target)} onChange={e => setSelected(e.target.value)}>
      {targets.map(t => <option key={key(t)} value={key(t)}>{projection.teams[t.targetTeamId]?.teamName ?? t.targetTeamId} · {locale === "ja" ? "残り" : "remaining"} {Math.ceil(t.remainingMs / 1000)}s</option>)}
    </select></label>}
    <RpsHuntCandidate key={`${projection.vault.teamId}:${key(target)}`} {...{target,projection,locale,submitting,onSubmit}} />
  </>;
}

export function RpsHuntStatus({ projection, locale }: { readonly projection: CryptoBattleProjection; readonly locale: Locale }) {
  const hunt = projection.rpsHunt, ja = locale === "ja";
  if (!hunt) return null;
  const name = (id: string) => projection.teams[id]?.teamName ?? id;
  const result = hunt.lastResult;
  return <div aria-live="polite">
    {hunt.pending.map(p => <p key={`${p.targetTeamId}:${p.duelId}`} className="tc-card-hint">{ja ? `${name(p.targetTeamId)}の予測を受付：${handName(p.predictedHand,locale)}。この対戦の開封待ち。まだ採点していません。` : `Prediction accepted for ${name(p.targetTeamId)}: ${handName(p.predictedHand,locale)}. Waiting for this duel to open; not scored yet.`}</p>)}
    {result && <div key={`${result.duelId}:${result.targetTeamId}`} style={{ border: "1px solid #b7cbe3", background: "#f3f7fc", padding: 12, marginBottom: 10, borderRadius: 8 }}>
      <strong>{ja ? "最新のじゃんけん予測" : "Latest RPS prediction"}：{name(result.targetTeamId)} — {ja ? ({ hit: "的中", miss: "外れ", cancelled: "不成立・試行回数を返却" }[result.outcome]) : result.outcome} {result.points > 0 ? "+" : ""}{result.points}</strong>
      <p style={{ fontSize: 13 }}>{ja ? "予測" : "Predicted"} {handName(result.predictedHand,locale)}{result.actualHand ? ` / ${ja ? "公開された手" : "Published hand"} ${handName(result.actualHand,locale)}` : ` / ${ja ? "手は公開されていません" : "No hand was published"}`}</p>
    </div>}
  </div>;
}
