/**
 * [Issue #709] The 4x4 grid, drawn and typed.
 *
 * PROVE is now a hand relabelling of a sudoku solution, so the participant has
 * to SEE their solution, see the other teams' puzzles, and ENTER sixteen digits
 * -- three surfaces that all want the same shape. One component for the
 * read-only grid and one for the editable grid keep the four boxes, the row
 * order and the blank-cell convention identical everywhere, which matters
 * because "which cell is which" is the entire content of the exercise.
 *
 * Browser-safe: nothing here reaches `../game/src/` beyond a type. The digits
 * are plain text, not glyphs, so there is nothing to render as tofu.
 */

import type { SudokuGrid as Grid } from "../game/src/sudoku.ts";

export const SUDOKU_CSS = `
.tc-sudoku{display:inline-grid;grid-template-columns:repeat(4,1fr);gap:0;border:2px solid #202b3c;border-radius:6px;overflow:hidden;background:#fff;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.tc-sudoku-cell{display:flex;align-items:center;justify-content:center;border:1px solid #cfd8e3;font-weight:800;color:#16212e;background:#fff}
.tc-sudoku-cell:nth-child(2),.tc-sudoku-cell:nth-child(6),.tc-sudoku-cell:nth-child(10),.tc-sudoku-cell:nth-child(14){border-right:2px solid #202b3c}
.tc-sudoku-cell:nth-child(5),.tc-sudoku-cell:nth-child(6),.tc-sudoku-cell:nth-child(7),.tc-sudoku-cell:nth-child(8){border-bottom:2px solid #202b3c}
.tc-sudoku-blank{color:#b8c4ce;background:#f8fafc}
.tc-sudoku-lit{background:#fff3d6}
.tc-sudoku-input{width:100%;height:100%;border:0;text-align:center;font:inherit;font-weight:800;color:#16212e;background:transparent;padding:0}
.tc-sudoku-input:focus{outline:2px solid #0972d3;outline-offset:-2px;background:#f1f8ff}
.tc-sudoku-caption{font-size:10px;font-weight:700;letter-spacing:.06em;color:#5f6b7a;margin-bottom:3px}
.tc-perm-table{display:inline-flex;gap:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;flex-wrap:wrap}
.tc-perm-table span{border:1px solid #cfd8e3;border-radius:6px;padding:2px 6px;background:#fff}
`;

/** A read-only grid. `0` renders blank. `lit` marks cell indices to highlight (an opened group). */
export function SudokuBoard({
  cells,
  size = 26,
  lit,
  label,
}: {
  readonly cells: Grid;
  readonly size?: number;
  readonly lit?: readonly number[];
  readonly label?: string;
}) {
  return (
    <div className="tc-sudoku" role="img" aria-label={label ?? cells.map((v) => (v === 0 ? "." : String(v))).join(" ")}>
      {cells.map((v, i) => (
        <span
          key={i}
          className={`tc-sudoku-cell${v === 0 ? " tc-sudoku-blank" : ""}${lit?.includes(i) ? " tc-sudoku-lit" : ""}`}
          style={{ width: size, height: size, fontSize: size * 0.55 }}
        >
          {v === 0 ? "·" : v}
        </span>
      ))}
    </div>
  );
}

/** Sixteen one-digit boxes. `value` is the raw text per cell; parsing is the caller's. */
export function SudokuInput({
  value,
  onChange,
  size = 30,
  ariaLabel,
}: {
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  readonly size?: number;
  readonly ariaLabel: string;
}) {
  return (
    <div className="tc-sudoku" aria-label={ariaLabel}>
      {value.map((text, i) => (
        <span key={i} className="tc-sudoku-cell" style={{ width: size, height: size, fontSize: size * 0.55 }}>
          <input
            className="tc-sudoku-input"
            aria-label={`${ariaLabel}-${i}`}
            inputMode="numeric"
            maxLength={1}
            value={text}
            onChange={(event) => {
              const next = [...value];
              next[i] = event.target.value.replace(/[^1-4]/g, "").slice(-1);
              onChange(next);
            }}
          />
        </span>
      ))}
    </div>
  );
}

/** An all-blank input state. */
export function emptyCells(): string[] {
  return new Array<string>(16).fill("");
}

/** The sixteen typed cells as numbers, or `undefined` if any is not 1-4. */
export function parseCells(value: readonly string[]): number[] | undefined {
  if (value.length !== 16) return undefined;
  const cells = value.map((t) => Number(t));
  return cells.every((v) => Number.isInteger(v) && v >= 1 && v <= 4) ? cells : undefined;
}

/** `[2,3,4,1]` as `1→2 2→3 3→4 4→1`, one chip per digit. */
export function PermutationChips({ pi }: { readonly pi: readonly number[] }) {
  return (
    <span className="tc-perm-table">
      {pi.map((to, from) => (
        <span key={from}>
          {from + 1}→{to}
        </span>
      ))}
    </span>
  );
}

/** "row 2" / "column 3" / "box 1", 1-based, for a ledger reveal's group index. */
export function describeRevealGroup(group: number, locale: "ja" | "en"): string {
  const index = (group % 4) + 1;
  if (group < 4) return locale === "ja" ? `${index} 行目` : `row ${index}`;
  if (group < 8) return locale === "ja" ? `${index} 列目` : `column ${index}`;
  return locale === "ja" ? `箱 ${index}` : `box ${index}`;
}
