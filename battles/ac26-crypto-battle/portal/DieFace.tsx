/**
 * [Issue #659 §3] A rung symbol, drawn rather than typed.
 *
 * The ladder's symbols carry the whole language-neutrality argument: a Japanese
 * and an English speaker read the same row, so neither is handed an advantage
 * the cryptography did not give them. That argument only holds if the symbol
 * actually APPEARS.
 *
 * It did not. Shipped as the Unicode die faces U+2680-2685, the Order rendered
 * as a run of tofu boxes on a real participant's screen — which fails the
 * premise in the worst possible way, because the reader cannot see the Order at
 * all, and it fails SILENTLY: a `document.fonts`-style check passed in one
 * browser while another painted boxes, so there is no runtime test that would
 * have caught it. Any glyph-based answer has that failure mode; only drawing
 * the pips removes it.
 *
 * So the symbol is an inline SVG. It depends on no font, renders identically
 * everywhere, scales with its box, and reads as a designed mark rather than a
 * character that happened to resolve. The `symbols` strings stay in the model
 * for what they are good at — the answer a participant may TYPE (`parseAnswer`
 * accepts a face or its value) and text-only surfaces like the operator's
 * `describeTaskShort`.
 */

const PIPS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  0: [[2, 2]],
  1: [[1, 1], [3, 3]],
  2: [[1, 1], [2, 2], [3, 3]],
  3: [[1, 1], [1, 3], [3, 1], [3, 3]],
  4: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
  5: [[1, 1], [1, 2], [1, 3], [3, 1], [3, 2], [3, 3]],
};

export function DieFace({ value, size = 22 }: { readonly value: number; readonly size?: number }) {
  const pips = PIPS[value];
  if (!pips) {
    // A rung whose alphabet is not dice, or a value out of range. Show the
    // number rather than an empty box: wrong-but-legible beats invisible.
    return (
      <span className="tc-die tc-die-fallback" style={{ width: size, height: size, fontSize: size * 0.6 }}>
        {value}
      </span>
    );
  }
  return (
    <svg
      className="tc-die"
      width={size}
      height={size}
      viewBox="0 0 4 4"
      role="img"
      // Named by its VALUE, not by a glyph a screen reader may not have either.
      aria-label={String(value)}
    >
      <rect x="0.15" y="0.15" width="3.7" height="3.7" rx="0.7" className="tc-die-body" />
      {pips.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="0.38" className="tc-die-pip" />
      ))}
    </svg>
  );
}

/** A whole row of symbols — a plaintext, a ciphertext, an alphabet. */
export function DieRow({
  values,
  size,
}: {
  readonly values: readonly number[];
  readonly size?: number;
}) {
  return (
    <span className="tc-die-row">
      {values.map((value, index) => (
        <DieFace key={`${index}-${value}`} value={value} size={size} />
      ))}
    </span>
  );
}

/** Shared styling, injected once by whichever panel renders first. */
export const DIE_CSS = `
.tc-die-row{display:inline-flex;gap:3px;align-items:center;flex-wrap:wrap}
.tc-die{display:inline-block;vertical-align:middle;flex:none}
.tc-die-body{fill:#fff;stroke:#7a869a;stroke-width:0.16}
.tc-die-pip{fill:#1f2937}
.tc-die-fallback{display:inline-flex;align-items:center;justify-content:center;border:1px solid #7a869a;border-radius:4px;background:#fff;font-weight:800;color:#1f2937}
`;
