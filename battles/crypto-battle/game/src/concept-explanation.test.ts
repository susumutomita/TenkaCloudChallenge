import { describe, expect, test } from "bun:test";
import { EXPLANATIONS, SHARE_PAIR_TABLE, orderCalculation } from "../../portal/ConceptExplanation.tsx";
import { encrypt, addCiphertexts } from "./fhe.ts";
import { computePartial, sumInField } from "./mpc.ts";
import { mod } from "./field.ts";
import { share, reconstruct } from "./shamir.ts";
import { applyPermutation, ALL_SOLUTIONS } from "./sudoku.ts";

describe("free explanation examples agree with the real game mathematics", () => {
  test("FHE uses separate keys and the combined hiding number, not a shared-key decryption", () => {
    const a = encrypt(1n, 2n, 2n, 7n);
    const b = encrypt(3n, 1n, 3n, 7n);
    expect(a).toEqual({ r: 2n, y: 5n });
    expect(b).toEqual({ r: 3n, y: 6n });
    const sum = addCiphertexts(a, b, 7n);
    expect(sum).toEqual({ r: 5n, y: 4n });
    expect(mod(sum.y - (2n * a.r + 1n * b.r), 7n)).toBe(4n);
    for (const locale of ["ja", "en"] as const) {
      expect(EXPLANATIONS[locale].fhe.steps[2]!.lines.join(" ")).toContain("4 − 7 = −3");
    }
  });

  test("the MPC example cancels paired masks even after the negative subtotal is reduced", () => {
    const partials = [
      { myInput: 2n, incomingMasks: [1n, 0n], outgoingMasks: [4n, 0n] },
      { myInput: 3n, incomingMasks: [4n, 0n], outgoingMasks: [2n, 0n] },
      { myInput: 1n, incomingMasks: [2n, 0n], outgoingMasks: [1n, 0n] },
    ].map((office) => computePartial(office, 7n));
    expect(partials).toEqual([6n, 5n, 2n]);
    expect(sumInField(partials, 7n)).toBe(6n);
    expect(sumInField([2n, 3n, 1n], 7n)).toBe(6n);
  });

  test("the numbered-share example reconstructs with the real interpolation code", () => {
    const pieces = share(1n, 3, 5, [0n, 1n], 7n);
    expect(pieces.slice(0, 3).map((piece) => piece.value)).toEqual([2n, 5n, 3n]);
    expect(reconstruct(pieces.slice(0, 3), 7n)).toBe(1n);
    expect(reconstruct([pieces[0]!, pieces[2]!, pieces[4]!], 7n)).toBe(1n);
  });

  test("all seven secret candidates produce the same first two numbered shares", () => {
    for (const [secret, a, b] of SHARE_PAIR_TABLE) {
      expect(share(BigInt(secret), 3, 5, [BigInt(a), BigInt(b)], 7n).slice(0, 2).map((piece) => piece.value)).toEqual([2n, 5n]);
    }
  });

  test("the ZK row example is a valid relabelling", () => {
    const solution = ALL_SOLUTIONS.find((grid) => grid.slice(0, 4).join() === "2,1,3,4")!;
    expect(applyPermutation(solution, [3, 1, 4, 2]).slice(0, 4)).toEqual([1, 3, 4, 2]);
  });

  test("the final step retains exact large operands and never fills in the answer", () => {
    const task = { kind: "masked-total" as const, partyCount: 3, myInput: "2305843009213693949", incomingMasks: ["2305843009213693947", "2305843009213693943"], outgoingMasks: ["2305843009213693929", "2305843009213693931"] };
    expect(orderCalculation(task, "2305843009213693951", "ja")[0]).toBe("2305843009213693949 + (2305843009213693947 + 2305843009213693943) − (2305843009213693929 + 2305843009213693931) = ?");
  });
});
