import type { ContractProjection, CryptoBattleProjection } from "../game/src/types.ts";

const clock = (ms: number) => `${Math.floor(Math.ceil(ms / 1000) / 60)}:${String(Math.ceil(ms / 1000) % 60).padStart(2, "0")}`;
const label = (id: string) => id.replace(/^.*-c/, "ORDER #");

/** The real selected Order is the declaration target; no second selection list. */
export default function Lightning({ projection, order, locale, busy, onDeclare, onSelect }: {
  readonly projection: CryptoBattleProjection; readonly order?: ContractProjection; readonly locale: "ja" | "en";
  readonly busy?: boolean; readonly onDeclare?: (id: string) => void; readonly onSelect?: (id: string) => void;
}) {
  const card = projection.lightning;
  if (!card) return null;
  const ja = locale === "ja";
  if (card.status === "waiting" || card.status === "scheduled") return <p className="tc-card-hint" data-testid="lightning">
    {ja ? `開始から ${clock(card.startAfterMs)} で下位2チームにライトニング（計算回答の得点を1問だけ2倍）。同点は配布境界まで全員、2チーム戦は最下位のみ、1チームは対象外。`
      : `At ${clock(card.startAfterMs)} after start, the bottom two teams get one lightning card: double one calculation reward. Ties at the cutoff qualify; two-team matches award only last place, solo practice none.`}
  </p>;
  if (card.status === "unavailable") return <p className="tc-card-hint" data-testid="lightning">{ja ? "ライトニング対象外：旧版で終盤を迎えたため、配布時の順位が不明です。" : "Lightning unavailable: this older match has no saved endgame ranking."}</p>;
  if (card.status === "ineligible") return <p className="tc-card-hint" data-testid="lightning">{ja ? "ライトニング配布済み · このチームは対象外です。" : "Lightning distributed · this team did not qualify."}</p>;
  if (card.status === "unused-expired") return <p className="tc-card-hint" data-testid="lightning">{ja ? "ライトニング失効 · 試合が終了しました。" : "Lightning expired · the match has ended."}</p>;
  if (card.status === "spent") {
    const why = card.outcome === "hit" ? ja ? `計算正解 · +${card.points} 点` : `Correct calculation · +${card.points} pt`
      : card.outcome === "miss" ? ja ? "証明失敗 · 加点なし" : "Proof failed · no reward"
      : card.outcome === "leak" ? ja ? "LEAKで完了（得点は通常どおり）" : "Completed by LEAK (regular reward)"
      : card.outcome === "rotate" ? "ROTATE" : card.outcome === "ended" ? ja ? "試合終了" : "Match ended" : ja ? "期限切れ" : "Deadline passed";
    return <p className="tc-card-hint" data-testid="lightning">{ja ? "ライトニング使用終了" : "Lightning spent"} · {label(card.contractId!)} · {why}</p>;
  }
  const armed = card.status === "armed";
  const eligible = order?.lightningEligible === true && order.status === "open" && order.remainingMs > 0;
  const target = armed ? card.contractId! : order?.id;
  const points = armed ? card.points : order ? order.points * 2 : undefined;
  const remaining = armed ? card.remainingMs : order?.remainingMs ?? 0;
  return <aside data-testid="lightning" style={{ border: "1px solid #a07c16", borderRadius: 8, padding: "8px 10px", margin: "8px 0", fontSize: 12 }}>
    <strong>{ja ? "ライトニング" : "Lightning"} · {armed ? ja ? "このお題に指定済み" : "Declared for this Order" : ja ? "残り1枚" : "1 card left"}</strong>
    {(armed || eligible) && <div>{label(target!)} · {ja ? "計算正解で" : "Correct calculation"} +{points} {ja ? "点" : "pt"} · {ja ? "残り" : "Time left"} {clock(remaining)}</div>}
    <div>{ja ? "解答前に1題へ指定。計算回答（PROVE・CIPHER・FHE・MPC・EC・SNARK・iO）の正解だけ2倍。LEAK・期限切れ・ROTATEで使用終了。取り消し・重ね使用はできません。" : "Declare before answering one Order. Correct calculations (PROVE, CIPHER, FHE, MPC, EC, SNARK, iO) pay double. LEAK, expiry or ROTATE spends it; no undo or stacking."}</div>
    {!armed && (!eligible ? <div>{ja ? "一覧から、まだ回答していない計算のお題を選んでください。じゃんけんの勝敗点（DUEL）は対象外。旧版のお題も回答履歴不明のため対象外です。" : "Pick a calculation Order with no recorded answer attempt. Duel win/draw points do not qualify, nor do older Orders with unknown answer history."}</div>
      : <button type="button" className="tc-hint-button" disabled={busy || !onDeclare} onClick={() => onDeclare?.(target!)}>{ja ? `このお題へ指定 · 正解 +${points} 点` : `Declare for this Order · correct +${points} pt`}</button>)}
    {armed && <div>{ja ? "誤答後も期限内は同じお題を解き直せます。通常ルールで報酬が0になる場合、2倍しても0点です。" : "After a wrong answer, retry the same Order before its deadline. A reward forfeited to 0 under the normal rules still doubles to 0."}</div>}
    {armed && order?.id !== target && <button type="button" className="tc-hint-button" disabled={busy || remaining <= 0 || !onSelect} onClick={() => onSelect?.(target!)}>{ja ? "指定したお題へ戻る" : "Return to the declared Order"}</button>}
    {armed && remaining <= 0 && <div>{ja ? "期限を迎えました。裁定結果を更新中です。" : "The deadline has passed. Refreshing the verdict."}</div>}
  </aside>;
}
