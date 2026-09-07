import type { RotorTaskProjection } from "../game/src/rotor.ts";

type Locale = "ja" | "en";
export const ROTOR_EXPLANATIONS = {
  ja: {
    name: "位置が進む2つの車輪",
    steps: [
      {
        title: "同じ数字でも、位置が変わると別の変換",
        lines: [
          "車輪は数字0〜3を一対一に読み替える表です。P、Qの順に通し、1文字出すたび速い車輪aを1進めます。aが3→0なら遅い車輪bも1進みます。bも3の次は0です。",
          "初期位置は自分と審判だけが知ります。同じ世代のお題は毎回同じ初期位置から始めます。3個の鍵を順に足す方式とは異なり、位置の進行と対応表が変換を決めます。",
        ],
      },
      {
        title: "位置を足す→表を引く→位置を引く",
        lines: [
          "mod 4は4で割った余り。負なら4を足して0〜3へ戻します。P=[1,3,0,2]、Q=[3,0,2,1]、表は左から0番です。mは元の数字、uは途中、cは出力。u=(P[(m+a) mod 4]−a) mod 4、c=(Q[(u+b) mod 4]−b) mod 4。",
          "別の例：m3,a0,b1ならP[3]=2でu2。Q[3]=1から1を引きc0。出力後a1,b1へ。",
          "初期位置は16通りしかない教材です。公開1組で特定できる場合も、候補が複数残る場合もあります。実用Enigmaそのものではなく、段は安全性の順位を表しません。",
        ],
      },
    ],
  },
  en: {
    name: "Two wheels with advancing positions",
    steps: [
      {
        title: "Different positions can transform the same digit differently",
        lines: [
          "A wheel replaces digits 0–3 one-to-one. Pass through P then Q; after each output advance fast wheel a by 1. When a wraps 3→0, advance slow wheel b too; b also wraps 3→0.",
          "Only your team and the judge know the initial positions. Each Order in the same generation starts from the same initial positions. Unlike adding three repeated keys, this model changes its replacement according to the advancing positions and tables.",
        ],
      },
      {
        title: "Add position → look up → subtract position",
        lines: [
          "mod 4 means remainder after division by 4; if negative, add 4 to return to 0–3. P=[1,3,0,2], Q=[3,0,2,1], numbered from 0 on the left. m is original, u intermediate, c output: u=(P[(m+a) mod 4]−a) mod 4; c=(Q[(u+b) mod 4]−b) mod 4.",
          "Separate example: m3,a0,b1 gives P[3]=2, so u2. Q[3]=1 minus 1 gives c0. Output first, then a1,b1.",
          "This teaching model has only 16 initial positions. One public pair may identify them, or leave multiple candidates. It is not actual Enigma and rungs do not rank security.",
        ],
      },
    ],
  },
} as const;

export function NumericCards({
  values,
}: {
  readonly values: readonly number[];
}) {
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      {values.map((v, i) => (
        <span
          key={i}
          style={{
            border: "1px solid #8496a8",
            borderRadius: 4,
            minWidth: 25,
            textAlign: "center",
            padding: "2px 4px",
            background: "#fff",
            color: "#152b42",
          }}
        >
          {v}
        </span>
      ))}
    </span>
  );
}

