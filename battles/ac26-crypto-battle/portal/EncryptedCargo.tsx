/** Shared teaching surface. Never receives plaintext or decryption keys. */
export default function EncryptedCargo({ locale, inputs, prime, left, right, onLeft, onRight }: {
  locale: "ja" | "en"; inputs: readonly { r: string | number; y: string | number }[]; prime: string | number;
  left: string; right: string; onLeft: (value: string) => void; onRight: (value: string) => void;
}) {
  const ja = locale === "ja";
  return <section className="tc-cargo" aria-label={ja ? "開けずに合計を届けよう" : "Deliver a sum without opening it"}>
    <style>{`
      .tc-cargo{color:#183650}.tc-cargo h3{margin:8px 0;font-size:22px}
      .tc-cargo-route{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:12px;margin:16px 0}
      .tc-cargo-parcel{border:2px solid #85aac6;border-radius:12px;padding:14px;background:#edf6ff}
      .tc-cargo-pair{display:flex;gap:12px;margin-top:10px}.tc-cargo-pair span{flex:1;min-width:0;overflow-wrap:anywhere;text-align:center;background:white;border:1px solid #bccdde;border-radius:6px;padding:8px;font-size:20px;font-weight:700}
      .tc-cargo-columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px}
      .tc-cargo-columns label{display:block;background:#f5f8fb;border:1px solid #bccdde;border-radius:12px;padding:14px}
      .tc-cargo-columns code{display:block;font-size:22px;margin:12px 0;overflow-wrap:anywhere}
      .tc-cargo input{display:block;box-sizing:border-box;max-width:100%;width:150px;min-height:44px;font:inherit;background:#fff;color:#183650;border:2px solid #607e98;border-radius:8px;margin-top:10px;padding:8px}
      .tc-cargo input:focus-visible{outline:3px solid #0972d3;outline-offset:2px}
      .tc-cargo details{margin:14px 0}.tc-cargo summary{cursor:pointer;font-weight:700}
    `}</style>
    <h3>{ja ? "開けずに、合計を届けよう" : "Deliver the total. Keep the contents sealed."}</h3>
    <p>{ja ? "あなたは暗号の配送係。中身の数を知らないまま、届いた暗号文を1つにまとめます。" : "You are the courier. Combine these encrypted packages without learning the numbers inside."}</p>
    <div className="tc-cargo-route">{inputs.map((input, index) => <div className="tc-cargo-parcel" key={index}>
      <strong>{ja ? `🔒 暗号文 ${index + 1}` : `🔒 Ciphertext ${index + 1}`}</strong>
      <div className="tc-cargo-pair"><span>{ja ? "左" : "Left"}<br />{input.r}</span><span>{ja ? "右" : "Right"}<br />{input.y}</span></div>
    </div>)}</div>
    <p>{ja ? `↓ 左と右を混ぜずに足す → それぞれ ${prime} で割った余りを、下の2欄に入力` : `↓ Add each column separately → enter each remainder after division by ${prime}`}</p>
    <div className="tc-cargo-columns">
      {(["r", "y"] as const).map((axis, index) => <label key={axis}>
        <strong>{ja ? `${index + 1}. ${index === 0 ? "左" : "右"}の合計を作る` : `${index + 1}. Add the ${index === 0 ? "left" : "right"} column`}</strong>
        <code>{inputs.map(input => input[axis]).join(" + ")} = □</code>
        {ja ? `□ を ${prime} で割った余り` : `Remainder of □ divided by ${prime}`}
        <input data-testid={`fast-fhe-${axis}`} aria-label={ja ? `${index === 0 ? "左" : "右"}の答え：${prime}で割った余り` : `${index === 0 ? "Left" : "Right"} answer: remainder after division by ${prime}`} inputMode="numeric" value={index === 0 ? left : right} onChange={event => (index === 0 ? onLeft : onRight)(event.target.value)} placeholder={ja ? `${index === 0 ? "左" : "右"}の答え` : `${index === 0 ? "Left" : "Right"} answer`} />
      </label>)}
    </div>
    <p>{ja ? `合計が ${prime} 未満なら、そのまま。${prime} 以上なら、${prime} を引いて 0〜${BigInt(prime) - 1n} に入るまで繰り返します。` : `A total below ${prime} stays unchanged. Otherwise subtract ${prime} until it is between 0 and ${BigInt(prime) - 1n}.`}</p>
    <details><summary>{ja ? "余りの小さい例と、暗号のしくみ" : "A small remainder example and the mechanism"}</summary>
      <p>{ja ? "例：7で割る場合、4 + 5 = 9、9 − 7 = 2。答えは余りの2です。「mod」はこの余りを表します。" : "Example with divisor 7: 4 + 5 = 9, then 9 − 7 = 2. The answer is the remainder, 2. ‘mod’ means this remainder."}</p>
      <p>{ja ? "式：(左の合計 mod p, 右の合計 mod p)。p は画面の割る数。暗号文は中身を隠した数の組です。右には中身と隠す数が混ざっています。足しても隠れたままなので、あなたには中身の合計は読めません。" : "Rule: (sum of left values mod p, sum of right values mod p). p is the displayed divisor. Each ciphertext is a pair hiding a number. Its right value mixes the content with a mask. Adding preserves that mask; you cannot read the plaintext total."}</p>
      <p>{ja ? "鍵を持つ判定側は、各入力の鍵と左の値を使って隠す数を取り除き、合計を確認します。これが準同型暗号の『復号せずに計算する』体験です。この教材は加算の模型で、掛け算も扱う完全準同型暗号（FHE）そのものではありません。" : "The judge uses each input’s key and left value to remove the masks and check the total. This models homomorphic computation without decryption. It is an addition model, not full FHE, which also supports multiplication."}</p>
    </details>
  </section>;
}
