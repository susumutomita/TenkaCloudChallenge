/**
 * battles/ac26-crypto-battle/game/crypto/feldman.ts
 *
 * この model は platform の dispatcher (trusted runtime) 上で実行され、サーバーは
 * 秘密を保持しない — commitments のみ。 Shamir secret sharing (Z_q 上) + Feldman VSS
 * commitment (Z_p 上) の実装。
 *
 * t, n はこのファイルにハードコードしない — 呼び出し側 (reducer.ts / constants.ts)
 * が config として渡す。 このファイル自体は t-of-n の値に依存しない純粋な多項式演算。
 *
 * 多項式は f(x) = a_0 + a_1*x + ... + a_{t-1}*x^{t-1} (mod q)。 a_0 = secret。
 * commitment は C_j = g^{a_j} mod p。 C_0 = g^secret はチームの公開鍵そのもの。
 */

import { mod, modInv, modPow } from "./modmath.ts";
import { G, P, Q } from "./group.ts";

/** 1つの share。 i は 1..n の index、value は f(i) mod q。 */
export interface FeldmanShare {
  readonly i: number;
  readonly value: bigint;
}

/**
 * secret (= a_0) と caller 提供の乱数係数 a_1..a_{t-1} (coefficients) から、
 * n 個の share と t 個の Feldman commitment C_0..C_{t-1} を生成する。
 *
 * 乱数性はすべて呼び出し側 (coefficients 引数) が持ち込む — この関数自体は
 * 決定的 (同じ入力なら常に同じ出力)。 t は coefficients.length + 1 で決まる。
 */
export function shareSecret(
  secret: bigint,
  coefficients: readonly bigint[],
  n: number,
): { shares: FeldmanShare[]; commitments: bigint[] } {
  const coeffs = [secret, ...coefficients]; // a_0..a_{t-1}
  const shares: FeldmanShare[] = [];
  for (let i = 1; i <= n; i++) {
    const iBig = BigInt(i);
    let value = 0n;
    let power = 1n; // i^j (mod q への正規化は最終的な value の加算時にのみ行う)
    for (const a of coeffs) {
      value = mod(value + a * power, Q);
      power *= iBig;
    }
    shares.push({ i, value });
  }
  const commitments = coeffs.map((a) => modPow(G, a, P));
  return { shares, commitments };
}

/**
 * Feldman 検証: g^{s_i} == Π_j C_j^{i^j} (mod p)。
 *
 * i^j を Z_q へ還元せず、そのままの (小さな) 整数指数で modPow する — t, n は
 * 小さいので i^j 自体が巨大になることはなく、部分群所属を前提にした指数の
 * mod q 還元 (ord(C_j) | q に依存する最適化) を避けることで、C_j が万一
 * 部分群外の値であっても本関数の数学的な正しさ自体は揺らがない。
 */
export function verifyShare(i: number, value: bigint, commitments: readonly bigint[]): boolean {
  const lhs = modPow(G, value, P);
  const iBig = BigInt(i);
  let rhs = 1n;
  let power = 1n; // i^j
  for (const c of commitments) {
    rhs = mod(rhs * modPow(c, power, P), P);
    power *= iBig;
  }
  return lhs === rhs;
}

/**
 * t 個 (以上) の share から x=0 での Lagrange 補間により secret を復元する。
 * hunter が公開 ledger 上の leaked share から client 側で secret を推測する
 * のに使う想定 (reducer 自体はこの関数を呼ばない — hunt op は復元済みの secret
 * を受け取って verifySecret で検証するだけ)。
 *
 * shares の i (x座標) が重複していると、対応する分母が 0 になり modInv が
 * throw する — この関数はテスト・client 側専用で、敵対的な reducer 入力の
 * 経路には置かれない。
 */
export function interpolateSecret(shares: readonly FeldmanShare[]): bigint {
  let secret = 0n;
  for (let k = 0; k < shares.length; k++) {
    const xk = shares[k].i;
    const yk = shares[k].value;
    let numerator = 1n;
    let denominator = 1n;
    for (let m = 0; m < shares.length; m++) {
      if (m === k) continue;
      const xm = shares[m].i;
      numerator = mod(numerator * BigInt(-xm), Q);
      denominator = mod(denominator * BigInt(xk - xm), Q);
    }
    const lagrangeCoeff = mod(numerator * modInv(denominator, Q), Q);
    secret = mod(secret + yk * lagrangeCoeff, Q);
  }
  return secret;
}

/** g^secret == C_0 か。 hunt op が「復元した secret が正しいか」を検証するのに使う。 */
export function verifySecret(secret: bigint, commitments: readonly bigint[]): boolean {
  if (commitments.length === 0) return false;
  return modPow(G, secret, P) === commitments[0];
}
