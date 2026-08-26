import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * A `beforeAll` that polls a spawned server has two deadlines: the one it writes
 * itself, and bun's per-hook default. When the second is shorter, the hook is killed
 * before it can ever run its own diagnostic, and the file fails as
 * "a beforeEach/afterEach hook timed out for this test" — naming neither the server
 * that did not come up nor the timeout that actually fired.
 *
 * That is not hypothetical. On 2026-08-26 the `suite (1/4)` shard failed exactly that
 * way on `signed-does-not-mean-safe spawned runtime contract`: its hook allowed each
 * spawned server 15s, carried no explicit timeout, and was killed at 5000.03ms under
 * shard load. The same file passes in under a second on an idle machine, so the fault
 * only ever appears when a runner is busy — which is when the diagnostic is most needed.
 *
 * The catalog's other spawn hooks avoid this by keeping their poll deadline at 4s,
 * under the default. Either resolution is fine; what is not fine is a hook whose own
 * deadline outlives the timeout that will kill it. This asserts that, so reverting
 * either fix turns the guard red instead of waiting for a loaded runner to notice.
 */

const SCRIPTS = join(import.meta.dir);
const BUN_DEFAULT_HOOK_TIMEOUT_MS = 5_000;
const HOOKS = ["beforeAll", "beforeEach", "afterAll", "afterEach"] as const;

/** Strip line/block comments and string bodies so brace and paren counting is not fooled. */
function blank(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    const quote = source[i];
    if (quote === '"' || quote === "'" || quote === "`") {
      out += " ";
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          out += " ";
          i += 1;
          break;
        }
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

/** Index just past the `)` that closes the call whose `(` sits at `open`. */
function closingParen(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) {
    if (masked[i] === "(") depth += 1;
    else if (masked[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The trailing numeric argument of a hook call, in ms, or null when it has none. */
function explicitTimeout(masked: string, open: number, close: number): number | null {
  const tail = masked.slice(open + 1, close);
  const match = /,\s*([0-9][0-9_]*)\s*$/.exec(tail);
  return match ? Number(match[1].replaceAll("_", "")) : null;
}

/** Every `Date.now() + N` / `deadline = ... + N` budget expressed in a chunk of source. */
function deadlinesIn(masked: string): number[] {
  const found: number[] = [];
  for (const match of masked.matchAll(/Date\.now\(\)\s*\+\s*([0-9][0-9_]*)/g)) {
    found.push(Number(match[1].replaceAll("_", "")));
  }
  return found;
}

/** Bodies of same-file functions, so a hook that polls through a helper is still seen. */
function functionBodies(masked: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const declaration = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g;
  for (const match of masked.matchAll(declaration)) {
    const name = match[1] ?? match[2];
    const brace = masked.indexOf("{", match.index + match[0].length - 1);
    if (brace === -1) continue;
    let depth = 0;
    let end = brace;
    for (let i = brace; i < masked.length; i += 1) {
      if (masked[i] === "{") depth += 1;
      else if (masked[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    bodies.set(name, masked.slice(brace, end + 1));
  }
  return bodies;
}

interface Offender {
  file: string;
  line: number;
  hook: string;
  deadline: number;
  timeout: number | null;
}

function offendersIn(file: string, source: string): Offender[] {
  const masked = blank(source);
  const helpers = functionBodies(masked);
  const offenders: Offender[] = [];

  for (const hook of HOOKS) {
    const pattern = new RegExp(`\\b${hook}\\s*\\(`, "g");
    for (const match of masked.matchAll(pattern)) {
      const open = match.index + match[0].length - 1;
      const close = closingParen(masked, open);
      if (close === -1) continue;
      const body = masked.slice(open + 1, close);

      // The hook's own budget, plus the budget of any same-file helper it awaits —
      // `signed-does-not-mean-safe` keeps its 15s inside a `waitFor` helper.
      const budgets = deadlinesIn(body);
      for (const [name, helperBody] of helpers) {
        if (new RegExp(`\\b${name}\\s*\\(`).test(body)) budgets.push(...deadlinesIn(helperBody));
      }
      if (budgets.length === 0) continue;

      const deadline = Math.max(...budgets);
      if (deadline < BUN_DEFAULT_HOOK_TIMEOUT_MS) continue;

      const timeout = explicitTimeout(masked, open, close);
      if (timeout !== null && timeout > deadline) continue;

      offenders.push({
        file,
        line: source.slice(0, match.index).split("\n").length,
        hook,
        deadline,
        timeout,
      });
    }
  }
  return offenders;
}

const TEST_FILES = readdirSync(SCRIPTS)
  .filter((name) => name.endsWith(".test.ts"))
  .sort();

describe("test hook timeouts outlive the deadlines the hooks set themselves", () => {
  it("finds test files to check at all", () => {
    expect(TEST_FILES.length).toBeGreaterThan(50);
    expect(TEST_FILES).toContain("signed-does-not-mean-safe.test.ts");
    expect(TEST_FILES).toContain("stackstack-vibe-build.test.ts");
  });

  it("leaves no hook that bun's default would kill before its own diagnostic fires", () => {
    const offenders = TEST_FILES.flatMap((name) =>
      offendersIn(name, readFileSync(join(SCRIPTS, name), "utf8")),
    );
    const report = offenders.map(
      (o) =>
        `${o.file}:${o.line} ${o.hook} waits up to ${o.deadline}ms but its timeout is ` +
        `${o.timeout === null ? `bun's ${BUN_DEFAULT_HOOK_TIMEOUT_MS}ms default` : `${o.timeout}ms`}`,
    );
    expect(report).toEqual([]);
  });

  it("is non-vacuous: it flags the shape that failed on 2026-08-26", () => {
    const reintroduced = `
      import { beforeAll } from "bun:test";
      async function waitFor(url) {
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) await fetch(url);
      }
      beforeAll(async () => {
        await waitFor("http://127.0.0.1:1/healthz");
      });
    `;
    const found = offendersIn("reintroduced.test.ts", reintroduced);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ hook: "beforeAll", deadline: 15_000, timeout: null });

    const repaired = reintroduced.replace("});", "}, 60_000);");
    expect(offendersIn("repaired.test.ts", repaired)).toEqual([]);
  });

  it("does not flag a hook that keeps its own deadline under the default", () => {
    const compliant = `
      import { beforeAll } from "bun:test";
      beforeAll(async () => {
        const deadline = Date.now() + 4_000;
        while (Date.now() < deadline) await fetch("http://127.0.0.1:1/healthz");
      });
    `;
    expect(offendersIn("compliant.test.ts", compliant)).toEqual([]);
  });
});
