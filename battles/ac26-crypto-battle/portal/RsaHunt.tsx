import { useState } from "react";
import type { CryptoBattleOp, CryptoBattleProjection } from "../game/src/types.ts";
import { parseRsaNumber, type PublicRsaKey } from "../game/src/rsa.ts";
import { RsaRecoveryExplanation } from "./RsaMaterials.tsx";

export default function RsaHunt({ target, projection, locale, submitting, onSubmit }: {
  readonly target: PublicRsaKey; readonly projection: CryptoBattleProjection; readonly locale: "ja" | "en";
  readonly submitting: boolean; readonly onSubmit: (op: CryptoBattleOp) => Promise<void>;
}) {
  const [p, setP] = useState(""), [q, setQ] = useState("");
  const ja = locale === "ja", name = projection.teams[target.teamId]?.teamName || target.teamId;
  // Format only. The participant, not this UI, performs the factorization.
  const valid = parseRsaNumber(p, target.n) !== undefined && parseRsaNumber(q, target.n) !== undefined;
  return <section className="tc-hunt-card" aria-label={`${name} · RSA`}>
    <h3>{name} · RSA · {ja ? "世代" : "Generation"} {target.generation}</h3>
    <p><strong>{ja ? "公開鍵" : "Public key"}: n = {target.n}, e = {target.e}</strong></p>
    <p>{ja ? "nを、異なる2つの素数の掛け算に分けます。素数は、1と自分以外では割り切れない2以上の整数です。2つの素数が分かると元に戻す鍵を計算できます。LEAKの公開を待つ必要はありません。" : "Split n into two distinct prime factors. A prime is an integer at least 2 divisible only by 1 and itself. The factors let you calculate a recovery key. No LEAK evidence is required."}</p>
    <code className="tc-hunt-formula">p × q = n → {ja ? "元に戻す鍵" : "recovery key"}</code>
    <p>{ja ? "小さい素数2・3・5…でnを割ります。割り切れたら、商（割り算の答え）も別の素数か確認。試す数の2乗がnを超えるまで調べれば十分です。見本：15=3×5。3と5は素数なので、この2個を順不同で入力します。" : "Try dividing n by small primes 2, 3, 5… . When it divides exactly, check that the quotient (division result) is a different prime. It suffices to try divisors whose square is at most n. Example: 15=3×5. Both are prime; enter the two in either order."}</p>
    <p className="tc-hunt-confirm">{ja ? `攻撃相手：${name}（世代 ${target.generation}）` : `Target: ${name} (generation ${target.generation})`}<br /><strong>n={target.n} · e={target.e}</strong> · {projection.huntWinPoints === undefined ? (ja ? "得点を更新中" : "Refreshing reward") : `+${projection.huntWinPoints}`} {ja ? "点 · 不正解は減点0・回数制限なし、成功は1回" : "pt · Wrong factors: no deduction or attempt cap; one success"}</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{([['p', p, setP], ['q', q, setQ]] as const).map(([label, value, setValue]) => <label key={label} className="tc-answer-label" style={{ flex: "1 1 100px", minWidth: 0 }}>{ja ? "素数" : "Prime factor"} {label}<input aria-label={ja ? `素数 ${label}` : `Prime factor ${label}`} inputMode="numeric" value={value} onChange={event => setValue(event.target.value)} style={{ boxSizing: "border-box", width: "100%" }} /></label>)}</div>
    <button type="button" className="tc-submit-small" disabled={submitting || !valid} onClick={() => { if (valid && !submitting) void onSubmit({ kind: "hunt-rsa", targetTeamId: target.teamId, generation: target.generation, p, q }); }}>{ja ? `${name}を攻撃する` : `Attack ${name}`}</button>
    <RsaRecoveryExplanation locale={locale} />
  </section>;
}
