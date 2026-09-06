import type { CryptoBattleProjection, ShareArtifact } from "../game/src/types.ts";
import { inv, mod } from "../game/src/field.ts";

/** Public numbers only. Return the factors, never the recovered secret. */
export function huntWorksheet(projection: CryptoBattleProjection, teamId: string, generation: number) {
  if (teamId === projection.vault.teamId || projection.teams[teamId]?.generation !== generation) return undefined;
  const pieces = new Map<number, ShareArtifact>();
  for (const item of projection.publicLedger) {
    if (item.kind === "share" && item.teamId === teamId && item.generation === generation) pieces.set(item.shareIndex, item);
  }
  const shares = [...pieces.values()].sort((a, b) => a.shareIndex - b.shareIndex).slice(0, projection.threshold);
  if (shares.length < projection.threshold) return undefined;
  const p = BigInt(projection.prime);
  return shares.map(piece => {
    const x = BigInt(piece.shareIndex);
    let factor = 1n;
    for (const other of shares) {
      if (other.shareIndex !== piece.shareIndex) factor = mod(factor * -BigInt(other.shareIndex) * inv(x - BigInt(other.shareIndex), p), p);
    }
    if (factor > p / 2n) factor -= p;
    return { index: piece.shareIndex, value: piece.value, factor: factor.toString() };
  });
}

export function HuntIntro({ projection, locale }: { readonly projection: CryptoBattleProjection; readonly locale: "ja" | "en" }) {
  const ja = locale === "ja";
  return <div className="tc-hunt-intro">
    <p>{ja ? "HUNT（ハント）は、相手が公開した情報から秘密を当てる攻撃です。下で材料を選び、計算した答えを送ります。" : "HUNT means recovering an opponent’s secret from information they published. Choose evidence below, calculate, then submit."}</p>
    <div className="tc-attack-flow" aria-label={ja ? "攻撃の3段階" : "Three attack steps"}><span>1. {ja ? "相手の公開情報を集める" : "Collect opponent evidence"}</span><b aria-hidden="true">→</b><span>2. {ja ? "秘密を計算する" : "Calculate the secret"}</span><b aria-hidden="true">→</b><span>3. {ja ? "答えを送って攻撃" : "Submit your attack"}</span></div>
    <p>{ja ? `まずは秘密のかけらを使う方法。同じ相手・同じ世代の、異なる番号が ${projection.threshold} 個必要です。世代は、同じ秘密から作った一組を表します。` : `Start with secret shares. You need ${projection.threshold} distinct numbers from the same opponent and generation (one set made from one secret).`}</p>
    <div className="tc-rival-progress">{Object.values(projection.teams).filter(t => t.teamId !== projection.vault.teamId).map(t => {
      const count = new Set(projection.publicLedger.flatMap(a => a.kind === "share" && a.teamId === t.teamId && a.generation === t.generation ? [a.shareIndex] : [])).size;
      return <div key={t.teamId}><strong>{t.teamName || t.teamId} · {t.score} {ja ? "点" : "pt"}</strong><span>{Array.from({ length: projection.threshold }, (_, i) => <i key={i} className={i < count ? "tc-clue-on" : ""} aria-hidden="true" />)} {count}/{projection.threshold}</span><small>{count >= projection.threshold ? (ja ? "材料がそろいました。下で計算できます。" : "Evidence ready. Calculate below.") : (ja ? `あと ${projection.threshold - count} 個。相手が「公開して答える」を選ぶと増えます。` : `${projection.threshold-count} more needed. An opponent’s LEAK can add a new share.`)}</small></div>;
    })}</div>
  </div>;
}

