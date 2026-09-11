import { exposedKeyPositions } from "../game/src/ladder.ts";
import type { ContractProjection, CryptoBattleProjection } from "../game/src/types.ts";
import { orderLabel } from "./orderTask.ts";

type Locale = "ja" | "en";

/** Name the actual disclosed asset, not the original secret. */
export function orderHeading(order: ContractProjection, locale: Locale): string {
  if (order.task.kind === "reveal-share") {
    const pieces = order.task.shareIndices.map((i) => `#${i}`).join("・");
    if (order.privacyConstraint === "must-disclose") {
      return locale === "ja"
        ? `シェア ${pieces} を公開して得点する（秘密分散・公開が条件）`
        : `A request to publish your secret share ${pieces} (publication required, full points)`;
    }
    const canLeak = order.allowedMethods.includes("leak");
    const spentProof = order.schnorr?.pending?.used && order.schnorr.pending.outcome === "miss";
    const canProve = order.allowedMethods.includes("prove") && !spentProof;
    if (canLeak && !canProve) return locale === "ja" ? `かけら ${pieces} を公開して答える` : `Publish share ${pieces} to answer`;
    if (!canLeak && canProve) return locale === "ja" ? "かけらを公開せず、計算で証明する" : "Complete the proof calculation without publishing a share";
    if (canLeak && canProve) return locale === "ja" ? `かけら ${pieces} を公開して即答するか、計算で証明する` : `Publish share ${pieces}, or complete the proof calculation`;
    return orderLabel(order, locale);
  }
  return orderLabel(order, locale);
}

/** Preview uses only this team's projection. Never compute an unsubmitted cipher answer. */
export function disclosurePreview(projection: CryptoBattleProjection, order: ContractProjection, locale: Locale): string {
  const ja = locale === "ja";
  if (order.task.kind === "rotor-encrypt") return ja
    ? "守るもの：車輪の初期位置。公開するもの：元の4文字と暗号の4文字。相手は対応から初期位置a・bを計算し、HUNTに入力します。1組で特定できる場合もありますが、候補が残る場合もあります。"
    : "Protect: initial wheel positions. Publish: four original and four encrypted digits. Opponents calculate initial a and b for HUNT. One pair may suffice, but multiple candidates can remain.";
  if (order.task.kind === "rsa-encrypt") return ja
    ? "公開するもの：元の数 m と暗号の答え c（平文と暗号文）・公開鍵n/e。RSAのHUNTはmやcではなく、nを作る異なる素数2個を入力します。この小さいnは公開鍵だけで攻撃でき、LEAKは不要です。"
    : "Publish: plaintext m, ciphertext c and public n/e. RSA HUNT takes two distinct prime factors of n, not m or c. This tiny n is attackable from the public key alone; LEAK is not required.";
  if (order.task.kind === "caesar-shift") {
    if (order.task.rung === "vigenere") {
      const pairs = projection.publicLedger.filter(a => a.kind === "cipher-pair" && a.teamId === projection.vault.teamId && a.generation === projection.vault.generation && a.rung === "vigenere").filter(a => a.kind === "cipher-pair");
      const before = exposedKeyPositions(pairs, "vigenere");
      const after = exposedKeyPositions([...pairs, order.task], "vigenere");
      return ja
        ? `守るもの：3個の鍵。公開するもの：鍵の位置${(order.task.keyPosition ?? 0) + 1}の平文と暗号文の対応（鍵自体ではない）。材料がある位置 ${before.length} → ${after.length}/3。相手は位置ごとに暗号文−平文を計算し、割った余りを鍵1・2・3の順でHUNTに入力します。`
        : `Protect: three keys. Publish: plaintext/ciphertext pairs for key position ${(order.task.keyPosition ?? 0) + 1}, not the key itself. Covered positions ${before.length} → ${after.length}/3. Opponents subtract plaintext from ciphertext, take remainders and enter keys 1, 2, 3 in HUNT.`;
    }
    return ja
      ? `守るもの：ずらす数＝鍵。公開するもの：平文（元の数）と暗号文の対応。相手は暗号文−平文を計算し、文字の種類の数で割った余りを「鍵」としてHUNTに入力します。平文や暗号文を当てるのではありません。必要な材料は ${order.task.pairsToBreak} 組です。`
      : `Protect: the shift (key). Publish: plaintext/ciphertext pairs. Opponents subtract plaintext from ciphertext and take the remainder using the alphabet size, then enter the key in HUNT, not the plaintext or ciphertext. Evidence required: ${order.task.pairsToBreak} pair(s).`;
  }
  if (order.task.kind !== "reveal-share") return "";
  const indices = new Set(projection.publicLedger.flatMap((entry) =>
    entry.kind === "share" && entry.teamId === projection.vault.teamId && entry.generation === projection.vault.generation
      ? [entry.shareIndex] : []));
  const before = indices.size;
  for (const index of order.task.shareIndices) indices.add(index);
  const after = indices.size;
  const pieces = order.task.shareIndices.map(index => `#${index}`).join("・");
  return ja
    ? `守るもの：元の秘密の数。公開するもの：かけら ${pieces} の番号と値。元の秘密そのものではありません。同じ組の公開済み番号 ${before} → ${after} 個（必要な異なる番号は${projection.threshold}個。同じ番号は1個）。${after >= projection.threshold ? "復元の材料がそろいます。" : `異なる${projection.threshold}個が必要です。`} 相手がHUNTで答えるのは、かけらから復元した元の秘密です。`
    : `Protect: the original secret. Publish: indices and values of shares ${pieces}, not the original secret. Distinct current-set indices ${before} → ${after}/${projection.threshold}; duplicates count once. ${after >= projection.threshold ? "Reconstruction evidence will be complete." : `${projection.threshold} distinct shares are needed.`} Opponents submit the reconstructed original secret in HUNT.`;
}
