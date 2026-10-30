import { expect, test } from "bun:test";
import { schnorrWitness } from "../../portal/schnorr-witness.ts";
import { power, verifySchnorr } from "./schnorr.ts";

test("visiting another Order before submitting preserves the displayed calculation", () => {
  const proof = { y: power(2, 7) };
  const first = schnorrWitness(proof, null, () => 3)!;
  let draws = 0;
  const restored = schnorrWitness(proof, JSON.stringify(first), () => { draws++; return 4; })!;
  expect(restored).toEqual(first);
  expect(draws).toBe(0);
  const a = power(2, first.r);
  const pending = { ...proof, pending: { y: proof.y, a } };
  expect(schnorrWitness(pending, JSON.stringify(restored), () => { throw Error("cannot reroll a submitted proof"); })).toEqual(first);
  for (let e = 0; e < 11; e++) {
    const z = (first.r + e * first.x) % 11;
    expect(verifySchnorr(proof.y, a, e, z)).toBe(true);
    expect(verifySchnorr(proof.y, a, e, (z + 1) % 11)).toBe(false);
  }
});

test("missing, malformed or mismatching notes recover the submitted proof instead of replacing it", () => {
  const proof = { y: power(2, 7), pending: { y: power(2, 7), a: power(2, 3) } };
  for (const saved of [null, "{", "null", "[]", '{"x":7,"r":4}', '{"x":8,"r":3}', '{"x":7,"r":11}', '{"x":"7","r":3}']) {
    expect(schnorrWitness(proof, saved, () => { throw Error("cannot redraw a pending proof"); })).toEqual({ x: 7, r: 3, recovered: true });
  }
  expect(schnorrWitness({ y: 5, pending: { y: 5, a: power(2, 3) } }, null, () => { throw Error("invalid statement"); })).toBeUndefined();
});

test("another statement gets its own fresh calculation, including a zero nonce", () => {
  const old = JSON.stringify({ x: 7, r: 3 });
  expect(schnorrWitness({ y: power(2, 8) }, old, () => 0)).toEqual({ x: 8, r: 0 });
  expect(schnorrWitness({ y: 5 }, null, () => { throw Error("invalid statement"); })).toBeUndefined();
});
