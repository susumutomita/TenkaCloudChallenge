import { describe, expect, test } from "bun:test";
import { createMatch, submitOp } from "../../dev/host.ts";
import { projectForTeam, tick } from "./reducer.ts";

/**
 * Replay the written worksheet against the real judge, with the clock advanced
 * before every move. These are arithmetic/expiry regressions, not measured
 * human reading speeds; the separately recorded timed read-through supplies
 * that evidence. No reference-answer builder is used.
 */
function openCipher(seed: string) {
  const host = createMatch({ eventId: "hint-reading", teamIds: ["reader", "other"], matchSecret: seed });
  host.state = tick(host.state, 60_000);
  const selected = projectForTeam(host.state, "reader").myContracts.find(c => c.status === "open" && c.task.kind === "caesar-shift")!;
  const issuedAt = host.state.contracts.find(c => c.id === selected.id)!.issuedAtMs;
  for (const offset of [5_000, 10_000, 15_000]) {
    expect(submitOp(host, "reader", { kind: "reveal-hint", contractId: selected.id }, issuedAt + offset).kind).toBe("ok");
  }
  const projection = projectForTeam(host.state, "reader");
  const order = projection.myContracts.find(c => c.id === selected.id)!;
  return { host, order, issuedAt, projection };
}

function calculateWrittenSteps(text: string, locale: "ja" | "en") {
  const count = Number((locale === "ja" ? /自分の値：(\d+) 種類/ : /Your values: (\d+) symbols/).exec(text)?.[1]);
  expect(count).toBeGreaterThan(1);
  const rows = [...text.matchAll(locale === "ja" ? /\d+ 番目: (\d+) \+ (\d+) = ？/g : /Position \d+: (\d+) \+ (\d+) = \?/g)];
  expect(rows.length).toBeGreaterThan(0);
  return rows.map(row => {
    const sum = Number(row[1]) + Number(row[2]);
    return String(sum >= count ? sum - count : sum);
  });
}

describe("one selected hint ladder leads to a submitted Order", () => {
  test("the independently hand-computed response is accepted at its measured wall-clock offset", () => {
    const { host, order, issuedAt } = openCipher("hint-reading-3");
    const answer = ["5", "4", "1"];
    const elapsedMs = 72_516; // Historical read-through offset; the new three-symbol order retains its first three values. Not a new reading-speed measurement.
    const before = host.state.teams.reader!.score;
    expect(submitOp(host, "reader", { kind: "cipher", contractId: order.id, answer }, issuedAt + elapsedMs).kind).toBe("ok");
    expect(host.state.contracts.find(c => c.id === order.id)?.status).toBe("completed");
    expect(host.state.teams.reader!.score - before).toBe(30);
    expect(host.state.config.contractTtlMs - elapsedMs).toBe(227_484);
  });

  test("both locales' written additions produce accepted answers, including zero keys and wraparound", () => {
    const keys = new Set<number>();
    for (let seed = 0; seed < 30; seed++) {
      for (const locale of ["ja", "en"] as const) {
        const { host, order, issuedAt, projection } = openCipher(`hint-reading-${seed}`);
        if (order.task.kind !== "caesar-shift" || typeof order.task.myKey !== "number") throw new Error("expected cipher task");
        keys.add(order.task.myKey);
        const text = order.hints[2]!.text![locale];
        const answer = calculateWrittenSteps(text, locale);
        expect(answer).toHaveLength(order.task.plaintext.length);
        const result = submitOp(host, "reader", { kind: "cipher", contractId: order.id, answer }, issuedAt + (order.kind === "rush" ? host.state.config.rushContractTtlMs : host.state.config.contractTtlMs) - 1_000);
        if (result.kind !== "ok") throw new Error(`seed ${seed}/${locale}: ${result.error}`);
        expect(host.state.contracts.find(c => c.id === order.id)).toMatchObject({ status: "completed", resolution: "cipher" });
        // Only this Order was purchased. The other five kinds remain unopened.
        expect(projection.myContracts.filter(c => c.id !== order.id).every(c => c.hints.every(h => h.text === undefined))).toBe(true);
      }
    }
    expect([...keys].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test("buying hints does not extend the existing five-minute deadline", () => {
    const { host, order, issuedAt } = openCipher("expiry-regression");
    expect(host.state.config.contractTtlMs).toBe(300_000);
    expect(host.state.config.contractIntervalMs).toBe(300_000);
    const answer = calculateWrittenSteps(order.hints[2]!.text!.ja, "ja");
    const result = submitOp(host, "reader", { kind: "cipher", contractId: order.id, answer }, issuedAt + 300_000);
    expect(result.kind).toBe("rejected");
    expect(host.state.contracts.find(c => c.id === order.id)?.status).toBe("expired");
  });

  test("the compact ladder retains definitions, formula, one-digit example and unresolved own steps", () => {
    const { order } = openCipher("content-regression");
    const [mechanism, formula, procedure] = order.hints.map(h => h.text!.ja);
    expect(mechanism).toContain("平文");
    expect(mechanism).toContain("暗号文");
    expect(mechanism).toContain("秘密の『鍵』");
    expect(formula).toContain("暗号の番号 = (元の番号 + 鍵)");
    expect(formula!.indexOf("割った余り")).toBeLessThan(formula!.indexOf("mod"));
    expect(formula).toContain("4+3=7→7−5=2");
    expect(procedure).toContain("= ？");
    expect(procedure).toContain("空白区切り");
    expect(procedure).toContain("CIPHER");
    // A review tripwire grounded in the documented one-Order reading route;
    // semantic and judge checks above prevent meeting it by dropping the maths.
    expect([mechanism, formula, procedure].join("\n").length).toBeLessThan(900);
  });
});
