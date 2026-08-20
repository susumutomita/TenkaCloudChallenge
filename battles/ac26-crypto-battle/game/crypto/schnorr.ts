/**
 * battles/ac26-crypto-battle/game/crypto/schnorr.ts
 *
 * この model は platform の dispatcher (trusted runtime) 上で実行され、サーバーは
 * 秘密を保持しない — commitments のみ。 このファイルは non-interactive Schnorr
 * proof of knowledge (Fiat–Shamir 変換) を実装する: あるチームが自分の Feldman
 * commitment C_0 = g^x の離散対数 x を「知っている」ことを、x そのものを明かさず
 * 証明する。 verifier はこの reducer 自身 (trusted dispatcher 上で走る、秘密を
 * 持たない検証者) — challenges/ac26-w3-schnorr/local/reference/schnorr.py の
 * length-prefixed preimage / domain separation の作法を踏襲する (概念上の参考、
 * 実装は本ファイル独自の TS)。
 *
 * verifyKnowledge は敵対的入力 (R, s は op から来る生の hex) を想定して書く —
 * 決して throw しない。 proveKnowledge は client/fixtures 側の trusted helper
 * (leakOpFor 等と同じ立ち位置) で、nonce=0 や nonce>=Q のような呼び出し側の
 * プログラムエラーは例外として弾く。
 *
 * nonce はすべて呼び出し側 (secret 同様、client/fixtures) が持ち込む — ここでは
 * 一切の乱数生成を行わない (Math.random / Date.now は禁止)。 同じ nonce を
 * 異なる context で使い回すと special soundness により秘密が漏れる
 * (scripts/ac26-crypto-battle.test.ts の nonce-reuse attack テストが実証する) —
 * これは実装のバグではなく Schnorr proof の数学的性質そのものなので、呼び出し側
 * (client) が nonce の鮮度を守る責務を負う。
 */

import { mod, modPow, bigintToHex } from "./modmath.ts";
import { G, P, Q, tryParseScalar, tryParseSubgroupElement } from "./group.ts";
import { sha256 } from "./sha256.ts";

/** この proof 系列の domain separator。 他のプロトコル (例: schnorr 署名) と衝突しない専用文字列。 */
export const POK_DOMAIN = "tenkacloud/ac26-crypto-battle/pok/v1";

/** Z_p の元 (group element) を固定長 byte 列へ符号化する際の幅。 P は 2048-bit = 256 byte。 */
const ELEMENT_BYTE_LEN = 256;

/** Z_q の scalar を固定長 byte 列へ符号化する際の幅。 Q も 2047-bit で 256 byte に収まる。 */
const SCALAR_BYTE_LEN = 256;

/** ゲーム内で proof を issue する場面。 op 種別と1対1対応する。 */
export type ProofPurpose = "contract" | "init" | "rotate";

/**
 * proof を特定の game slot へ束縛する context。 この4フィールドのいずれかが
 * 異なれば challenge (延いては合法な (R,s)) も必ず異なる — 同じ proof を
 * 別の contract / 別チーム / 別 generation へ「使い回す」replay を防ぐ。
 * contractId は init/rotate では "" (この2つの op は contract に紐付かない)。
 */
export interface ProofContext {
  readonly purpose: ProofPurpose;
  readonly teamId: string;
  readonly generation: number;
  readonly contractId: string;
}

/** non-interactive Schnorr proof。 R (commitment) と s (response) はどちらも hex。 */
export interface KnowledgeProof {
  readonly commitment: string; // R = g^k mod p, hex
  readonly response: string; // s = (k + e*x) mod q, hex
}

// --- 符号化ヘルパー -----------------------------------------------------------------

/** bigint を非負・byteLen 以下という前提で big-endian 固定長 byte 列へ変換する。 */
function bigintToFixedBytes(value: bigint, byteLen: number): Uint8Array {
  if (value < 0n) throw new RangeError("bigintToFixedBytes: value must be non-negative");
  let v = value;
  const out = new Uint8Array(byteLen);
  for (let i = byteLen - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new RangeError("bigintToFixedBytes: value does not fit in byteLen bytes");
  return out;
}

/** big-endian byte 列を bigint へ変換する (SHA-256 digest の解釈に使う)。 */
function bytesToBigintBE(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const b of bytes) {
    result = (result << 8n) | BigInt(b);
  }
  return result;
}

/** Z_p の元を固定幅 256 byte へ符号化する (fixed width = injective な符号化)。 */
export function encodeGroupElement(x: bigint): Uint8Array {
  return bigintToFixedBytes(x, ELEMENT_BYTE_LEN);
}

/** Z_q の scalar を固定幅 256 byte へ符号化する。 */
export function encodeScalar(x: bigint): Uint8Array {
  return bigintToFixedBytes(x, SCALAR_BYTE_LEN);
}

/**
 * 可変長フィールド (teamId, contractId, purpose などの id 系文字列) を
 * 4-byte big-endian の長さプレフィックス付きで utf-8 符号化する。 プレフィックスが
 * ないと ("ab","cd") と ("a","bcd") が同じバイト列に潰れてしまい、隣接フィールドの
 * 境界があいまいになる (challenges/ac26-w3-schnorr の challenge_preimage と同じ理由)。
 */
