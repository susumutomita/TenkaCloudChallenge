/** Finite-domain definition exercise. Enumerating every input is exponential
 * in input bit length and is NOT an efficient general-purpose iO construction. */
export type IoTable = readonly [number, number, number, number];
export interface IoTask {
  readonly kind: 'io-equivalence';
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly missing: readonly [number, number];
}
const mod = (n: number, p: number) => ((n % p) + p) % p;
/** Two straight-line programs, each with three arithmetic operations.
 * A: a*x; +b; +0. B: x+d; *a; +c. Every step is modulo 5. */
export function ioTables(task: IoTask): readonly [IoTable, IoTable] {
  return [
    [0,1,2,3].map(x=>mod(task.a*x+task.b,5)) as unknown as IoTable,
    [0,1,2,3].map(x=>mod(task.a*(x+task.d)+task.c,5)) as unknown as IoTable,
  ];
}
export interface IoEncoding { readonly offset: number; readonly cells: IoTable; }
/** Four equally likely representations. Only the function table is retained,
 * never the source-program identity. Offset is public, not an encryption key. */
export function ioEncode(table: IoTable, offset: number): IoEncoding {
  if(!Number.isInteger(offset)||offset<0||offset>3)throw new Error('offset must be 0..3');
  return {offset,cells:[0,1,2,3].map(i=>table[mod(i-offset,4)]!) as unknown as IoTable};
}
export function ioEvaluate(encoding: IoEncoding, x: number): number {
  if(!Number.isInteger(x)||x<0||x>3)throw new Error('input must be 0..3');
  return encoding.cells[mod(x+encoding.offset,4)]!;
}
export function ioDistribution(table: IoTable): readonly IoEncoding[] {
  return [0,1,2,3].map(r=>ioEncode(table,r));
}
/** Count shared full encodings, including the public offset. Each has mass 1/4. */
export function ioOverlap(left: IoTable,right: IoTable): number {
  const other=new Set(ioDistribution(right).map(e=>JSON.stringify(e)));
  return ioDistribution(left).filter(e=>other.has(JSON.stringify(e))).length;
}
export function ioAnswer(task: IoTask): readonly number[] {
  const [left,right]=ioTables(task);
  return [left[task.missing[0]]!,right[task.missing[1]]!,Number(left.every((v,i)=>v===right[i])),ioOverlap(left,right)];
}
export function ioTask(bytes: readonly number[]): IoTask {
  if(bytes.length<7)throw new Error('ioTask requires seven bytes');
  const a=1+bytes[0]!%4,b=bytes[1]!%5,d=1+bytes[2]!%4;
  const delta=bytes[3]!%2===0?0:1+bytes[4]!%4;
  return {kind:'io-equivalence',a,b,d,c:mod(b-a*d+delta,5),missing:[bytes[5]!%4,bytes[6]!%4]};
}
export function parseIoAnswer(value: unknown): readonly number[] | undefined {
  return typeof value==='string' && /^[0-4] [0-4] [01] [0-4]$/.test(value) ? value.split(' ').map(Number):undefined;
}
