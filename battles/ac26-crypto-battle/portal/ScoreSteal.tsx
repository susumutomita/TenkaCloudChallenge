import React, { useState } from "react";
import type { StealOp, StealTask, StealView } from "../game/src/score-steal.ts";

export function ScoreItemOrder({
  task,
  contractId,
  busy,
  locale,
  onSubmit,
}: {
  task: StealTask;
  contractId: string;
  busy: boolean;
  locale: string;
  onSubmit: (op: StealOp) => void;
}) {
  const ja = locale === "ja";
  const [material, setMaterial] = useState("");
  const [answer, setAnswer] = useState("");
  let key: number | undefined;
  try {
    const parsed = JSON.parse(material);
    if (Number.isInteger(parsed.key) && parsed.key >= 1 && parsed.key <= 9) key = parsed.key;
  } catch {
    /* The user is still pasting the AWS value. */
  }
  return (
    <section aria-label={ja ? "AWSの鍵で復号" : "Decrypt with an AWS key"}>
      <h3>
        {ja
          ? "AWSの鍵で復号 → 横取りアイテムを1個獲得"
          : "Decrypt with an AWS key → earn one score item"}
      </h3>
      <p>
        {ja
          ? "正解すると、後で相手から最大10点を移せます。獲得・使用は1試合1回。まだ得点は動きません。"
          : "A correct answer earns an item that transfers up to10 points later. Acquire and use once per match. No points move yet."}
      </p>
      <ol>
        <li>
          {ja
            ? "問題ページの「AWS Consoleを開く」でログインしてから、下のリンクを開きます。"
            : "Sign in using Open AWS Console on the problem page, then open the link below."}
          <br />
          <a
            className="tc-submit-small"
            href={task.consoleUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {ja ? "AWSで鍵の値を見る ↗" : "Read the key in AWS ↗"}
          </a>
          <p>
            <code>{task.parameterName}</code>
          </p>
          <label>
            {ja
              ? "Valueの全体をコピーして貼る（keyとreceipt）"
              : "Paste the complete Value (key and receipt)"}
            <textarea
              rows={3}
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              maxLength={512}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </li>
        <li>
          <strong>{ja ? "暗号文から鍵を引く" : "Subtract the key from the ciphertext"}</strong>
          <p className="tc-formula">
            {task.ciphertext} − {key ?? "鍵 / key"} →{" "}
            {ja ? "負なら10を足す → 答え □" : "if negative, add10 → answer □"}
          </p>
          <p>
            {ja
              ? "暗号化は c=(m+k)を10で割った余り。復号は m=(c−k)を10で割った余りです。例：暗号文2、鍵5なら2−5=−3、10を足して7。"
              : "Encryption:c=(m+k) remainder10. Decryption:m=(c−k) remainder10. Example:2−5=−3; add10 to get7."}
          </p>
          <label>
            {ja ? "復号した数字（0〜9）" : "Decrypted digit (0–9)"}
            <input
              inputMode="numeric"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              maxLength={1}
            />
          </label>
        </li>
      </ol>
      <button
        className="tc-submit-small"
        disabled={busy || key === undefined || !/^[0-9]$/.test(answer)}
        onClick={() =>
          onSubmit({
            kind: "claim-steal",
            contractId,
            nonce: task.nonce,
            material,
            answer: Number(answer),
          })
        }
      >
        {ja ? "答えを送ってアイテムを獲得" : "Submit to acquire the item"}
      </button>
      <p>
        {ja
          ? "小さい数の足し引きで暗号化・復号の対応を学ぶ模型です。receiptはAWSの値と照合する受付コードで、計算には使いません。値は公開記録へ載りません。"
          : "This tiny model teaches inverse encryption/decryption. The receipt authenticates the retrieved AWS value; it is not used in the arithmetic or published."}
      </p>
    </section>
  );
}

export function ScoreItemInventory({
  view,
  busy,
  ended,
  locale,
  onSubmit,
}: {
  view: StealView;
  busy: boolean;
  ended: boolean;
  locale: string;
  onSubmit: (op: StealOp) => void;
}) {
  const ja = locale === "ja";
  const [target, setTarget] = useState("");
  const [expanded, setExpanded] = useState(false);
  const selected = view.targets.find((t) => t.teamId === target);
  if (!view.held && !view.notices.length) return null;
  const name = (id: string) =>
    view.targets.find((t) => t.teamId === id)?.name ?? (ja ? "あなた" : "You");
  return (
    <section className="tc-score-item" aria-label={ja ? "横取りアイテム" : "Score item"}>
      {view.notices.map((n) => (
        <p role="status" key={`${n.from}:${n.to}`}>
          <strong>
            {view.targets.some((t) => t.teamId === n.from) ? "+" : "−"}
            {n.points}
            {ja ? "点" : " pt"}
          </strong>{" "}
          · {name(n.from)} → {name(n.to)}
          {ja ? "（横取りアイテム）" : " (score item)"}
        </p>
      ))}
      {view.held && (
        <>
          <button className="tc-submit-small" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {ja ? "横取り ×1 · 使う相手を選ぶ" : "Score item ×1 · Choose opponent"}
          </button>
          {expanded && <div>
          <select
            aria-label={ja ? "横取りの相手" : "Score item target"}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">{ja ? "相手を選択" : "Select opponent"}</option>
            {view.targets.map((t) => (
              <option key={t.teamId} value={t.teamId} disabled={t.protected || t.points <= 0}>
                {t.name} · {t.score}{ja ? "点 · " : " pt · "}
                {t.protected
                  ? ja
                    ? "使用対象外（被害済み）"
                    : "Protected"
                  : ja
                    ? `移せる${t.points}点`
                    : `Up to ${t.points} points`}
              </option>
            ))}
          </select>
          <p>
            {ja
              ? "相手の実際の残点から最大10点を移します。同じチームが奪われるのは1試合1回です。"
              : "Transfer up to10 of the opponent’s remaining points. Each team can lose points this way once per match."}
          </p>
          <button
            className="tc-submit-small"
            disabled={busy || ended || !selected || selected.protected || selected.points <= 0}
            onClick={() => onSubmit({ kind: "use-steal", nonce: view.nonce, targetTeamId: target })}
          >
            {selected
              ? ja
                ? `${selected.name}から最大${selected.points}点を移す`
                : `Transfer up to ${selected.points} points from ${selected.name}`
              : ja
                ? "相手を選ぶと使用できます"
                : "Choose an opponent first"}
          </button>
          </div>}
        </>
      )}
    </section>
  );
}
