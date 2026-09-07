/** Small teaching example, separate from the participant's actual input. */
export default function MpcMaskDiagram({ locale }: { readonly locale: "ja" | "en" }) {
  const ja = locale === "ja";
  return <figure style={{ margin: "8px 0", padding: 12, border: "1px solid #cfd8e3", borderRadius: 8 }}>
    <figcaption><strong>{ja ? "小さな例：3人で合計する" : "Small example: three people add together"}</strong></figcaption>
    <p>{ja ? "内緒で交換：A → 4 → B → 2 → C → 3 → A" : "Private exchange: A → 4 → B → 2 → C → 3 → A"}</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
      {[["A", 2, 3, 4, 1], ["B", 3, 4, 2, 5], ["C", 1, 2, 3, 0]].map(([name, input, received, sent, result]) =>
        <div key={name} style={{ padding: 8, background: "#eef5fc", color: "#163c60", borderRadius: 6 }}>
          <strong>{name}</strong> · {ja ? "秘密の数" : "Secret input"} {input}
          <div style={{ fontSize: 18 }}>{input} + {received} − {sent} = <strong>{result}</strong></div>
          <small>{ja ? "自分 ＋ 受け取った数 − 送った数" : "Own + received − sent"}</small>
        </div>)}
    </div>
    <p>{ja ? "公開する小計は 1・5・0。合計は 1＋5＋0＝6。元の数の合計 2＋3＋1＝6 と一致します。" : "Publish subtotals 1, 5, 0. Their sum is 6, equal to the original total 2 + 3 + 1."}</p>
    <details><summary>{ja ? "なぜ一致する？ 式で確認" : "Why does it match? Check the equation"}</summary>
      <p>{ja ? "4はAで引き、Bで足します。2と3も同じように打ち消し合います。" : "A subtracts 4 and B adds 4. The numbers 2 and 3 cancel in the same way."}</p>
      <code style={{ overflowWrap: "anywhere" }}>(a + z − x) + (b + x − y) + (c + y − z) = a + b + c</code>
      <p>{ja ? "a・b・c は秘密の入力、x・y・z は内緒で交換した数です。今回の問題では最後に、指定された数で割った余りを使います。合計も同じ数で割った余りになります。" : "a, b, c are secret inputs; x, y, z are privately exchanged masks. In this problem, use remainders after division by the given number; the aggregate is also a remainder."}</p>
    </details>
  </figure>;
}
