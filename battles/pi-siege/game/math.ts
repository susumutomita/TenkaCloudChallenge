export interface Fraction { n: bigint; d: bigint }
function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}
export function fraction(n: bigint | number, d: bigint | number = 1): Fraction {
  let a = BigInt(n), b = BigInt(d);
  if (b === 0n) throw new Error("zero denominator");
  if (b < 0n) { a = -a; b = -b; }
  const g = gcd(a, b);
  return { n: a / g, d: b / g };
}
export const add = (a: Fraction, b: Fraction) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Fraction, b: Fraction) => fraction(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Fraction, b: Fraction) => fraction(a.n * b.n, a.d * b.d);
export const compare = (a: Fraction, b: Fraction) => a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
export const abs = (a: Fraction) => fraction(a.n < 0n ? -a.n : a.n, a.d);
export const format = (a: Fraction) => a.d === 1n ? String(a.n) : `${a.n}/${a.d}`;
export const decimal = (a: Fraction) => (Number(a.n) / Number(a.d)).toPrecision(7);

function atanBounds(q: bigint, terms: number): [Fraction, Fraction] {
  let sum = fraction(0);
  for (let k = 0; k < terms; k++) {
    sum = add(sum, fraction(k % 2 === 0 ? 1n : -1n, BigInt(2 * k + 1) * q ** BigInt(2 * k + 1)));
  }
  const next = add(sum, fraction(terms % 2 === 0 ? 1n : -1n, BigInt(2 * terms + 1) * q ** BigInt(2 * terms + 1)));
  return compare(sum, next) < 0 ? [sum, next] : [next, sum];
}
// Machin's identity and alternating-series bounds. Only the server imports this module.
const [lo5, hi5] = atanBounds(5n, 30);
const [lo239, hi239] = atanBounds(239n, 10);
export const PI_LO = sub(mul(fraction(16), lo5), mul(fraction(4), hi239));
export const PI_HI = sub(mul(fraction(16), hi5), mul(fraction(4), lo239));

export function approximation(p: number, q: number) {
  const r = fraction(p, q);
  const a = abs(sub(r, PI_LO)), b = abs(sub(r, PI_HI));
  const high = compare(a, b) > 0 ? a : b;
  const low = compare(r, PI_LO) >= 0 && compare(r, PI_HI) <= 0 ? fraction(0) : compare(a, b) < 0 ? a : b;
  const cubed = fraction(1, BigInt(q) ** 3n);
  return {
    // Decimal display is an estimate, not outward-rounded certified endpoints.
    // Every decision below uses the exact rational enclosure, before rounding.
    value: `${p}/${q}`, error: `約${decimal(high)}`,
    cubic: compare(high, cubed) < 0 ? "below" as const : compare(low, cubed) >= 0 ? "above" as const : "uncertain" as const,
    scaledHigh: mul(high, fraction(BigInt(q) ** 2n)),
  };
}
export interface Cell { n: number; d: number }
export type Cells = [Cell, Cell, Cell, Cell];
export function table(cells: Cells) {
  const [a, b, c, d] = cells.map(v => fraction(v.n, v.d)) as [Fraction, Fraction, Fraction, Fraction];
  const determinant = sub(mul(a, d), mul(b, c));
  let common = 1n;
  for (const v of [a, b, c, d]) common = common / gcd(common, v.d) * v.d;
  return { determinant, common, floor: fraction(1, common * common), small: compare(abs(determinant), fraction(1, 8)) <= 0 };
}
export function candidateCost(rows: number, ones: number) {
  const zeroes = rows - ones;
  return ones + zeroes * (zeroes - 1) / 2 + ones * (ones - 1) / 2;
}
export function minimumCost(rows: number) {
  return Math.min(...Array.from({ length: rows + 1 }, (_, ones) => candidateCost(rows, ones)));
}
export function allocation(n: number, d: number) {
  const b = fraction(n, d), one = fraction(1), nu = fraction(9, 4);
  const collision = sub(mul(fraction(2), b), one);
  const error = sub(mul(nu, sub(one, b)), one);
  const delta = fraction(1, 10), theta = fraction(9, 10), a = sub(one, mul(b, delta));
  const actualCollision = sub(theta, mul(a, a));
  const actualError = sub(mul(nu, sub(a, theta)), sub(one, theta));
  return { collision, error, actualCollision, actualError, weakest: compare(collision, error) < 0 ? collision : error,
    valid: [collision, error, actualCollision, actualError].every(v => v.n > 0n) };
}
