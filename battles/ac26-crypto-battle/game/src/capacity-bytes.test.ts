import { expect, test } from "bun:test";
import { createMeter } from "./capacity-bytes.fixture.ts";

test("transition meter equals JSON UTF-8 for replacements, pruning, reordering, legacy objects and old snapshots", () => {
  const meter = createMeter(),
    a = { label: '雪"\\', optional: undefined },
    b = { n: -12 },
    c = [null, 0, "😀"];
  const history = [];
  for (let i = 0; i < 300; i++) {
    const all = [a, b, c, undefined, "escaped\ntext", i];
    const state = {
      a: all.slice(i % 4).reverse(),
      b: i % 3 ? [a, a, b] : [],
      c: { value: i % 2 ? null : undefined, number: i },
      d: i % 7 ? undefined : "legacy",
    };
    history.push(state);
    expect(meter(state)).toBe(Buffer.byteLength(JSON.stringify(state)));
  }
  for (const state of history.reverse())
    expect(meter(state)).toBe(Buffer.byteLength(JSON.stringify(state)));
});
