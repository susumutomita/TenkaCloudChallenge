import type { OrderTaskProjection } from "../game/src/types.ts";

type MpcTask = Extract<OrderTaskProjection, { kind: "masked-total" }>;

export function mpcWorksheet(task: MpcTask, prime: string, locale: "ja" | "en") {
  const incoming = task.incomingMasks.reduce((sum, value) => sum + BigInt(value), 0n).toString();
  const outgoing = task.outgoingMasks.reduce((sum, value) => sum + BigInt(value), 0n).toString();
  const received = task.incomingMasks.join(" + ") || "0";
  const sent = task.outgoingMasks.join(" + ") || "0";
  return locale === "ja" ? [
    { label: "足す数をまとめる", calculation: `${received} = ${incoming}`, note: "受け取った覆面は、全部足します。" },
    { label: "引く数をまとめる", calculation: `${sent} = ${outgoing}`, note: "送った覆面も、先に全部足します。" },
    { label: "自分の数に足し引きする", calculation: `${task.myInput} + ${incoming} − ${outgoing} = □`, note: `自分の数は ${task.myInput} です。上の 2 つの合計を使って計算してください。` },
    { label: "最後に、割った余りを入力する", calculation: `③ の答えを ${prime} で割った余り → 下の回答欄`, note: `答えがマイナスなら ${prime} を足し、${prime} 以上なら ${prime} を引きます。0〜${BigInt(prime) - 1n} に入るまで繰り返します。` },
  ] : [
    { label: "Total the numbers to add", calculation: `${received} = ${incoming}`, note: "Add all received masks." },
    { label: "Total the numbers to subtract", calculation: `${sent} = ${outgoing}`, note: "First add all sent masks together." },
    { label: "Apply both totals to your own number", calculation: `${task.myInput} + ${incoming} − ${outgoing} = □`, note: `Your number is ${task.myInput}. Work out this expression using the two totals above.` },
    { label: "Enter the remainder below", calculation: `Divide the result of step 3 by ${prime} → enter the remainder`, note: `If negative, add ${prime}. If ${prime} or above, subtract ${prime}. Repeat until it is between 0 and ${BigInt(prime) - 1n}.` },
  ];
}

export default function MpcWorksheet({ task, prime, locale }: { readonly task: MpcTask; readonly prime: string; readonly locale: "ja" | "en" }) {
  return <div className="tc-calculation-guide">
    <p>{locale === "ja" ? "下の 4 段階で計算し、最後の数を回答欄に入れます。最初の 2 つの足し算は、ここにまとめてあります。" : "Follow these four steps and enter the final number. The first two totals are worked out for you."}</p>
    <ol className="tc-calculation-steps">{mpcWorksheet(task, prime, locale).map((step, i) =>
      <li key={step.label}><span className="tc-calculation-number">{i + 1}</span><div><strong>{step.label}</strong><code>{step.calculation}</code><p>{step.note}</p></div></li>
    )}</ol>
  </div>;
}
