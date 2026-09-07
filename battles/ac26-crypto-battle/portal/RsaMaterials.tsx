import type { RsaTask } from "../game/src/rsa.ts";

type Locale = "ja" | "en";
/** Fixed examples only: paid hints provide the selected Order's staged procedure. */
export const RSA_EXPLANATIONS = {
  ja: { name: "公開鍵と、元に戻す鍵", steps: [
    { title: "見せる鍵と、隠す鍵を分ける", lines: ["RSAでは暗号化するための数 n・e を公開します。元の数 m を e 回掛け、n で割った余り c を暗号文（中身を隠すために変換したデータ）とします。m^e は m を e 回掛ける記号、mod は割った余りです。", "掛け算の途中で余りにしても最後の余りは同じです。例：3^3 mod 7 は、3×3=9→2、2×3=6。これは余りの練習で、7をRSAの鍵に使う例ではありません。"] },
    { title: "因数が分かると、元に戻す鍵も計算できる", lines: ["素数は、1と自分以外の正の整数では割り切れない2以上の整数です。異なる素数 p・q の積が n です。φ（ファイ）=(p−1)×(q−1) を計算し、e×d を φ で割って1余る正の整数 d を探します。この d で c^d mod n を計算すると元の数 m に戻せます。", "例：n=33=3×11、e=3。φ=2×10=20、3×7=21→余り1なので d=7。元4を暗号化すると4^3=64→31。戻すには31²→4、31⁴→16、31⁷→16×4×31=1984→33で割った余り4。", "d=27も3×27=81→余り1で、同じように戻せます。元に戻す指数は1個に限りません。HUNTはdの一致ではなく、異なる素数2個の積が公開nになることを確認します。", "この教材は小さい数で、同じ元の数から同じ暗号が出ます。因数分解や元の数の総当たりが容易です。段が進んでも安全性の順位を示しません。実用RSAでは大きい鍵と、乱数を含む別の符号化手順が必要です。"] },
  ] },
  en: { name: "Public and recovery keys", steps: [
    { title: "Separate the public key from the recovery key", lines: ["RSA publishes n and e for encryption. Multiply e copies of original m and take the remainder after dividing by n to obtain ciphertext c: data transformed to hide its content. The notation m^e means e copies of m multiplied; mod means remainder.", "Taking remainders between multiplications preserves the final remainder. Example: 3^3 mod 7: 3×3=9→2, then 2×3=6. This practices remainders; 7 is not an RSA key example."] },
    { title: "Factors let you calculate a recovery key", lines: ["A prime is an integer at least 2 divisible only by 1 and itself. The product of distinct primes p and q is n. Calculate φ (phi)=(p−1)×(q−1), then find a positive integer d for which e×d leaves remainder 1 after division by φ. Calculating c^d mod n recovers original m.", "Example: n=33=3×11, e=3. φ=2×10=20, and 3×7=21 leaves 1, so d=7. Original 4 encrypts as 4^3=64→31. Recover it: 31²→4, 31⁴→16, then 31⁷→16×4×31=1984→remainder 4 after division by 33.", "d=27 also works: 3×27=81 leaves 1. Recovery exponents are not unique. HUNT checks that two distinct prime factors multiply to public n, not that d matches an internal value.", "This teaching model uses tiny numbers and the same original always produces the same ciphertext. Factoring or trying all originals is easy. Later rungs do not imply greater security. Practical RSA needs large keys and a separate encoding scheme with randomness."] },
  ] },
} as const;

export function RsaRecoveryExplanation({ locale }: { readonly locale: Locale }) {
  const step = RSA_EXPLANATIONS[locale].steps[1];
  return <details style={{ margin: "8px 0", overflowWrap: "anywhere" }}><summary>{locale === "ja" ? "なぜ因数で元に戻す鍵が分かる？" : "Why do factors reveal a recovery key?"}</summary>
    {step.lines.map(line => <p key={line}>{line}</p>)}
  </details>;
}

export default function RsaMaterials({ task, locale }: { readonly task: RsaTask; readonly locale: Locale }) {
  const ja = locale === "ja";
  return <div className="tc-rsa-materials" style={{ fontSize: 13, lineHeight: 1.45 }}>
    <style>{`.tc-rsa-materials p{margin:5px 0}.tc-rsa-materials .tc-hunt-formula{margin:5px 0}`}</style>
    <p>{ja ? "RSAは公開鍵 n・e で暗号化し、元に戻す鍵を隠します。" : "RSA encrypts with public n and e, keeping a recovery key secret."}</p>
    <p>{ja ? "^e は e 回掛けること、mod n は n で割った余り。途中も余りにできます。0以上n未満の整数1個で答えます。" : "^e means e copies multiplied; mod n means remainder after division by n. Intermediate remainders are allowed. Enter one integer from 0 to n−1."}</p>
    <details><summary>{ja ? "一桁の余りの例" : "One-digit remainder example"}</summary><p>{ja ? "別の数で練習：3^3 mod 7 → 3×3=9、余り2 → 2×3=6。これは余りの練習で、RSAの鍵の例ではありません。" : "Practice with different values: 3^3 mod 7 → 3×3=9, remainder 2 → 2×3=6. This is a remainder exercise, not an RSA key example."}</p></details>
    <p className="tc-card-hint">{ja ? "CIPHERでも、小さい公開nから鍵を計算されます。段は安全性の順位ではありません。" : "Even with CIPHER, this tiny public n reveals a recovery key through factoring. Rungs do not rank security."}</p>
    <RsaRecoveryExplanation locale={locale} />
    <p><strong>{ja ? "元の数" : "Original"} m = {task.plaintext}</strong> · {ja ? "公開鍵" : "Public key"} n = {task.n}, e = {task.e}</p>
    <code className="tc-hunt-formula">c = m^e mod n</code>
    <div role="img" aria-label={ja ? "元の数を繰り返し掛け、余りを暗号の答えにする" : "Repeatedly multiply the original and use its remainder as the encrypted answer"} style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", margin: "8px 0" }}>
      <code>m</code><span aria-hidden="true">→</span><code>m × … × m</code><span>({ja ? "e個" : "e copies"})</span><span aria-hidden="true">→</span><code>mod n</code><span aria-hidden="true">→</span><code>c</code>
    </div>

  </div>;
}