export default function HuntGuide({ projection, target, locale }: {
  readonly projection: CryptoBattleProjection;
  readonly target: { readonly teamId: string; readonly generation: number };
  readonly locale: "ja" | "en";
}) {
  const rows = huntWorksheet(projection, target.teamId, target.generation);
  const ja = locale === "ja";
  if (!rows) return <p className="tc-card-hint">{ja ? "まだ計算に必要なかけらが足りません。別の相手を選ぶか、公開情報が増えるのを待ちます。" : "Not enough current-generation shares. Choose another opponent or wait for more evidence."}</p>;
  return <div className="tc-hunt-worksheet">
    <strong>{ja ? "この公開情報で計算する" : "Calculate from this public evidence"}</strong>
    <table><thead><tr><th>{ja ? "かけらの番号" : "Share number"}</th><th>{ja ? "公開された値" : "Public value"}</th><th>{ja ? "この番号用の掛ける数" : "Factor for these indices"}</th></tr></thead><tbody>{rows.map(row => <tr key={row.index}><td>#{row.index}</td><td>{row.value}</td><td>{row.factor}</td></tr>)}</tbody></table>
    <ol className="tc-visual-steps">
      <li>{ja ? "それぞれを掛けて、足す" : "Multiply each value by its factor, then add"}<code className="tc-hunt-formula">{rows.map(row => `(${row.factor}) × ${row.value}`).join(" + ")} = □</code></li>
      <li>{ja ? `${projection.prime} で割った余りを求める` : `Take the remainder after division by ${projection.prime}`}<p>{ja ? `負なら ${projection.prime} を足し、${projection.prime} 以上なら引きます。0〜${BigInt(projection.prime)-1n} に入るまで繰り返します。` : `Add ${projection.prime} if negative; subtract it if too large. Repeat until within 0–${BigInt(projection.prime)-1n}.`}</p></li>
      <li>{ja ? "下の欄に、秘密だと思う数を1つ入れて送る" : "Enter the one recovered number below and submit"}</li>
    </ol>
    <details className="tc-why"><summary>{ja ? "なぜ、この掛ける数で秘密が戻る？" : "Why do these factors recover the secret?"}</summary><p>{ja ? "かけらを作るときに混ぜた数の部分が消え、秘密の部分だけが残るように掛ける数を選んでいます。番号が変わると、掛ける数も変わります。" : "The factors cancel the terms mixed in when the shares were made, leaving the secret. Different share indices need different factors."}</p><p>{ja ? "小さな例（割る数7・番号1,2,3）：値が2,5,3なら、3×2 − 3×5 + 3 = −6 → 7を足して1。これが元の秘密です。" : "Small example, divisor 7 and indices 1,2,3: values 2,5,3 give 3×2−3×5+3=−6. Add 7 to recover secret 1."}</p></details>
  </div>;
}

export const HUNT_GUIDE_CSS = `
.tc-hunt-intro p,.tc-hunt-worksheet p{font-size:12px;line-height:1.6}.tc-attack-flow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px}.tc-attack-flow>span{background:#fff;border:1px solid #c8bce5;padding:9px;border-radius:8px}.tc-rival-progress{display:grid;gap:8px;margin:12px 0}.tc-rival-progress>div{display:grid;grid-template-columns:1fr auto;gap:6px;padding:10px;background:#fff;border:1px solid #d7d0e9;border-radius:9px}.tc-rival-progress small{grid-column:1/-1;font-size:12px}.tc-rival-progress i{display:inline-block;width:12px;height:12px;border:1px solid #a79abd;border-radius:3px;margin-right:3px}.tc-rival-progress .tc-clue-on{background:#8755bd}.tc-hunt-worksheet{padding:12px;background:#f8f5ff;border:1px solid #d6c9eb;border-radius:10px;margin:10px 0}.tc-hunt-worksheet table{width:100%;border-collapse:collapse;margin:10px 0;font-size:12px}.tc-hunt-worksheet th,.tc-hunt-worksheet td{padding:8px;border-bottom:1px solid #ddd3eb;text-align:center}.tc-hunt-formula{display:block;white-space:normal;overflow-wrap:anywhere;font-size:20px;font-weight:800;padding:12px 0}.tc-hunt-entry{border:1px solid #c8bce5;border-radius:10px;background:#f7f4ff;padding:12px}.tc-hunt-entry>summary{font-size:15px;font-weight:800;cursor:pointer}.tc-rival-score{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:#4d4170}.tc-terms-note{font-size:11px;color:#596779;line-height:1.6;margin:6px 0}
`;
