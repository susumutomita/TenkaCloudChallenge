import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { localPlayUrlCheck, participantSurfaceCheck, schemaCheck } from "./check-problem";
import { main, parseArgs, runtimeCatalogText, scaffoldProblem } from "./new-problem";
import { RUNTIMES, resolveStarter } from "./problem-runtimes";

/**
 * runtime を軸にした scaffold の contract (Issue 388)。
 *
 * 守りたいのは 2 つ。**runtime ごとに、その runtime のものだけが生成される**こと
 * (Docker 問題の作者が CloudFormation starter から始めない) と、**実行できない runtime を
 * 選ばれたときに動くように見える雛形を作らない**こと。後者を破ると、作者は「雛形はできた」
 * と思ったまま、deploy できない問題を書き進めることになる。
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 他 runtime の artifact。混ざっていたら、その runtime の作者に無関係な物を渡している。 */
const FOREIGN_ARTIFACTS: Readonly<Record<string, readonly string[]>> = {
  "docker/compose": ["template.yaml"],
  "aws/cloudformation": ["local/docker-compose.yml"],
};

const scratches: string[] = [];
function scratchRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), "tenkacloud-runtime-"));
  scratches.push(directory);
  return directory;
}

function cleanup(): void {
  for (const directory of scratches.splice(0)) rmSync(directory, { recursive: true, force: true });
}

describe("resolveStarter", () => {
  it("should point a Docker challenge at a Docker starter", () => {
    const resolved = resolveStarter("docker/compose", "challenge");
    expect(resolved).toMatchObject({ starter: "sqli-demo", category: "challenges" });
  });

  it("should refuse a runtime this repository cannot run yet", () => {
    // 「まだ無い」と「その形の実例が無い」は作者が次に取る行動が違うので、別の文言で断る。
    const resolved = resolveStarter("simulator/aws", "challenge");
    expect(resolved).toHaveProperty("error");
    expect((resolved as { error: string }).error).toContain("まだ実行できません");
  });

  it("should refuse a style that has no real example for that runtime", () => {
    const resolved = resolveStarter("composite", "battle");
    expect((resolved as { error: string }).error).toContain("実例がありません");
  });

  it("should refuse an unknown runtime by name", () => {
    expect(resolveStarter("kubernetes/helm", "challenge")).toHaveProperty("error");
  });
});

describe("every declared starter", () => {
  for (const [runtime, spec] of Object.entries(RUNTIMES)) {
    for (const [style, starter] of Object.entries(spec.starters)) {
      const category = style === "battle" ? "battles" : "challenges";
      it(`${runtime} / ${style} points at a problem that exists (${starter})`, () => {
        expect(existsSync(join(REPO_ROOT, category, starter, "metadata.json"))).toBe(true);
      });

      it(`${runtime} / ${style} carries no artifact from another runtime`, () => {
        for (const foreign of FOREIGN_ARTIFACTS[runtime] ?? []) {
          expect(existsSync(join(REPO_ROOT, category, starter, foreign))).toBe(false);
        }
      });
    }
  }

  it("should declare a runtime that matches the one it is the starter for", () => {
    // starter 自身が別の runtime を宣言していたら、複製した瞬間に嘘の宣言が生まれる。
    for (const [runtime, spec] of Object.entries(RUNTIMES)) {
      for (const [style, starter] of Object.entries(spec.starters)) {
        const category = style === "battle" ? "battles" : "challenges";
        const meta = JSON.parse(
          readFileSync(join(REPO_ROOT, category, starter, "metadata.json"), "utf8"),
        ) as { runtime?: { kind?: string; provider?: string; engine?: string } };
        if (meta.runtime === undefined) {
          // legacy cfnTemplate 形式。CLI が declare を書き足すので、対象は AWS だけ。
          expect(runtime).toBe("aws/cloudformation");
          continue;
        }
        const declared =
          meta.runtime.kind === "composite"
            ? "composite"
            : `${meta.runtime.provider}/${meta.runtime.engine}`;
        expect(declared).toBe(runtime);
      }
    }
  });
});

describe("parseArgs", () => {
  it("should require a runtime rather than guessing one", () => {
    const parsed = parseArgs(["my-problem", "--style", "challenge"]);
    expect((parsed as { error: string }).error).toContain("--runtime");
  });

  it("should require a style, and say what the two mean", () => {
    const parsed = parseArgs(["my-problem", "--runtime", "docker/compose"]);
    expect((parsed as { error: string }).error).toContain("Battle");
  });

  it("should resolve runtime and style into a starter and a category", () => {
    expect(parseArgs(["my-problem", "--runtime", "docker/compose", "--style", "challenge"])).toMatchObject(
      { category: "challenges", from: "sqli-demo", id: "my-problem", legacy: false },
    );
  });

  it("should let --from override the starter", () => {
    expect(
      parseArgs([
        "my-problem",
        "--runtime",
        "docker/compose",
        "--style",
        "challenge",
        "--from",
        "xss-demo",
      ]),
    ).toMatchObject({ from: "xss-demo" });
  });

  it("should still accept the old positional form, flagged as legacy", () => {
    expect(parseArgs(["challenges", "my-problem"])).toMatchObject({
      category: "challenges",
      from: "hello-world",
      legacy: true,
    });
  });

  it("should reject mixing the old positional form with the new flags", () => {
    const parsed = parseArgs(["challenges", "my-problem", "--runtime", "docker/compose"]);
    expect((parsed as { error: string }).error).toContain("新形式");
  });

  it("should reject an id that is not kebab-case", () => {
    expect(parseArgs(["My_Problem", "--runtime", "docker/compose", "--style", "challenge"])).toHaveProperty(
      "error",
    );
  });
});

