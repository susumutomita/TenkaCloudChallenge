import { describe, expect, test } from "bun:test";
import {
  ROTOR_P,
  ROTOR_Q,
  parseRotorAnswer,
  rotorEncrypt,
  rotorStep,
  rotorWheel,
} from "./rotor.ts";

describe("the two-wheel teaching model", () => {
  test("the fresh participant calculation outputs before the carry", () => {
    const initial = { a: 3, b: 2 };
    expect(rotorEncrypt([3, 2, 3, 2], initial)).toEqual([3, 2, 2, 3]);
    expect(initial).toEqual({ a: 3, b: 2 });
    expect(rotorEncrypt([3, 2, 3, 2], initial)).toEqual([3, 2, 2, 3]);
    expect(rotorStep(initial)).toEqual({ a: 0, b: 3 });
    let p = initial;
    for (let n = 0; n < 16; n++) p = rotorStep(p);
    expect(p).toEqual(initial);
  });
  test("all 4096 inputs agree with an independent fixed lookup/odometer reference", () => {
    const p = [
      [1, 3, 0, 2],
      [2, 3, 1, 0],
      [2, 0, 3, 1],
      [3, 2, 0, 1],
    ];
    const q = [
      [3, 0, 2, 1],
      [3, 1, 0, 2],
      [0, 3, 1, 2],
      [2, 0, 1, 3],
    ];
    for (let a = 0; a < 4; a++)
      for (let b = 0; b < 4; b++)
        for (let word = 0; word < 256; word++) {
          const m = [
            word % 4,
            Math.floor(word / 4) % 4,
            Math.floor(word / 16) % 4,
            Math.floor(word / 64),
          ];
          const expected = m.map(
            (x, i) =>
              q[(b + Math.floor((a + i) / 4)) % 4]![p[(a + i) % 4]![x]!]!,
          );
          const encrypted = rotorEncrypt(m, { a, b });
          expect(encrypted).toEqual(expected);
          // Reverse the Q then P lookup at the same known positions. This proves
          // recovering the initial state recovers arbitrary originals, not only a key quiz.
          const recovered = encrypted.map((c, i) =>
            p[(a + i) % 4]!.indexOf(
              q[(b + Math.floor((a + i) / 4)) % 4]!.indexOf(c),
            ),
          );
          expect(recovered).toEqual(m);
        }
    for (const wheel of [ROTOR_P, ROTOR_Q])
      for (let position = 0; position < 4; position++) {
        expect(
          new Set([0, 1, 2, 3].map((x) => rotorWheel(x, position, wheel))).size,
        ).toBe(4);
      }
  });
  test("one public pair may identify the initial positions or remain ambiguous", () => {
    const candidates = (m: number[], c: number[]) =>
      Array.from({ length: 16 }, (_, i) => ({
        a: i % 4,
        b: Math.floor(i / 4),
      })).filter(
        (p) => JSON.stringify(rotorEncrypt(m, p)) === JSON.stringify(c),
      );
    expect(candidates([0, 0, 1, 1], [1, 1, 1, 3])).toEqual([{ a: 1, b: 2 }]);
    expect(candidates([0, 0, 1, 0], [1, 1, 1, 0])).toEqual([
      { a: 1, b: 2 },
      { a: 1, b: 3 },
    ]);
  });
  test("strict numeric cards cannot accept malformed input as an answer attempt", () => {
    expect(parseRotorAnswer(["0", "1", "2", "3"])).toEqual([0, 1, 2, 3]);
    for (const row of [
      null,
      [],
      ["0", "1", "2"],
      ["0", "1", "2", "4"],
      [0, 1, 2, 3],
      ["0", "1", "2", "3.0"],
      ["0", "1", "2", ""],
      ["0", "1", "2", "03"],
    ])
      expect(parseRotorAnswer(row)).toBeUndefined();
  });
});
