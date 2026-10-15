import { useState } from "react";
import type {
  CryptoBattleOp,
  CryptoBattleProjection,
  RotorPairArtifact,
} from "../game/src/types.ts";
import { NumericCards, RotorRules } from "./RotorMaterials.tsx";

export default function RotorHunt({
  projection,
  target,
  locale,
  submitting,
  onSubmit,
}: {
  readonly projection: CryptoBattleProjection;
  readonly target: {
    readonly teamId: string;
    readonly generation: number;
    readonly pairs: readonly RotorPairArtifact[];
    readonly left?: number;
  };
  readonly locale: "ja" | "en";
  readonly submitting: boolean;
  readonly onSubmit: (op: CryptoBattleOp) => Promise<void>;
}) {
  const [a, setA] = useState(""),
    [b, setB] = useState("");
  const ja = locale === "ja",
    name = projection.teams[target.teamId]?.teamName || target.teamId;
  const valid = /^[0-3]$/.test(a) && /^[0-3]$/.test(b);
  return (
    <section className="tc-hunt-card" aria-label={`${name} · Rotor`}>
      <h3>
        {name} · Rotor · {ja ? "世代" : "Generation"} {target.generation}
      </h3>
      <p>
        {ja
          ? "公開された元の列と暗号の列から、最初の車輪の位置a・bを計算します。初期位置は16通りです。公開1組だけで特定できる場合も、複数候補が残る場合もあります。"
          : "Use the public original/encrypted pairs to recover initial a,b. There are 16 initial states. One pair may identify them, or leave several candidates."}
      </p>
      {target.pairs.map((pair) => (
        <details key={pair.id} open={pair === target.pairs[0]}>
          <summary>{pair.contractId.replace(/^.*-c/, "ORDER #")}</summary>
          <p>
            {ja ? "元 m" : "Original m"}:{" "}
            <NumericCards values={pair.plaintext} />
            <br />
            {ja ? "暗号 c" : "Encrypted c"}:{" "}
            <NumericCards values={pair.ciphertext} />
          </p>
        </details>
      ))}
      <RotorRules locale={locale} />
      <p>
        {ja
          ? "候補a・bから4文字を順に変換し、公開cと合わない候補を外します。別のお題を照合するときは、進んだ位置を引き継がず同じ初期a・bに戻します。候補を1つに決められない間は提出せず、別の公開を待ちます。"
          : "Transform each character from a candidate a,b and discard candidates that disagree with public c. Restart from that same initial a,b when checking another Order. If you cannot determine one candidate, wait for another public pair before submitting."}
      </p>
      <p className="tc-hunt-confirm">
        {ja
          ? `攻撃相手：${name}（世代${target.generation}）`
          : `Target: ${name} (generation ${target.generation})`}{" "}
        · +{projection.huntWinPoints ?? "?"} ·{" "}
        {ja
          ? `誤答−${projection.wrongHuntCost}点（0点未満にはなりません）・残り${target.left ?? "?"}回`
          : `Miss −${projection.wrongHuntCost} (score floor 0) · ${target.left ?? "?"} attempts left`}
      </p>
      <p className="tc-card-hint">
        {ja
          ? "回数はほかのHUNTと共通（同じ相手・世代へのシェア復元とじゃんけん予測）。成功はこの方式で1回。現在の世代だけが対象です。"
          : "Attempts are shared with secret-share recovery and RPS predictions against this opponent/generation. One success per method. Only the current generation can be attacked."}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <label>
          {ja ? "最初のa（速い車輪）" : "Initial a (fast)"}
          <input
            aria-label="rotor-hunt-a"
            inputMode="numeric"
            maxLength={1}
            value={a}
            onChange={(e) => setA(e.target.value)}
            style={{ display: "block", width: 72 }}
          />
        </label>
        <label>
          {ja ? "最初のb（遅い車輪）" : "Initial b (slow)"}
          <input
            aria-label="rotor-hunt-b"
            inputMode="numeric"
            maxLength={1}
            value={b}
            onChange={(e) => setB(e.target.value)}
            style={{ display: "block", width: 72 }}
          />
        </label>
      </div>
      <button
        type="button"
        className="tc-submit-small"
        disabled={
          submitting || !valid || target.left === undefined || target.left === 0
        }
        onClick={() => {
          if (valid && !submitting && target.left)
            void onSubmit({
              kind: "hunt-rotor",
              targetTeamId: target.teamId,
              generation: target.generation,
              a: Number(a),
              b: Number(b),
            });
        }}
      >
        {ja ? `${name}を攻撃する` : `Attack ${name}`}
      </button>
    </section>
  );
}