describe("scaffolding per runtime", () => {
  it("should give a Docker author no CloudFormation template", () => {
    const parsed = parseArgs(["docker-smoke", "--runtime", "docker/compose", "--style", "challenge"]);
    if ("error" in parsed) throw new Error(parsed.error);
    const dest = scaffoldProblem(parsed, { srcRoot: REPO_ROOT, destRoot: scratchRoot() });
    expect(existsSync(join(dest, "local", "docker-compose.yml"))).toBe(true);
    expect(existsSync(join(dest, "template.yaml"))).toBe(false);
    cleanup();
  });

  it("should record the runtime on an AWS problem the starter left implicit", () => {
    // hello-world は legacy の cfnTemplate 形式。宣言が無いままだと、生成物に「なぜ実クラウド
    // なのか」が残らない。
    const parsed = parseArgs(["aws-smoke", "--runtime", "aws/cloudformation", "--style", "challenge"]);
    if ("error" in parsed) throw new Error(parsed.error);
    const dest = scaffoldProblem(parsed, { srcRoot: REPO_ROOT, destRoot: scratchRoot() });
    const meta = JSON.parse(readFileSync(join(dest, "metadata.json"), "utf8"));
    expect(meta.runtime).toEqual({
      provider: "aws",
      engine: "cloudformation",
      entry: "template.yaml",
    });
    expect(existsSync(join(dest, "local", "docker-compose.yml"))).toBe(false);
    cleanup();
  });

  it("should not overwrite a runtime the starter already declares", () => {
    // sqli-demo の runtime は endpoint / verifyUrl / secretEnv を持つ。上書きすると落ちる。
    const parsed = parseArgs(["keep-smoke", "--runtime", "docker/compose", "--style", "challenge"]);
    if ("error" in parsed) throw new Error(parsed.error);
    const dest = scaffoldProblem(parsed, { srcRoot: REPO_ROOT, destRoot: scratchRoot() });
    const meta = JSON.parse(readFileSync(join(dest, "metadata.json"), "utf8"));
    expect(meta.runtime.verifyUrl).toBeTruthy();
    cleanup();
  });

  it("should always produce a draft, whichever runtime was chosen", () => {
    for (const runtime of ["docker/compose", "aws/cloudformation", "composite"]) {
      const parsed = parseArgs([`draft-smoke-${runtime.replace(/\W/g, "-")}`, "--runtime", runtime, "--style", "challenge"]);
      if ("error" in parsed) throw new Error(parsed.error);
      const dest = scaffoldProblem(parsed, { srcRoot: REPO_ROOT, destRoot: scratchRoot() });
      expect(JSON.parse(readFileSync(join(dest, "metadata.json"), "utf8")).status).toBe("draft");
    }
    cleanup();
  });

  it("should pass the shipping gate immediately, whichever runtime was chosen", () => {
    // 「生成直後に検査が通る」が受け入れ条件。starter が落ちる形になると、作者は自分が
    // 壊したのか元から壊れていたのか区別できず、検査を無視する動機になる。
    for (const runtime of ["docker/compose", "aws/cloudformation", "composite"]) {
      const parsed = parseArgs([`gate-smoke-${runtime.replace(/\W/g, "-")}`, "--runtime", runtime, "--style", "challenge"]);
      if ("error" in parsed) throw new Error(parsed.error);
      const dest = scaffoldProblem(parsed, { srcRoot: REPO_ROOT, destRoot: scratchRoot() });
      expect(schemaCheck(dest), runtime).toMatchObject({ status: "pass" });
      expect(participantSurfaceCheck(dest), runtime).toMatchObject({ status: "pass" });
      expect(localPlayUrlCheck(dest), runtime).toMatchObject({ status: "pass" });
    }
    cleanup();
  });
});

describe("main", () => {
  it("should print the runtime catalog without creating anything", () => {
    const lines: string[] = [];
    const code = main(["--runtimes"], {
      log: (m: string) => lines.push(m),
      error: () => undefined,
    } as unknown as Console);
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("docker/compose");
  });

  it("should refuse an unrunnable runtime with a next step, not a scaffold", () => {
    const errors: string[] = [];
    const code = main(["sim-smoke", "--runtime", "simulator/gcp", "--style", "challenge"], {
      log: () => undefined,
      error: (m: string) => errors.push(m),
    } as unknown as Console);
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("次の選択肢");
    expect(existsSync(join(REPO_ROOT, "challenges", "sim-smoke"))).toBe(false);
  });
});

describe("runtimeCatalogText", () => {
  it("should name every runtime, including the ones that cannot run yet", () => {
    const text = runtimeCatalogText();
    for (const name of Object.keys(RUNTIMES)) expect(text).toContain(name);
    expect(text).toContain("まだ実行できません");
  });
});
