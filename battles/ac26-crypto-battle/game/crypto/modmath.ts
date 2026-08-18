/**
 * battles/ac26-crypto-battle/game/crypto/modmath.ts
 *
 * この model は platform の dispatcher (trusted runtime) 上で実行され、サーバーは
 * 秘密を保持しない — commitments のみ。 このファイルは BigInt による法演算 (modular
 * arithmetic) の基礎だけを提供する。 純関数 (= 副作用なし)。 group / field の元は
 * すべて JSON-serializable な hex 文字列 (小文字、0x prefix なし) として state に
 * 保存する — bigint をそのまま state へ置かない。
 *
 * Issue #486 PR1: PROVE / LEAK / HUNT の暗号基盤。
 */

/**
 * 敵対的入力からの hex 文字列の上限長。 対象は高々 2048-bit (512 hex 桁) の元・
 * scalar なので、余裕を持たせつつ極端に長い文字列を BigInt へ変換するコストで
 * DoS されるのを止める上限。 tryHexToBigint の入口でのみ効く。
 */
export const MAX_HEX_LEN = 600;

/** 小文字16進文字のみを許可する形式チェック。 */
const HEX_PATTERN = /^[0-9a-f]+$/;

/** 負数を含む a を法 m で正規化する ( 0 <= result < m )。 */
export function mod(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

/**
 * 繰り返し二乗法 (square-and-multiply) による modular exponentiation。
 * base^exp mod m。 exp は負であってはならない (呼び出し側の責務)。
 */
export function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  if (m === 1n) return 0n;
  if (exp < 0n) throw new RangeError("modPow: exp must be >= 0");
  let result = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

/**
 * 拡張ユークリッド互除法 (iterative)。 gcd(a,b) と a*x + b*y = gcd(a,b) を満たす
 * x, y を返す。 再帰にすると2048-bit入力で呼び出し深度が数千に達しうるため、
 * ループで実装する。
 */
function extendedGcd(a: bigint, b: bigint): { gcd: bigint; x: bigint } {
  let oldR = a;
  let r = b;
  let oldS = 1n;
  let s = 0n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return { gcd: oldR, x: oldS };
}

/**
 * a の m を法とする逆元。 a が m と互いに素でない場合 (例: a=0, もしくは m が
 * 素数でない状況で a が m の約数を共有する場合) は非可逆として明示的に throw する
 * — 呼び出し元 (validateOp/applyOp) はこの関数を敵対的入力へ直接は使わず、必ず
 * 事前に範囲・形式チェック (group.ts) を経由すること。
 */
export function modInv(a: bigint, m: bigint): bigint {
  if (m <= 0n) throw new RangeError("modInv: modulus must be positive");
  const normalized = mod(a, m);
  const { gcd, x } = extendedGcd(normalized, m);
  if (gcd !== 1n) {
    throw new RangeError(`modInv: ${normalized} has no inverse mod ${m} (gcd=${gcd})`);
  }
  return mod(x, m);
}

/**
 * 小文字16進 (0x prefix なし) をパースする。 空文字・上限超過・不正な文字を
 * 含む場合は throw せず null を返す — 敵対的入力の第一関門として使う。
 */
export function tryHexToBigint(hex: string): bigint | null {
  if (typeof hex !== "string") return null;
  if (hex.length === 0 || hex.length > MAX_HEX_LEN) return null;
  if (!HEX_PATTERN.test(hex)) return null;
  return BigInt(`0x${hex}`);
}

/**
 * bigint を小文字16進 (0x prefix なし) に変換する。 group/field の元・scalar は
 * 非負である前提 (mod 演算の結果は常に [0, m) に正規化済み) なので、負数が来たら
 * 呼び出し元のバグとして throw する。
 */
export function bigintToHex(value: bigint): string {
  if (value < 0n) throw new RangeError("bigintToHex: value must be non-negative");
  return value.toString(16);
}
