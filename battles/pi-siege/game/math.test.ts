import { expect, test } from "bun:test";
import { allocation, approximation, candidateCost, compare, format, fraction, minimumCost, PI_HI, PI_LO, table } from "./math.ts";

test("the pi enclosure and a genuine exceptional finite approximation", () => {
  expect(compare(PI_LO, PI_HI)).toBe(-1);
  expect(compare(PI_LO, fraction(3141592653589793n, 10n ** 15n))).toBe(1);
  expect(compare(PI_HI, fraction(3141592653589794n, 10n ** 15n))).toBe(-1);
  expect(approximation(355, 113).cubic).toBe("below");
  expect(approximation(710, 226).cubic).toBe("above");
  expect(approximation(355, 113).error).toStartWith("約");
  expect(approximation(22, 7).cubic).toBe("below");
  expect(approximation(3, 1).cubic).toBe("below");
  expect(approximation(0, 7).cubic).toBe("above");
  expect(compare(approximation(355, 113).scaledHigh, approximation(22, 7).scaledHigh)).toBe(-1);
});
test("integer clearing scales a 2x2 determinant quadratically, including negative values", () => {
  const r = table([{ n: 1, d: 1 }, { n: 1, d: 2 }, { n: 1, d: 1 }, { n: 3, d: 4 }]);
  expect(format(r.determinant)).toBe("1/4"); expect(r.common).toBe(4n); expect(format(r.floor)).toBe("1/16"); expect(r.small).toBe(false);
  const zero = table([{ n: 1, d: 1 }, { n: 2, d: 4 }, { n: 1, d: 1 }, { n: 1, d: 2 }]);
  expect(zero.determinant.n).toBe(0n); expect(zero.common).toBe(2n);
  const negative = table([{ n: 1, d: 1 }, { n: 5, d: 8 }, { n: 1, d: 1 }, { n: 1, d: 2 }]);
  expect(format(negative.determinant)).toBe("-1/8"); expect(negative.small).toBe(true);
});
test("mixed configurations are the dangerous ones, independently enumerated", () => {
  for (const [rows, expected] of [[2, 1], [3, 2], [4, 4], [5, 6], [6, 9]]) {
    const pairs = Array.from({ length: rows! }, (_, d) => [{ a: 0, d }, { a: 1, d }]).flat();
    let min = Infinity;
    function choose(index: number, left: number, cost: number) {
      if (left === 0) { min = Math.min(min, cost); return; }
      for (let i = index; i <= pairs.length - left; i++) choose(i + 1, left - 1, cost + pairs[i]!.a + pairs[i]!.d);
    }
    choose(0, rows!, 0);
    expect(min).toBe(expected!); expect(minimumCost(rows!)).toBe(min);
  }
  expect(candidateCost(4, 0)).toBe(6); expect(candidateCost(4, 2)).toBe(4);
});
test("coarse grids miss the nu=9/4 window and delta's quadratic term is kept", () => {
  expect(Array.from({ length: 9 }, (_, i) => allocation(i + 1, 10)).some(a => a.valid)).toBe(false);
  expect(allocation(26, 50).valid).toBe(true); expect(allocation(27, 50).valid).toBe(true);
  const trap = allocation(51, 100);
  expect(trap.collision.n > 0n && trap.error.n > 0n).toBe(true);
  expect(trap.actualCollision.n < 0n).toBe(true); expect(trap.valid).toBe(false);
  const a = allocation(53, 100);
  expect(a.valid).toBe(true); expect(format(a.collision)).toBe("3/50"); expect(format(a.error)).toBe("23/400");
  expect(format(a.actualCollision)).toBe("3191/1000000"); expect(format(a.actualError)).toBe("23/4000");
  expect(allocation(5, 10).valid).toBe(false); expect(allocation(6, 10).valid).toBe(false);
});
