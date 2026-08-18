/**
 * battles/ac26-crypto-battle/game/crypto/sha256.ts
 *
 * この model は platform の dispatcher (trusted runtime) 上で実行され、サーバーは
 * 秘密を保持しない — commitments のみ。 このファイルは FIPS 180-4 準拠の SHA-256 を
 * 純 TypeScript で実装する。 node:crypto / WebCrypto には依存しない — dispatcher
 * plugin は依存なし・同期実行が要件のため (WebCrypto の digest API は Promise を
 * 返す非同期 API であり、この要件に合わない)。
 *
 * schnorr.ts の Fiat–Shamir challenge (challengeScalar) がこの関数だけを使う。
 * 入出力はどちらも Uint8Array — hex 変換は呼び出し側 (schnorr.ts / modmath.ts) の
 * 責務であり、ここには持ち込まない。
 */

/** 32-bit 右ローテート。 JS のビット演算は 32-bit 符号付きなので >>> 0 で符号なし化する。 */
function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** 最初の8個の素数の平方根の小数部 (先頭32bit)。 FIPS 180-4 のハッシュ初期値。 */
const H0: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/** 最初の64個の素数の立方根の小数部 (先頭32bit)。 FIPS 180-4 の round 定数。 */
const K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/**
 * message を SHA-256 のパディング規則で 512-bit (64 byte) 境界まで埋める:
 * 0x80 1バイト、0 が続き、末尾8バイトへ元の長さ (bit 単位、big-endian) を書く。
 * bit 長は BigInt で計算する (Uint8Array.length は Number だが 2^53 未満を前提)。
 */
function padMessage(message: Uint8Array): Uint8Array {
  const bitLen = BigInt(message.length) * 8n;
  const withOneBit = message.length + 1;
  const remainder = withOneBit % 64;
  const zeroPad = remainder <= 56 ? 56 - remainder : 120 - remainder;
  const padded = new Uint8Array(withOneBit + zeroPad + 8);
  padded.set(message, 0);
  padded[message.length] = 0x80;
  // 末尾8バイトへ big-endian で bit 長を書き込む。
  let len = bitLen;
  for (let i = 7; i >= 0; i--) {
    padded[padded.length - 8 + i] = Number(len & 0xffn);
    len >>= 8n;
  }
  return padded;
}

/** 1個の 512-bit block を処理し、working hash (8 words) を破壊的に更新する。 */
function processBlock(h: number[], block: Uint8Array, offset: number): void {
  const w = new Uint32Array(64);
  for (let i = 0; i < 16; i++) {
    const base = offset + i * 4;
    w[i] =
      ((block[base] << 24) | (block[base + 1] << 16) | (block[base + 2] << 8) | block[base + 3]) >>> 0;
  }
  for (let i = 16; i < 64; i++) {
    const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
    const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
  }

  let [a, b, c, d, e, f, g, hh] = h;
  for (let i = 0; i < 64; i++) {
    const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const ch = (e & f) ^ (~e & g);
    const temp1 = (hh + s1 + ch + K[i] + w[i]) >>> 0;
    const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (s0 + maj) >>> 0;
    hh = g;
    g = f;
    f = e;
    e = (d + temp1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) >>> 0;
  }

  h[0] = (h[0] + a) >>> 0;
  h[1] = (h[1] + b) >>> 0;
  h[2] = (h[2] + c) >>> 0;
  h[3] = (h[3] + d) >>> 0;
  h[4] = (h[4] + e) >>> 0;
  h[5] = (h[5] + f) >>> 0;
  h[6] = (h[6] + g) >>> 0;
  h[7] = (h[7] + hh) >>> 0;
}

/** FIPS 180-4 準拠の SHA-256。 message の長さに制約はない (テストは >64 byte 入力も検証)。 */
export function sha256(message: Uint8Array): Uint8Array {
  const h = [...H0];
  const padded = padMessage(message);
  for (let offset = 0; offset < padded.length; offset += 64) {
    processBlock(h, padded, offset);
  }
  const digest = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    digest[i * 4] = (h[i] >>> 24) & 0xff;
    digest[i * 4 + 1] = (h[i] >>> 16) & 0xff;
    digest[i * 4 + 2] = (h[i] >>> 8) & 0xff;
    digest[i * 4 + 3] = h[i] & 0xff;
  }
  return digest;
}
