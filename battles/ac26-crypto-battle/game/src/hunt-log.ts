/** Lossless RSA audit rows; no success or timestamp is discarded on ROTATE.
 *
 * A fixed, sorted match roster supplies identities. Each target/generation has
 * one tuple; one slot per other team stores (atMs - baseAtMs + 1), with zero
 * meaning absent. All slots use the smallest base-64 width that holds the range.
 * Timestamps remain exact even when attacks arrive at different milliseconds.
 * Legacy Shamir/Sudoku objects are read unchanged, and reservations written by
 * an older RSA worker cannot fabricate a success time here.
 */
import { predictionKey, predictionTeam } from "./hunt-key.ts";
import type { CryptoBattleState, HuntLogEntry, StoredHuntLogEntry } from "./types.ts";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
type RsaBlock = Extract<StoredHuntLogEntry, { readonly rsa: unknown }>;

function unpack(text: string, width: number): number[] {
  if (!Number.isSafeInteger(width) || width < 1 || width > 9 || text.length % width)
    throw new Error("Invalid RSA hunt timestamp width");
  const values: number[] = [];
  for (let at = 0; at < text.length; at += width) {
    let value = 0;
    for (let digit = 0; digit < width; digit++) {
      const n = ALPHABET.indexOf(text[at + digit]!);
      if (n < 0) throw new Error("Invalid RSA hunt timestamp digit");
      value = value * 64 + n;
    }
    if (!Number.isSafeInteger(value)) throw new Error("Invalid RSA hunt timestamp");
    values.push(value);
  }
  return values;
}
function pack(values: readonly number[]): { width: number; text: string } {
  const max = Math.max(1, ...values);
  let width = 1;
  while (64 ** width <= max) width++;
  const text = values
    .map((value) => {
      let rest = value,
        result = "";
      for (let digit = 0; digit < width; digit++) {
        result = ALPHABET[rest % 64]! + result;
        rest = Math.floor(rest / 64);
      }
      return result;
    })
    .join("");
  return { width, text };
}
function slot(attacker: number, target: number): number {
  if (attacker === target) throw new Error("RSA hunt cannot target its attacker");
  return attacker < target ? attacker : attacker - 1;
}
function readBlock(state: Pick<CryptoBattleState, "teams">, block: RsaBlock) {
  const [target, generation, baseAtMs, width, text] = block.rsa;
  // The existing roster decoder rejects out-of-range and noncanonical indices.
  const targetTeamId = predictionTeam(state, String(target));
  if (!Number.isSafeInteger(generation) || generation < 1 || !Number.isSafeInteger(baseAtMs))
    throw new Error("Invalid RSA hunt identity or time");
  const values = unpack(text, width);
  if (values.length !== Object.keys(state.teams).length - 1)
    throw new Error("RSA hunt roster length changed");
  return { target, targetTeamId, generation, baseAtMs, values };
}

export function appendRsaHunt(
  state: CryptoBattleState,
  attackerTeamId: string,
  targetTeamId: string,
  generation: number,
): readonly StoredHuntLogEntry[] {
  const atMs = state.nowMs;
  if (typeof atMs !== "number" || !Number.isSafeInteger(atMs))
    throw new Error("RSA hunt requires an exact match timestamp");
  const target = Number(predictionKey(state, targetTeamId));
  const attacker = Number(predictionKey(state, attackerTeamId));
  const index = state.huntLog.findIndex(
    (entry) => "rsa" in entry && entry.rsa[0] === target && entry.rsa[1] === generation,
  );
  const old = index < 0 ? undefined : (state.huntLog[index] as RsaBlock);
  const decoded = old ? readBlock(state, old) : undefined;
  const baseAtMs = Math.min(decoded?.baseAtMs ?? atMs, atMs);
  const values = decoded
    ? decoded.values.map((value) => (value === 0 ? 0 : value + decoded.baseAtMs - baseAtMs))
    : Array<number>(Object.keys(state.teams).length - 1).fill(0);
  const position = slot(attacker, target);
  if (values[position] !== 0) throw new Error("RSA success is already recorded");
  values[position] = atMs - baseAtMs + 1;
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0))
    throw new Error("RSA hunt time is outside the exact integer range");
  const encoded = pack(values);
  const row: RsaBlock = { rsa: [target, generation, baseAtMs, encoded.width, encoded.text] };
  return index < 0
    ? [...state.huntLog, row]
    : state.huntLog.map((entry, at) => (at === index ? row : entry));
}

export function decodeHuntLog(state: Pick<CryptoBattleState, "teams" | "huntLog">): HuntLogEntry[] {
  const result: HuntLogEntry[] = [];
  for (const entry of state.huntLog) {
    if (!("rsa" in entry)) {
      result.push(entry);
      continue;
    }
    const { target, targetTeamId, generation, baseAtMs, values } = readBlock(state, entry);
    for (let position = 0; position < values.length; position++) {
      const value = values[position]!;
      if (value === 0) continue;
      const atMs = baseAtMs + value - 1;
      if (typeof atMs !== "number" || !Number.isSafeInteger(atMs))
        throw new Error("RSA hunt timestamp exceeds the exact integer range");
      const attacker = position < target ? position : position + 1;
      result.push({
        attackerTeamId: predictionTeam(state, String(attacker)),
        targetTeamId,
        generation,
        atMs,
        via: "rsa",
      });
    }
  }
  // Equal-millisecond entries have a deterministic order; no sub-ms order is claimed.
  return result.sort((a, b) => a.atMs - b.atMs);
}
