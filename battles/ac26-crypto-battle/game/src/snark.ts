/** PLONK-style arithmetization worksheet, not a succinct or zero-knowledge proof. */
export type GateRow = readonly [number, number, number];
export interface ConstraintTask {
  readonly kind: 'snark-constraints';
  readonly rows: readonly [GateRow, GateRow, GateRow];
}
const mod = (n: number) => ((n % 7) + 7) % 7;
/** Three gate residuals, then the two required output-to-input wire residuals. */
export function constraintResiduals(task: ConstraintTask): readonly number[] {
  const [a, b, c] = task.rows;
  return [mod(a[0] + a[1] - a[2]), mod(b[0] * b[1] - b[2]),
    mod(c[0] + c[1] - c[2]), mod(a[2] - c[0]), mod(b[2] - c[1])];
}
export function constraintTask(bytes: readonly number[]): ConstraintTask {
  const a = bytes[0]! % 7, b = bytes[1]! % 7, c = bytes[2]! % 7, d = bytes[3]! % 7;
  const sum = mod(a + b), product = mod(c * d);
  const mode = bytes[4]! % 3;
  // A valid circuit, a wrong gate output, or locally valid gates with broken wiring.
  const copied = mode === 2 ? mod(sum + 1) : sum;
  return {kind: 'snark-constraints', rows: [[a, b, sum], [c, d, product],
    [copied, product, mod(copied + product + (mode === 1 ? 1 : 0))]]};
}
export function parseResiduals(answer: unknown): readonly number[] | undefined {
  return typeof answer === 'string' && /^[0-6]( [0-6]){4}$/.test(answer)
    ? answer.split(' ').map(Number) : undefined;
}
