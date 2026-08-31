/**
 * [Issue #659 §2/§13] The cipher ladder: the rungs a team climbs, and what
 * each rung costs to break.
 *
 * ## What this is for
 *
 * The Battle's other Orders are all built on one secret and one break: three
 * Shamir shares reconstruct it. That teaches a threshold, and it teaches it
 * once. The ladder teaches the thing underneath — **how much you can publish
 * before your key is gone** — by making that number differ from rung to rung:
 *
 *     rung       pairs to break   the break itself        what it teaches
 *     Caesar     1                one subtraction         a weak cipher dies from one leak
 *     Vigenère   several          spot the period first   a longer key survives more
 *     RSA        —                factor the modulus      one-wayness
 *     homomorphic  never          —                       what modern ciphers buy you
 *
 * Nobody is told "Caesar is weak". They LEAK one pair, lose the key ten seconds
 * later, and learn it. Later, on a higher rung, they leak a pair and nothing
 * happens — and THAT is the lesson about CPA resistance, arrived at by failing
 * to break something rather than by reading a definition.
 *
 * ## Why this file is a registry and not a Caesar implementation
 *
 * #659 §13 scopes this slice to 「`caesar-shift` を 1 段だけ足して形を確定 →
 * 量産」 — add one rung to settle the SHAPE, then mass-produce. So everything a
 * rung differs by lives in {@link CipherRungSpec} as data: its symbols, its
 * modulus, how many published pairs break it, and what breaking it pays. A
 * second rung should be a new entry here plus a case in {@link encryptWithRung},
 * not a new concept anywhere else.
 *
 * ## Kerckhoffs's principle is a game rule here, not just a slogan
 *
 * The method is printed on the Order (see `buildOrderTask`). Hiding it would
 * only mean five minutes spent guessing what to do, and it would teach the
 * opposite of the intended lesson. Every team knows every algorithm; the teams
 * that keep their key survive, and the team that publishes one pair on the
 * bottom rung does not. #659 §5: 「秘密にすべきは方式ではなく鍵」.
 *
 * ## Language neutrality
 *
 * The plaintext is a run of PICTURES, never words (#659 §3). A Japanese or
 * English speaker reads ⚀⚁⚂ identically, so neither is handed an advantage the
 * cryptography did not give them. The symbol count IS the modulus, which makes
 * it the difficulty knob: mod 3 is mental arithmetic, mod 9 needs paper.
 */

import { deriveBigInt } from "./prng.ts";

/** The rungs that exist today. A new rung is a new member here. */
export type CipherRung = "caesar";

export interface CipherRungSpec {
  readonly rung: CipherRung;
  /**
   * The alphabet, in order. Position IS the numeric value, so `symbols[2]` is
   * the symbol for 2, and the length is the modulus.
   */
  readonly symbols: readonly string[];
  /**
   * How many published (plaintext, ciphertext) pairs let an attacker recover
   * the key — #659 §2's 「鍵を割るのに必要な公開数」 column, and the number the
   * whole ladder exists to vary. One, for Caesar: a single position gives
   * `k = (c - p) mod n` outright.
   *
   * Not enforced by the reducer, and deliberately so. The judge checks whether
   * a submitted key is RIGHT, never whether the attacker had enough material to
   * deduce it — a team that guesses `k` on a 6-symbol alphabet has a one-in-six
   * chance and is welcome to it. This number is what the Order DISCLOSES, so a
   * team can weigh "how much does leaking this cost me" before leaking.
   */
  readonly pairsToBreak: number;
  /**
   * How long a plaintext this rung asks for.
   *
   * #659 §4 sizes every Order at roughly five minutes of hand calculation,
   * because the deadline IS the compute budget. This length is an ESTIMATE of
   * that for one modular addition per symbol, not a measured figure — #659 §15
   * names a paper playtest as the next step precisely because no simulation
   * settles how long a person actually takes.
   */
  readonly plaintextLength: number;
  /**
   * What breaking this rung pays the attacker.
   *
   * Deliberately far below `scores.huntBonus`, and asymmetric with the victim's
   * penalty. A Shamir HUNT is five minutes of Lagrange interpolation and pays
   * 25; recovering a Caesar key is one subtraction. Paying both the same would
   * make the bottom rung the only thing worth hunting and turn #659 §2's
   * 「弱い相手は安く狩れて、強い相手は狩れない」 — a judgement about whether a
   * target is worth your time — into a reflex.
   *
   * The victim still pays the full `scores.huntPenalty`: cheap to break is not
   * the same as cheap to lose, and it is the victim's side of this that keeps
   * the confirmed ordering 「LEAK して狩られる −2」 intact on every rung.
   */
  readonly huntBonus: number;
}