function lengthPrefixedUtf8(s: string): Uint8Array {
  const body = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + body.length);
  out[0] = (body.length >>> 24) & 0xff;
  out[1] = (body.length >>> 16) & 0xff;
  out[2] = (body.length >>> 8) & 0xff;
  out[3] = body.length & 0xff;
  out.set(body, 4);
  return out;
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** generation (小さい非負整数) を固定 8 byte の big-endian へ符号化する。 */
function encodeGeneration(generation: number): Uint8Array {
  return bigintToFixedBytes(BigInt(generation), 8);
}

// --- Fiat–Shamir challenge ------------------------------------------------------------

/**
 * Fiat–Shamir challenge: SHA-256(domain の長さプレフィックス付き utf-8 || parts の連結)
 * を big-endian で解釈し、mod Q へ還元する。 domain を先頭に固定するのは
 * challenges/ac26-w3-schnorr の challenge_preimage と同じ規約 — parts 内の
 * 可変長フィールドはそれぞれ呼び出し側が既に長さプレフィックス済みにしておくこと
 * (この関数自身は domain のプレフィックスだけを担当する)。
 */
export function challengeScalar(domain: string, parts: readonly Uint8Array[]): bigint {
  const preimage = concatBytes([lengthPrefixedUtf8(domain), ...parts]);
  const digest = sha256(preimage);
  return mod(bytesToBigintBE(digest), Q);
}

/**
 * proof context + C_0 (公開鍵) + R (prover の commitment) から challenge の
 * preimage を組み立てる。 purpose/teamId/contractId は可変長なので長さプレフィックス、
 * generation は固定 8 byte、C_0/R は固定 256 byte — これで prove/verify 双方が
 * 必ず同じバイト列を作る。
 *
 * export する理由: nonce 再利用攻撃 (special soundness) をテストで実演するには、
 * 2つの proof の challenge e1, e2 を prove/verify と全く同じ経路で再計算する
 * 必要がある — テスト側でこのロジックを複製すると実装とズレるリスクがあるため、
 * challengeScalar と合わせて公開する (テストは
 * `challengeScalar(POK_DOMAIN, buildContextParts(ctx, c0, r))` で e を再現できる)。
 */
export function buildContextParts(context: ProofContext, c0: bigint, r: bigint): Uint8Array[] {
  return [
    lengthPrefixedUtf8(context.purpose),
    lengthPrefixedUtf8(context.teamId),
    encodeGeneration(context.generation),
    lengthPrefixedUtf8(context.contractId),
    encodeGroupElement(c0),
    encodeGroupElement(r),
  ];
}

/** context の各フィールドが期待する形をしているかの防御的チェック (verifyKnowledge が使う)。 */
function isWellFormedContext(context: ProofContext): boolean {
  if (
    context.purpose !== "contract" &&
    context.purpose !== "init" &&
    context.purpose !== "rotate"
  ) {
    return false;
  }
  if (typeof context.teamId !== "string" || typeof context.contractId !== "string") return false;
  if (typeof context.generation !== "number" || !Number.isInteger(context.generation)) return false;
  if (context.generation < 0) return false;
  return true;
}

// --- prove / verify --------------------------------------------------------------------

/**
 * secret x の離散対数の知識を証明する (client/fixtures 側の trusted helper)。
 * C_0 = g^x はここで secret から導出する (呼び出し側が別途渡す必要はない)。
 * R = g^k mod p, e = challenge(domain, context, C_0, R), s = (k + e*x) mod q。
 *
 * nonce が [1, Q-1] の範囲外 (0 や Q 以上) の場合は呼び出し側のプログラムエラー
 * として throw する — bigintToHex が負数で throw するのと同じ立ち位置であり、
 * 敵対的な reducer 入力の経路には置かれない。
 */
export function proveKnowledge(
  secret: bigint,
  nonce: bigint,
  context: ProofContext,
): KnowledgeProof {
  if (nonce <= 0n || nonce >= Q) {
    throw new RangeError("proveKnowledge: nonce must be in [1, Q-1]");
  }
  const c0 = modPow(G, secret, P);
  const r = modPow(G, nonce, P);
  const e = challengeScalar(POK_DOMAIN, buildContextParts(context, c0, r));
  const s = mod(nonce + e * secret, Q);
  return { commitment: bigintToHex(r), response: bigintToHex(s) };
}

/**
 * proof を検証する: g^s == R · C_0^e (mod p)。 敵対的入力 (publicKeyHex, proof.commitment,
 * proof.response はすべて op から来る生の hex) を想定し、決して throw しない —
 * 不正な形式・部分群外の R・範囲外の s はすべて false として扱う。
 */
export function verifyKnowledge(
  publicKeyHex: string,
  proof: { readonly commitment: string; readonly response: string },
  context: ProofContext,
): boolean {
  if (!isWellFormedContext(context)) return false;
  if (typeof publicKeyHex !== "string") return false;
  if (typeof proof !== "object" || proof === null) return false;
  if (typeof proof.commitment !== "string" || typeof proof.response !== "string") return false;

  const c0 = tryParseSubgroupElement(publicKeyHex);
  if (c0 === null) return false;
  // R も部分群所属チェックを通す (敵対的入力の境界: 群外の R を渡して検証をすり抜けようとする攻撃を防ぐ)。
  const r = tryParseSubgroupElement(proof.commitment);
  if (r === null) return false;
  const s = tryParseScalar(proof.response);
  if (s === null) return false;

  const e = challengeScalar(POK_DOMAIN, buildContextParts(context, c0, r));
  const lhs = modPow(G, s, P);
  const rhs = mod(modPow(c0, e, P) * r, P);
  return lhs === rhs;
}
