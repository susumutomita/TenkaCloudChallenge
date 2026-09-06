import { cipherKeyAt } from "../game/src/ladder.ts";
import type { OrderTaskProjection } from "../game/src/types.ts";
import { DieRow } from "./DieFace.tsx";

export default function VigenereMaterials({ task, locale }: {
  readonly task: Extract<OrderTaskProjection, { kind: "caesar-shift" }>;
  readonly locale: "ja" | "en";
}) {
  const ja = locale === "ja", position = (task.keyPosition ?? 0) + 1;
  return <section aria-label="Vigenère">
    <p className="tc-card-hint">{ja ? "Vigenère（ヴィジュネル）暗号：3個の秘密の鍵を、鍵1→鍵2→鍵3→鍵1…と繰り返します。今回のお題はその1位置です。" : "Vigenère repeats three secret shifts: key 1 → key 2 → key 3 → key 1. This Order is one position from that cycle."}</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{[0, 1, 2].map(i => <span key={i} style={{ padding: 6, border: i + 1 === position ? "2px solid #1673b1" : "1px solid #aaa", borderRadius: 4 }}>
      {ja ? "鍵" : "Key "}{i + 1}: <strong>{cipherKeyAt(task.myKey, i)}</strong>{i + 1 === position ? (ja ? " ← 今回" : " ← this Order") : ""}
    </span>)}</div>
    <p>{ja ? "元の記号（平文）" : "Original symbol (plaintext)"}: <DieRow values={task.plaintext} size={28} /> <code>{task.plaintext.join(" ")}</code></p>
    <p className="tc-hunt-formula">{ja ? `暗号の番号 = (元の番号 + 鍵${position}) を6で割った余り。サイコロの面1〜6の計算用番号は0〜5です。` : `Encrypted value = (original value + key ${position}), taking the remainder after dividing by 6. Die faces 1–6 use calculation values 0–5.`}</p>
    <p className="tc-card-hint">{ja ? "例：元4・使う鍵3なら4+3=7、6を引いて1。下の欄へ答えの番号1個を入れ、CIPHERで非公開提出します。" : "Example: original 4, selected key 3: 4+3=7; subtract 6 to get 1. Enter your one answer below and press CIPHER to submit privately."}</p>
    <div className="tc-card-warn">{ja ? `LEAKすると鍵${position}が分かる組を公開します。鍵の位置1・2・3が揃うと全鍵を回収されます。同じ位置の公開だけでは揃いません。` : `LEAK exposes key position ${position}. All three distinct positions reveal the entire key; repeated records for one position do not.`}</div>
    <p className="tc-card-hint">{ja ? "長い列の1組で3位置すべてを公開すれば、それだけで全鍵が分かります。鍵を繰り返すこの方式は現代の安全な暗号ではありません。" : "A single long pair covering all three positions reveals every key. This repeated-key method is not a modern secure cipher."}</p>
  </section>;
}
