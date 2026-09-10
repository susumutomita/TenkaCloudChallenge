import { useState } from "react";
import EncryptedCargo from "./EncryptedCargo.tsx";

export function checkFirstMission(left: string, right: string): boolean {
  return /^0{0,699}5$/.test(left.trim()) && /^0{0,699}2$/.test(right.trim());
}

/** Fixed public practice: no coordination client, deadline or scoring mutation. */
export default function FirstMission({ locale, onLearn, onDone }: { locale: "ja" | "en"; onLearn: () => void; onDone: () => void }) {
  const ja = locale === "ja";
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [result, setResult] = useState<boolean | null>(null);
  return <>
    <p><strong>{ja ? "練習専用：時間制限・得点・減点なし。何度でもやり直せます。" : "Practice only: no deadline, points or penalties. Unlimited retries."}</strong></p>
    <EncryptedCargo locale={locale} inputs={[{ r: 2, y: 4 }, { r: 3, y: 5 }]} prime={7} left={left} right={right}
      onLeft={value => { setLeft(value); setResult(null); }} onRight={value => { setRight(value); setResult(null); }} />
    <button type="button" className="tc-help-control tc-first-submit" disabled={!left.trim() || !right.trim()} onClick={() => setResult(checkFirstMission(left, right))}>
      {ja ? "2つの答えを確認する（練習）" : "Check both answers (practice)"}
    </button>
    <div role="status">{result === false && <p>{ja ? "まだ一致していません。左どうし・右どうしを足し、7以上なら7を引きます。減点はありません。" : "Not quite. Add each column separately, then subtract 7 if the total is at least 7. No penalty."}</p>}
      {result === true && <><h3>{ja ? "配送完了！中身を開けずに、合計の暗号文を作れました。" : "Delivered! You combined the ciphertexts without opening them."}</h3>
        <p>{ja ? "これは中身の合計ではなく、合計を隠した数の組です。競技でも同じ手順で計算しますが、締切と減点があります。" : "This pair keeps the sum of the numbers inside hidden. Competition uses the same operation, with deadlines and penalties."}</p>
        <button type="button" className="tc-help-control" onClick={onLearn}>{ja ? "なぜ開けずに計算できる？図で見る" : "How did that work? View the diagrams"}</button>{" "}
        <button type="button" className="tc-help-control" onClick={onDone}>{ja ? "体験を終えてお題へ戻る" : "Finish practice and return to Orders"}</button>
      </>}
    </div>
  </>;
}
