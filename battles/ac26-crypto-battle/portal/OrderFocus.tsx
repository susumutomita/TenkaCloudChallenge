import { exposedKeyPositions } from "../game/src/ladder.ts";
import type { ContractProjection, CryptoBattleProjection } from "../game/src/types.ts";
import { taskLabel } from "./orderTask.ts";

type Locale = "ja" | "en";

/** The concrete request leads; protocol names are explained beside the work. */
export function orderHeading(order: ContractProjection, locale: Locale): string {
  if (order.task.kind === "reveal-share") {
    const pieces = order.task.shareIndices.map((i) => `#${i}`).join("・");
    return locale === "ja" ? `秘密のかけら ${pieces} を求められています` : `A request for your secret share ${pieces}`;
  }
  return taskLabel(order.task, locale);
}

/** Count only distinct indices of this team's current generation, including this request. */
export function disclosurePreview(projection: CryptoBattleProjection, order: ContractProjection, locale: Locale): string {
  if (order.task.kind === "caesar-shift") {
    if (order.task.rung === "vigenere") {
      const pairs = projection.publicLedger.filter(a => a.kind === "cipher-pair" && a.teamId === projection.vault.teamId && a.generation === projection.vault.generation && a.rung === "vigenere").filter(a => a.kind === "cipher-pair");
      const before = exposedKeyPositions(pairs, "vigenere");
      const after = exposedKeyPositions([...pairs, order.task], "vigenere");
      return locale === "ja" ? `鍵の位置${(order.task.keyPosition ?? 0) + 1}を公開。公開された位置 ${before.length} → ${after.length}/3。${after.length === 3 ? "全鍵を回収される材料が揃います。" : "異なる3位置が揃うと全鍵を回収されます。"}`
        : `Publishes key position ${(order.task.keyPosition ?? 0) + 1}. Covered positions ${before.length} → ${after.length}/3. ${after.length === 3 ? "All keys become recoverable." : "All three distinct positions reveal the entire key."}`;
    }
    return locale === "ja"
      ? `元の数と暗号の組を公開。${order.task.pairsToBreak} 組で相手に鍵を復元されます。`
      : `Publishes the original and encrypted row. ${order.task.pairsToBreak} pair(s) reveal your key.`;
  }
  if (order.task.kind !== "reveal-share") return "";
  const indices = new Set(projection.publicLedger.flatMap((entry) =>
    entry.kind === "share" && entry.teamId === projection.vault.teamId && entry.generation === projection.vault.generation
      ? [entry.shareIndex] : []));
  const before = indices.size;
  for (const index of order.task.shareIndices) indices.add(index);
  const after = indices.size;
  return locale === "ja"
    ? `公開済みのかけら ${before} → ${after} 個。${after >= projection.threshold ? "相手に秘密を復元される状態になります。" : `${projection.threshold} 個そろうと相手が秘密を復元できます。`}`
    : `Public shares: ${before} → ${after}. ${after >= projection.threshold ? "Your secret will be recoverable." : `${projection.threshold} distinct shares let an opponent recover your secret.`}`;
}
