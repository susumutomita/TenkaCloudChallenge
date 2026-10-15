import type { ContractProjection, CryptoBattleProjection } from "../game/src/types.ts";
import { PermutationChips, SudokuBoard, sudokuFillInGivens } from "./SudokuGrid.tsx";

type Locale = "ja" | "en";

/** A worked cell, linked to the currently selected table; never fills an answer. */
export function RelabelDiagram({ solution, table, locale }: {
  readonly solution: readonly number[];
  readonly table?: readonly number[];
  readonly locale: Locale;
}) {
  const ja = locale === "ja";
  // Use a worked cell, so the four holes remain the participant's own work.
  const index = table ? sudokuFillInGivens(solution, table).findIndex(cell => cell !== "") : 0;
  const from = solution[index]!;
  const to = table?.[from - 1];
  return <figure className="tc-relabel-guide" aria-label={ja ? "数字を付け替える図" : "Digit relabelling diagram"}>
    <figcaption>{ja ? "左の数字を、表の矢印で読み替える" : "Rename the left digit through your table"}</figcaption>
    <div className="tc-relabel-flow">
      <div><small>{ja ? "左の同じ位置" : "Same cell on the left"}</small><b>{from}</b></div>
      <span aria-hidden="true">→</span>
      <div><small>{ja ? "今回の置き換え" : "Assigned replacements"}</small><b>{table ? `${from} → ${to}` : "?"}</b></div>
      <span aria-hidden="true">→</span>
      <div><small>{ja ? "右に入れる数字" : "Digit on the right"}</small><b>{to ?? "□"}</b></div>
    </div>
    {table ? <><PermutationChips pi={table} /><p>{ja ? "この見本と同じように、空欄4マスを埋めます。" : "Use this same rule for the four holes."}</p></> : <p>{ja ? "PROVEを開くと、今回の置き換えと盤面が表示されます。" : "Open PROVE to see the assigned replacements and board."}</p>}
  </figure>;
}

/** Only mounted for an already revealed final hint. All inputs are this team's projection. */
export default function SudokuGuide({ order, projection, table, locale, onOpenProof }: {
  readonly order: ContractProjection;
  readonly projection: CryptoBattleProjection;
  readonly table?: readonly number[];
  readonly locale: Locale;
  readonly onOpenProof: () => void;
}) {
  const ja = locale === "ja";
  const exposed = new Set(projection.publicLedger.filter(a => a.kind === "share" && a.teamId === projection.vault.teamId && a.generation === projection.vault.generation).map(a => a.kind === "share" ? a.shareIndex : -1));
  const indices = order.task.kind === "reveal-share" ? [...new Set(order.task.shareIndices)] : [];
  const added = indices.filter(i => !exposed.has(i)).length;
  const after = exposed.size + added;
  const givens = table ? sudokuFillInGivens(projection.vault.sudokuSolution, table) : undefined;
  const workedCell = givens?.findIndex(cell => cell !== "") ?? 0;
  return <div className="tc-visual-hint">
    {order.allowedMethods.includes("prove") && <section>
      <strong>{ja ? "PROVE · 4マスを埋めて証明" : "PROVE · fill four holes"}</strong>
      <ol className="tc-visual-steps">
        <li>{ja ? "自動で用意された置き換えを確認" : "Check the automatically assigned replacements"}</li>
        <li>{ja ? "同じ位置の数字を読み替える" : "Rename the digit at the same position"}</li>
        <li>{ja ? "4マスを埋めて「答えを送る」" : "Fill four holes and Submit answer"}</li>
      </ol>
      <RelabelDiagram solution={projection.vault.sudokuSolution} table={table} locale={locale} />
      {table && <div className="tc-hint-grids">
        <div><small>{ja ? "元のマス" : "Original cells"}</small><SudokuBoard cells={projection.vault.sudokuSolution} size={28} lit={[workedCell]} /></div>
        <span aria-hidden="true">→</span>
        <div><small>{ja ? "同じ表で付け替える" : "Rename with the same table"}</small><SudokuBoard cells={givens!.map(cell => cell === "" ? 0 : Number(cell))} size={28} lit={[workedCell]} /></div>
      </div>}
      <button type="button" className="tc-submit-small" onClick={onOpenProof}>{ja ? "証明の入力欄へ" : "Go to proof inputs"}</button>
      <p>{ja ? "次回も未使用の表が自動で用意されます。同じ表の再利用は解が漏れる原因になります。" : "An unused table is assigned next time too. Reuse can expose your solution."}</p>
    </section>}
    {order.allowedMethods.includes("leak") && <details className="tc-why"><summary>{ja ? "LEAK · 計算せずに公開する場合" : "LEAK · publish without calculating"}</summary>
      <div className="tc-relabel-flow"><div><small>{ja ? "自分のかけら" : "Your shares"}</small><b>{indices.map(i => `#${i} = ${projection.vault.shares.find(s => s.index === i)?.value}`).join(", ")}</b></div><span aria-hidden="true">→</span><div><small>{ja ? "LEAK を押す" : "Press LEAK"}</small><b>{ja ? "公開記録" : "Public ledger"}</b></div></div>
      <p className="tc-hint-equation">{exposed.size} + {added} = {after} / {projection.threshold} {ja ? "個が公開" : "shares public"}</p>
      <p>{after >= projection.threshold ? (ja ? "相手が秘密を復元できる数に達します。" : "Enough shares to recover your secret.") : (ja ? "復元に必要な数にはまだ達しません。" : "Still below the recovery threshold.")}</p>
    </details>}
  </div>;
}

export const GUIDE_CSS = `
.tc-relabel-guide{margin:12px 0;padding:14px;border:1px solid #b8cde7;border-radius:12px;background:#f3f7ff;color:#173554}
.tc-relabel-guide figcaption{font-weight:700;font-size:14px}.tc-relabel-guide p,.tc-visual-hint p{font-size:12px;line-height:1.6;margin:8px 0}
.tc-relabel-flow{display:flex;gap:10px;align-items:center;justify-content:center;margin:14px 0;flex-wrap:wrap}.tc-relabel-flow>div{flex:1;min-width:70px;text-align:center;border:1px solid #bdd0e6;border-radius:10px;background:#fff;padding:10px 6px}.tc-relabel-flow small{display:block;font-size:11px}.tc-relabel-flow b{display:block;font-size:24px;margin-top:6px}.tc-relabel-flow>span{font-size:24px;color:#326bad}
.tc-visual-steps{padding-left:24px;font-size:13px;line-height:1.9}.tc-visual-hint section>strong{font-size:16px}.tc-hint-grids{display:flex;align-items:center;gap:16px;margin:12px 0;flex-wrap:wrap}.tc-hint-grids small{display:block;margin-bottom:6px}.tc-hint-equation{font-size:22px!important;font-weight:800}.tc-hint-rung{border-top:1px solid #dce5ef;padding:10px 0}.tc-hint-rung>summary{cursor:pointer;font-size:13px;font-weight:700}.tc-hint-rung[open]>summary{margin-bottom:10px}
@media(max-width:480px){.tc-relabel-flow{gap:5px}.tc-relabel-flow b{font-size:20px}.tc-relabel-flow>span{font-size:18px}}
`;
