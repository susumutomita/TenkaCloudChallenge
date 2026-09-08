/** Small teaching example, separate from the participant's actual input. */
export default function MpcMaskDiagram({ locale }: { readonly locale: "ja" | "en" }) {
  const ja = locale === "ja";
  return <figure style={{ margin: "8px 0", padding: 12, border: "1px solid #cfd8e3", borderRadius: 8 }}>
    <figcaption><strong>{ja ? "小さな例：3人で合計する" : "Small example: three people add together"}</strong></figcaption>
    <p>{ja ? "マスクは、2人の間だけで共有する乱数（ランダムに選ぶ数）です。この例だけは、仕組みを見るため全部の数を表示します。" : "A mask is a random number shared privately by a pair of participants. Only this example shows every number so you can follow the mechanism."}</p>
    <p>{ja ? "内緒で交換：A → 4 → B → 2 → C → 1 → A" : "Private exchange: A → 4 → B → 2 → C → 1 → A"}</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
      {[["A", 2, 1, 4, -1], ["B", 3, 4, 2, 5], ["C", 1, 2, 1, 2]].map(([name, input, received, sent, result]) =>
        <div key={name} style={{ padding: 8, background: "#eef5fc", color: "#163c60", borderRadius: 6 }}>
          <strong>{name}</strong> · {ja ? "秘密の数" : "Secret input"} {input}
          <div style={{ fontSize: 18 }}>{input} + {received} − {sent} = <strong>{result}</strong></div>
          <small>{ja ? "自分 ＋ 受け取った数 − 送った数" : "Own + received − sent"}</small>
        </div>)}
    </div>
    <p>{ja ? "7で割った余りで公開します。−1は7を足して6。小計は6・5・2、合計13の余りは6です。元の数の合計2＋3＋1＝6と一致します。" : "Publish remainders after division by 7: −1 + 7 = 6. Subtotals 6, 5, 2 sum to 13, with remainder 6, equal to the original total 2 + 3 + 1."}</p>
    <details><summary>{ja ? "なぜ一致する？ 式で確認" : "Why does it match? Check the equation"}</summary>
      <p>{ja ? "4はAで引き、Bで足します。2と1も同じように打ち消し合います。" : "A subtracts 4 and B adds 4. The numbers 2 and 1 cancel in the same way."}</p>
      <code style={{ overflowWrap: "anywhere" }}>(a + z − x) + (b + x − y) + (c + y − z) = a + b + c</code>
      <p>{ja ? "a・b・c は秘密の入力、x・y・z は内緒で交換した数です。今回の問題では最後に、指定された数で割った余りを使います。合計も同じ数で割った余りになります。" : "a, b, c are secret inputs; x, y, z are privately exchanged masks. In this problem, use remainders after division by the given number; the aggregate is also a remainder."}</p>
    </details>
    <p>{ja ? "合計と自分の入力から分かる情報は隠せません。2人だけなら、合計から自分の数を引くと相手の数が分かります。" : "The total and your own input still reveal what can be deduced from them. With only two participants, subtracting your input from the total reveals the other input."}</p>
  </figure>;
}