/** Public constant tables only; this never enumerates candidates or solves a live row. */
export function RotorRules({ locale }: { readonly locale: Locale }) {
  const ja = locale === "ja";
  return (
    <div
      className="tc-rotor-rules"
      style={{ fontSize: 13, lineHeight: 1.45, overflowWrap: "anywhere" }}
    >
      <p>
        {ja
          ? "車輪は数字0〜3を読み替える表です。元の数字m → 速い車輪P → 途中u → 遅い車輪Q → 暗号の数字c。a・bは今の車輪の位置です。"
          : "Wheels replace digits 0–3: original m → fast wheel P → intermediate u → slow wheel Q → encrypted c. a,b are the current wheel positions."}
      </p>
      <p>
        <strong>
          {ja
            ? "出力してからaを1進める。aが3→0ならbも1進める（bも3の次は0）。"
            : "Output first, then advance a by 1. When a wraps 3→0, advance b too (also wrapping 3→0)."}
        </strong>
      </p>
      <p>
        {ja
          ? "4で割った余りを mod 4 と書きます。負なら4を足して0〜3へ。P=[1,3,0,2]、Q=[3,0,2,1]、左から0番です。"
          : "Write the remainder after division by 4 as mod 4; if negative, add 4 to return to 0–3. P=[1,3,0,2], Q=[3,0,2,1], numbered from 0 on the left."}
      </p>
      <code style={{ display: "block" }}>
        u = (P[(m+a) mod 4] − a) mod 4<br />c = (Q[(u+b) mod 4] − b) mod 4
      </code>
      <details>
        <summary>
          {ja
            ? "一桁例と、位置ごとの早見表"
            : "One-digit example and position lookup"}
        </summary>
        <p>
          {ja
            ? "別の例：m3,a0,b1 → P[3]=2でu2 → Q[3]=1から1を引いてc0 → 次はa1,b1。下の表はこの式を全位置で計算済みです。P行はa、Q行はbで選び、各行の左から入力0・1・2・3に対応します。"
            : "Separate example: m3,a0,b1 → P[3]=2 gives u2 → Q[3]=1 minus 1 gives c0 → next a1,b1. The table precomputes the formula for each position. Choose a for P, b for Q; entries correspond to inputs 0,1,2,3 from the left."}
        </p>
        <table
          style={{
            width: "100%",
            textAlign: "center",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr>
              <th>{ja ? "位置" : "Position"}</th>
              <th>P: m → u</th>
              <th>Q: u → c</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["1 3 0 2", "3 0 2 1"],
              ["2 3 1 0", "3 1 0 2"],
              ["2 0 3 1", "0 3 1 2"],
              ["3 2 0 1", "2 0 1 3"],
            ].map(([p, q], i) => (
              <tr key={i}>
                <th>{i}</th>
                <td>
                  <code>{p}</code>
                </td>
                <td>
                  <code>{q}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          {ja
            ? "初期位置が分かれば元の数字も戻せます。各文字の位置でQの出力cを探して入力uを読み、次にPの出力uを探して入力mを読みます。例のa0,b1,c0なら、Qの位置1の行で0は入力2、Pの位置0の行で2は入力3なので元は3です。"
            : "Knowing the initial positions also recovers originals: at each character's positions, find output c in Q's row to read input u, then find u in P's row to read input m. In the example a=0,b=1,c=0, Q row 1 gives input 2; P row 0 gives input 3. The original is 3."}
        </p>
      </details>
    </div>
  );
}

export default function RotorMaterials({
  task,
  locale,
}: {
  readonly task: RotorTaskProjection;
  readonly locale: Locale;
}) {
  const ja = locale === "ja";
  return (
    <div className="tc-rotor-materials">
      <RotorRules locale={locale} />
      <p>
        {ja ? "自分の初期位置" : "Your initial positions"}:{" "}
        <strong>
          a={task.myInitial.a} · b={task.myInitial.b}
        </strong>
        <br />
        {ja ? "元の列" : "Original row"}:{" "}
        <NumericCards values={task.plaintext} />
      </p>
      <p>
        {ja
          ? "4文字とも計算し、出力cだけを元の順に4個入力します。再挑戦も初期位置から。"
          : "Calculate all four characters and enter only the four outputs c in order. Each retry starts from the initial positions."}
      </p>
      <details>
        <summary>
          {ja
            ? "4行の記入表・同じ初期位置を使うと？"
            : "Four-row worksheet · reusing initial positions"}
        </summary>
        <table style={{ width: "100%", textAlign: "center" }}>
          <thead>
            <tr>
              {["m", "a", "b", "u", "c"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {task.plaintext.map((m, i) => (
              <tr key={i}>
                <td>{m}</td>
                <td>{i === 0 ? task.myInitial.a : "?"}</td>
                <td>{i === 0 ? task.myInitial.b : "?"}</td>
                <td>?</td>
                <td>?</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          {ja
            ? "同じ世代のお題は同じ初期位置から始まります。LEAKは元の列と答えを公開し、1組だけで初期位置を当てられる場合もあります。CIPHERはこの組を公開しません。初期位置16通りの教材であり、実用Enigmaや安全性の順位を示しません。"
            : "Each Order in a generation restarts from the same initial positions. LEAK publishes the original and encrypted rows; even one pair can reveal the initial positions. CIPHER keeps the pair private. This is a 16-state teaching model, not actual Enigma or a ranking of security."}
        </p>
      </details>
    </div>
  );
}
