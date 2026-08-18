/**
 * battles/ac26-crypto-battle/game/crypto/group.ts
 *
 * この model は platform の dispatcher (trusted runtime) 上で実行され、サーバーは
 * 秘密を保持しない — commitments のみ。 固定の Schnorr group を1つだけ定義する。
 *
 * p は RFC 3526 MODP Group 14 (2048-bit) の safe prime。 q = (p-1)/2 は
 * 群の位数 (p-1 = 2q) を割る素数で、 g = 4 が生成する部分群の位数になる。
 *
 * g に 4 (= 2^2) を選ぶ理由: 4 は常に平方剰余 (quadratic residue) なので、
 * p mod 8 に関わらず ord(g) は 1 か q のどちらか (q が素数なので約数はこの2つだけ)。
 * g != 1 なので ord(g) = q が保証される。 (RFC 3526 が推奨する g=2 は p mod 8 に
 * 依存して安全でない場合があるため、ここでは使わない。) 実際に g^q ≡ 1 (mod p) かつ
 * g^1 ≠ 1 (mod p) であることは crypto/group.test 相当の検証で確認済み
 * (scripts/ac26-crypto-battle.test.ts)。
 *
 * secret / share はすべて Z_q (scalar) 上に住み、Feldman commitment は Z_p
 * (group element) 上に住む。 この2つの空間を混同しないこと。
 */

import { mod, modPow, tryHexToBigint } from "./modmath.ts";

/** RFC 3526 MODP Group 14 (2048-bit) safe prime, 小文字16進。 */
export const P_HEX =
  "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22" +
  "514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6" +
  "f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3d" +
  "c2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb" +
  "9ed529077096966d670c354e4abc9804f1746c08ca18217c32905e462e36ce3be39e772c180e8603" +
  "9b2783a2ec07a28fb5c55df06f4c52c9de2bcbf6955817183995497cea956ae515d2261898fa0510" +
  "15728e5a8aacaa68ffffffffffffffff";

/** p 本体。 */
export const P = BigInt(`0x${P_HEX}`);

/** 部分群の位数 q = (p-1)/2 (素数)。 secret / share はこの法で正規化される。 */
export const Q = (P - 1n) / 2n;

/** 生成元。 4 = 2^2 は必ず平方剰余なので ord(g) = q。 */
export const G = 4n;

/** 群元の範囲チェックのみ (安価)。 [1, p-1] に入っているか。 部分群所属は保証しない。 */
export function isElementInRange(x: bigint): boolean {
  return x >= 1n && x <= P - 1n;
}

/**
 * 部分群所属の完全チェック (高価: 2048-bit modPow 1回)。 x^q ≡ 1 (mod p)。
 *
 * 敵対的入力が実際に外部から入ってくる境界 (init/rotate op の commitments) でのみ
 * 呼ぶこと。 一度 state に書き込まれ「信頼された値」として保存された commitments に
 * 対して Feldman 検証 (verifyShare/verifySecret) を繰り返すたびにこれを呼び直す
 * 必要はない — その都度 2048-bit の冪乗を1回余分に払うコストに見合わない。
 */
export function isSubgroupElement(x: bigint): boolean {
  return isElementInRange(x) && modPow(x, Q, P) === 1n;
}

/** スカラー (Z_q の元) の範囲チェック。 secret / share の値はここに住む。 */
export function isScalarInRange(x: bigint): boolean {
  return x >= 0n && x < Q;
}

/**
 * 群元の hex 文字列をパースし、部分群所属まで含めて検証する。
 * 敵対的入力 (commitments) の入口として使う関数。 不正なら null。
 */
export function tryParseSubgroupElement(hex: string): bigint | null {
  const x = tryHexToBigint(hex);
  if (x === null) return null;
  return isSubgroupElement(x) ? x : null;
}

/**
 * スカラーの hex 文字列をパースし、範囲まで検証する (安価: modPow を呼ばない)。
 * share 値・secret の入口として使う関数。 不正なら null。
 */
export function tryParseScalar(hex: string): bigint | null {
  const x = tryHexToBigint(hex);
  if (x === null) return null;
  return isScalarInRange(x) ? x : null;
}

/** テスト・デバッグ用: 値を正規化して P を法にする。 内部の Feldman 実装が使う。 */
export function modP(x: bigint): bigint {
  return mod(x, P);
}
