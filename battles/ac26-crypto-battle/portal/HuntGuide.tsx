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
    <table><thead><tr><th>{ja ? "かけらの番号" : "Share number"}</th><th>{ja ? "公開された値" : "Public value"}</th><th>{ja ? "この番号用の掛ける数" : "Factor for these indices"}</th></tr></thead><tbody>{rows.map(row => <tr key={row.index}><td>#{row.index}</td><td>y{row.index} = {row.value}</td><td>f{row.index} = {row.factor}</td></tr>)}</tbody></table>
    <p>{ja ? "yは公開された値、fはその番号用の掛ける数です。選んだ番号の f×y を全部足し、下の割る数で割った余りが秘密です。" : "y is a public value; f is its index-specific factor. Add f×y for the selected indices, then take the remainder after division by the number below to recover the secret."}</p>
    <code className="tc-hunt-formula">{rows.map(row => `f${row.index} × y${row.index}`).join(" + ")} → {projection.prime} {ja ? "で割った余り = 秘密" : "remainder = secret"}</code>
    <ol className="tc-visual-steps">
      <li>{ja ? "それぞれを掛けて、足す" : "Multiply each value by its factor, then add"}<code className="tc-hunt-formula">{rows.map(row => `(${row.factor}) × ${row.value}`).join(" + ")} = □</code></li>
      <li>{ja ? `${projection.prime} で割った余りを求める` : `Take the remainder after division by ${projection.prime}`}<p>{ja ? `①の合計を N とします。電卓で N ÷ ${projection.prime} を計算し、その値以下で最大の整数を q とします（例：−0.86 なら −1）。余りは N − ${projection.prime} × q。0〜${BigInt(projection.prime)-1n} の数になります。` : `Call the total N. Calculate N ÷ ${projection.prime}; let q be the greatest integer no larger than that result (e.g. −0.86 gives −1). The remainder is N − ${projection.prime} × q, within 0–${BigInt(projection.prime)-1n}.`}</p></li>
      <li>{ja ? "下の欄に、秘密だと思う数を1つ入れて送る" : "Enter the one recovered number below and submit"}</li>
    </ol>
    <details className="tc-why" open><summary>{ja ? "なぜ、この掛ける数で秘密が戻る？" : "Why do these factors recover the secret?"}</summary><p>{ja ? "かけらを作るときに混ぜた数の部分が消え、秘密の部分だけが残るように掛ける数を選んでいます。番号が変わると、掛ける数も変わります。" : "The factors cancel the terms mixed in when the shares were made, leaving the secret. Different share indices need different factors."}</p><p>{ja ? "小さな例（割る数7・番号1,2,3）：値が2,5,3なら、3×2 − 3×5 + 3 = −6 → 7を足して1。これが元の秘密です。" : "Small example, divisor 7 and indices 1,2,3: values 2,5,3 give 3×2−3×5+3=−6. Add 7 to recover secret 1."}</p></details>
  </div>;
}

export const HUNT_GUIDE_CSS = `
.tc-hunt-entry .tc-target-chip{color:#392955;background:#fff;font-size:13px;min-height:40px}.tc-hunt-entry .tc-target-chip[aria-pressed="true"]{background:#e9e0fa;color:#2a1945}.tc-hunt-entry input,.tc-hunt-entry select{background:#fff;color:#16212e;border:1px solid #8394a9;border-radius:6px;padding:9px;font-size:16px}.tc-hunt-entry input:focus-visible,.tc-hunt-entry button:focus-visible{outline:3px solid #3372b5;outline-offset:3px}.tc-hunt-entry h2{margin:0 0 10px;font-size:20px}.tc-hunt-notice{padding:10px;background:#ebe4f9;border-radius:8px;font-size:14px;line-height:1.6}.tc-hunt-opponents{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,310px),1fr));gap:12px}.tc-hunt-opponent{background:#fff;border:1px solid #d8d0e8;border-radius:10px;padding:12px}.tc-hunt-opponent h3{margin:0 0 10px;font-size:18px}.tc-hunt-opponent h3 small{font-size:12px;font-weight:500}.tc-hunt-method{padding:10px 0;border-top:1px solid #e3ddee}.tc-hunt-method>div{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;font-size:14px}.tc-hunt-method p{font-size:12px;line-height:1.6;margin:6px 0}.tc-hunt-state{border:1px solid #b9b0c8;border-radius:5px;padding:2px 6px;font-size:12px}.tc-hunt-ready .tc-hunt-state{background:#e2f3e6;color:#215e36;border-color:#5c946c}.tc-hunt-completed .tc-hunt-state,.tc-hunt-pending .tc-hunt-state{background:#e5ecf9}.tc-hunt-workspace{margin-top:16px;scroll-margin:16px}.tc-hunt-workspace:focus{outline:2px solid #7c60a8;outline-offset:3px}.tc-hunt-confirm{padding:12px;background:#f2ebff;border:1px solid #b4a1d3;border-radius:8px;line-height:1.8;font-size:14px}.tc-hunt-workspace .tc-submit-small{min-height:44px}.tc-hunt-workspace input{max-width:100%;box-sizing:border-box}

.tc-hunt-intro p,.tc-hunt-worksheet p{font-size:12px;line-height:1.6}.tc-attack-flow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px}.tc-attack-flow>span{background:#fff;border:1px solid #c8bce5;padding:9px;border-radius:8px}.tc-rival-progress{display:grid;gap:8px;margin:12px 0}.tc-rival-progress>div{display:grid;grid-template-columns:1fr auto;gap:6px;padding:10px;background:#fff;border:1px solid #d7d0e9;border-radius:9px}.tc-rival-progress small{grid-column:1/-1;font-size:12px}.tc-rival-progress i{display:inline-block;width:12px;height:12px;border:1px solid #a79abd;border-radius:3px;margin-right:3px}.tc-rival-progress .tc-clue-on{background:#8755bd}.tc-hunt-worksheet{padding:12px;background:#f8f5ff;border:1px solid #d6c9eb;border-radius:10px;margin:10px 0}.tc-hunt-worksheet table{width:100%;border-collapse:collapse;margin:10px 0;font-size:12px}.tc-hunt-worksheet th,.tc-hunt-worksheet td{padding:8px;border-bottom:1px solid #ddd3eb;text-align:center}.tc-hunt-formula{display:block;white-space:normal;overflow-wrap:anywhere;font-size:20px;font-weight:800;padding:12px 0}.tc-hunt-entry{border:1px solid #c8bce5;border-radius:10px;background:#f7f4ff;padding:12px}.tc-hunt-entry>summary{font-size:15px;font-weight:800;cursor:pointer}.tc-rival-score{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:#4d4170}.tc-terms-note{font-size:11px;color:#596779;line-height:1.6;margin:6px 0}
`;