/**
 * Dice faces: six symbols, no words, legible at any size, and a modulus large
 * enough that a middle-school player has to write the arithmetic down without
 * being large enough to want a calculator (#659 §3: 「mod 3 は暗算、mod 9 は手を
 * 動かす」 — six sits between them).
 */
const DICE: readonly string[] = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

export const CIPHER_RUNGS: Readonly<Record<CipherRung, CipherRungSpec>> = {
  caesar: {
    rung: "caesar",
    symbols: DICE,
    pairsToBreak: 1,
    plaintextLength: 12,
    huntBonus: 8,
  },
};

/** Every rung, in ladder order (weakest first). */
export const ALL_CIPHER_RUNGS: readonly CipherRung[] = ["caesar"];

export function rungSpec(rung: CipherRung): CipherRungSpec {
  return CIPHER_RUNGS[rung];
}

/**
 * A team's key for one rung, at one generation.
 *
 * Scoped to `generation` for the same reason the Shamir secret and the Schnorr
 * public commitment are: ROTATE has to defend the rung it is most needed on. A
 * key derived without the generation would stay broken for the rest of the
 * match, and #659 §10's 「ROTATE だけが打ち消せる」 would quietly not be true of
 * the ladder. Deriving it here means `applyRotate` covers the ladder with no
 * branch of its own — the key it hands out after a rotate is simply a different
 * one, and every pair published under the old generation stops meaning anything.
 *
 * Zero is a legal key. It is a weak one — the ciphertext equals the plaintext —
 * and a team that draws it and leaks a pair has published its key in the
 * clearest possible way. That is the rung's lesson, not a bug to design around.
 */
export function deriveCipherKey(
  seed: string,
  teamId: string,
  generation: number,
  rung: CipherRung,
): number {
  const spec = rungSpec(rung);
  const roll = deriveBigInt(seed, `cipher-key:${rung}:${teamId}:${generation}`, generation);
  return Number(roll % BigInt(spec.symbols.length));
}

/**
 * The plaintext this Order asks the team to encrypt, as symbol VALUES.
 *
 * Derived from the Order's own id so two Orders never ask the same question,
 * and so a replay produces the identical belt.
 */
export function derivePlaintext(
  seed: string,
  contractId: string,
  rung: CipherRung,
): readonly number[] {
  const spec = rungSpec(rung);
  const modulus = BigInt(spec.symbols.length);
  const values: number[] = [];
  for (let position = 0; position < spec.plaintextLength; position += 1) {
    const roll = deriveBigInt(seed, `cipher-plaintext:${rung}:${contractId}`, position);
    values.push(Number(roll % modulus));
  }
  return values;
}

/**
 * Apply the rung's cipher. For Caesar: shift every symbol forward by the key
 * and take the remainder — exactly the arithmetic a participant does by hand,
 * written once so the judge and the worked example in the Order cannot drift
 * apart.
 */
export function encryptWithRung(
  plaintext: readonly number[],
  key: number,
  rung: CipherRung,
): readonly number[] {
  const modulus = rungSpec(rung).symbols.length;
  switch (rung) {
    case "caesar":
      return plaintext.map((value) => (value + key) % modulus);
    default: {
      const exhaustive: never = rung;
      throw new Error(`encryptWithRung: unhandled rung ${String(exhaustive)}`);
    }
  }
}

/** Render symbol values as the pictures a participant actually sees. */
export function toSymbols(values: readonly number[], rung: CipherRung): readonly string[] {
  const { symbols } = rungSpec(rung);
  return values.map((value) => symbols[value] ?? "?");
}

/**
 * Parse a participant-submitted answer.
 *
 * Accepts either the pictures or their numeric values, because a browser that
 * cannot type ⚀ should not be a scoring disadvantage. Returns `undefined` for
 * anything else rather than throwing: a malformed answer is a rejected op, not
 * a crashed match — the same contract every other participant-supplied value in
 * this game is held to.
 */
export function parseAnswer(
  raw: readonly string[],
  rung: CipherRung,
): readonly number[] | undefined {
  const { symbols } = rungSpec(rung);
  const values: number[] = [];
  for (const token of raw) {
    const trimmed = token.trim();
    const bySymbol = symbols.indexOf(trimmed);
    if (bySymbol >= 0) {
      values.push(bySymbol);
      continue;
    }
    if (!/^\d+$/.test(trimmed)) return undefined;
    const numeric = Number(trimmed);
    if (numeric >= symbols.length) return undefined;
    values.push(numeric);
  }
  return values;
}
