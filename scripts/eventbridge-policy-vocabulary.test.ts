import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

/**
 * `eventbridge-delivery-discipline` の policy 語彙 (Issue 416)。
 *
 * ## 何が起きていたか
 *
 * policy は 7 セクションを厳密に採点するのに、**各フィールドが受け付ける値がどこにも
 * 書かれていなかった**。許容値は `validatePolicy` の中のリテラルにしか存在せず、README
 * にも問題文にもヒントにも出ていない。`/public-test` のエラーも "invalid duplicate
 * outcome" としか返さず、何が有効かは言わない。
 *
 * 実測では 50 通り以上試しても `duplicateOutcome` を特定できず、最終的に verifier
 * コンテナへ `docker exec` して grader のソースを直読みするしかなかった。厳密採点は
 * 設計として妥当だが、選択肢を伏せたままの厳密採点は理解ではなく総当たりを要求する。
 *
 * ## ここで固定すること
 *
 * 語彙の定義を `POLICY_VOCABULARY` 1 箇所にしたので、**validator と参加者が見る面が
 * 同じものを読む**。README へ書き写す運用にすると必ずずれ、ずれた表は「書かれていない」
 * より悪い — 読んだ人が信じるぶん遠回りになる。
 *
 * だから検査するのは「表があるか」ではなく「**validator が受け付ける値が、参加者の見える
 * 3 つの面すべてに 1 つ残らず出ているか**」。
 */

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROBLEM = join(REPO_ROOT, "challenges", "eventbridge-delivery-discipline");

const engine = (await import(join(PROBLEM, "local", "app", "engine.mjs"))) as {
  POLICY_VOCABULARY: Record<string, unknown>;
  STARTER_POLICY: Record<string, unknown>;
  validatePolicy: (policy: unknown) => string[];
};

/** すべての受け付ける文字列値を平らに集める。 */
function acceptedStrings(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) if (typeof item === "string") out.push(item);
    return out;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) acceptedStrings(nested, out);
  }
  return out;
}

// 重複は正当。"applied" は idempotency.duplicateOutcome にも ordering.staleOutcome にも出る。
const ACCEPTED = [...new Set(acceptedStrings(engine.POLICY_VOCABULARY))];
const read = (path: string) => readFileSync(join(PROBLEM, path), "utf8");

/**
 * 参加者が実際に受け取る HTML。
 *
 * `server.mjs` のソースを grep しても値は出てこない — 値は `POLICY_VOCABULARY` から
 * 実行時に組み立てられる。それでよく、むしろそれが Issue 416 の再発を防いでいる部分
 * なので、検査するのは**配信されたページ**にする。ソースを見る test はここでは意味が無い。
 */
function servedPage(): string {
  const port = 18991;
  const child = spawn("node", [join(PROBLEM, "local", "app", "server.mjs")], {
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  try {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const probe = spawnSync(
        "node",
        ["-e", `require("http").get("http://127.0.0.1:${port}/",r=>{let b="";r.on("data",d=>b+=d);r.on("end",()=>{process.stdout.write(b)})}).on("error",()=>process.exit(1))`],
        { encoding: "utf8", timeout: 10_000 },
      );
      if (probe.status === 0 && probe.stdout.length > 0) return probe.stdout;
      if (Date.now() > deadline) throw new Error("workbench did not start");
      spawnSync("sleep", ["0.2"]);
    }
  } finally {
    child.kill("SIGKILL");
  }
}

describe("policy 語彙が参加者から見えている (Issue 416)", () => {
  it("は語彙を空にしない", () => {
    // 収集が壊れて 0 件になると、以下の検査がすべて vacuously true になる。
    expect(ACCEPTED.length).toBeGreaterThanOrEqual(25);
    expect(new Set(ACCEPTED).size).toBe(ACCEPTED.length);
  });

  it.each([["README.ja.md"], ["README.md"]])(
    "%s に、受け付ける値が 1 つ残らず出ている",
    (surface) => {
      const text = read(surface);
      const missing = ACCEPTED.filter((value) => !text.includes(value));
      expect(missing, `${surface} に出ていない許容値`).toEqual([]);
    },
  );

  it("は Browser Workbench が配信する HTML にも、受け付ける値が 1 つ残らず出ている", () => {
    // ブラウザだけで完結させる設計なので、README を開かずに解ける必要がある。
    const page = servedPage();
    const missing = ACCEPTED.filter((value) => !page.includes(value));
    expect(missing, "配信ページに出ていない許容値").toEqual([]);
  });

  it("は validator が語彙の外の値を拒む", () => {
    // 表を出したことで採点が緩んでいないこと。選択肢を見せるのと通すのは別。
    const policy = JSON.parse(JSON.stringify(engine.STARTER_POLICY)) as {
      idempotency: { duplicateOutcome: string };
    };
    expect(engine.validatePolicy(policy)).toEqual([]);
    policy.idempotency.duplicateOutcome = "not-in-the-vocabulary";
    expect(engine.validatePolicy(policy).length).toBeGreaterThan(0);
  });

  it("は語彙のすべての値を validator が実際に受け付ける", () => {
    // 逆向き。表に載っているのに通らない値があると、参加者は正しい表を疑うことになり、
    // 「書かれていない」より始末が悪い。
    const vocabulary = engine.POLICY_VOCABULARY as Record<string, Record<string, unknown>>;
    const starter = engine.STARTER_POLICY as Record<string, Record<string, unknown>>;
    const rejected: string[] = [];
    for (const [section, fields] of Object.entries(vocabulary)) {
      if (Array.isArray(fields)) continue; // diagnosis は下で別に確かめる
      for (const [field, allowed] of Object.entries(fields)) {
        if (!Array.isArray(allowed)) continue;
        // starter がその欄に配列を置いているなら、その欄は「語彙から選ぶ配列」。
        // 単独の値を入れて拒否されるのは正しい挙動なので、語彙全体を入れて確かめる。
        const takesArray = Array.isArray(starter[section]?.[field]);
        const candidates: unknown[] = takesArray ? [allowed] : allowed;
        for (const candidate of candidates) {
          const policy = JSON.parse(JSON.stringify(engine.STARTER_POLICY)) as Record<
            string,
            Record<string, unknown>
          >;
          policy[section][field] = candidate;
          if (engine.validatePolicy(policy).length > 0) {
            rejected.push(`${section}.${field} = ${JSON.stringify(candidate)}`);
          }
        }
      }
    }
    expect(rejected).toEqual([]);
  });

  it("は diagnosis の語彙をすべて受け付ける", () => {
    const vocabulary = engine.POLICY_VOCABULARY as { diagnosis: string[] };
    const policy = JSON.parse(JSON.stringify(engine.STARTER_POLICY)) as {
      diagnosis: string[];
    };
    policy.diagnosis = [...vocabulary.diagnosis];
    expect(engine.validatePolicy(policy)).toEqual([]);
  });
});
