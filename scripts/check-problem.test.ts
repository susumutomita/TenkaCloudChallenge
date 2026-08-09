import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkProblem,
  findProblemDir,
  isFailing,
  listProblemIds,
  hostTerminalCheck,
  localPlayableCheck,
  participantSurfaceCheck,
  schemaCheck,
} from "./check-problem.ts";

/**
 * 出荷ゲート自体の test (Issue 382)。
 *
 * この checker は「解けない問題をマージさせない」ための入口なので、**素通しになっていない
 * こと**を固定するのが test の主目的である。壊れた問題を pass と言う checker は、無い方が
 * ましなくらい害がある (作者に「検査を通った」と誤って伝えるため)。
 *
 * 対称に、正しく作られた問題を fail と言わないことも固定する。特に AWS 専用問題と
 * course checkpoint 以外の問題は **対象外であって欠陥ではない**ので `skip` になる。
 */

function fixture(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "check-problem-"));
  for (const [relative, content] of Object.entries(files)) {
    const full = join(dir, relative);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe("metadata schema", () => {
  it("should fail a metadata.json that misses a required field", () => {
    const dir = fixture({ "metadata.json": JSON.stringify({ id: "broken" }) });
    const result = schemaCheck(dir);
    expect(result.status).toBe("fail");
    expect(result.detail).toBeTruthy();
  });

  it("should pass a metadata.json that the catalog already ships", () => {
    expect(schemaCheck("challenges/wp-exposed-backup").status).toBe("pass");
  });
});

describe("participant surface", () => {
  it("should fail a problem whose inline script carries the escape Issue 395 is about", () => {
    const dir = fixture({
      "local/app/server.mjs":
        `const page = ` +
        "`" +
        `<!doctype html><meta name="color-scheme" content="light dark"><script>` +
        String.raw`const s = "\n";` +
        `</script>` +
        "`" +
        `;`,
    });
    const result = participantSurfaceCheck(dir);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("script-escape");
  });

  it("should look inside nested directories, not only the problem root", () => {
    // 参加者へ配信される file は `local/app/` の下に居る。root だけ見る checker は
    // 実際の欠陥を 1 件も見ない。
    const dir = fixture({
      "deep/nested/app.mjs": `<!doctype html><html><body>no color scheme</body></html>`,
    });
    expect(participantSurfaceCheck(dir).status).toBe("fail");
  });

  it("should ignore test sources, which are not shipped to participants", () => {
    const dir = fixture({
      "local/app/server.test.mjs": `<!doctype html><html><body>fixture</body></html>`,
    });
    expect(participantSurfaceCheck(dir).status).toBe("pass");
  });
});

describe("local playable", () => {
  it("should pass a problem that ships a local/ workload", () => {
    const dir = fixture({ "local/compose.yaml": "services: {}\n" });
    expect(localPlayableCheck(dir).status).toBe("pass");
  });

  it("should skip, not fail, a problem that is AWS only and says so", () => {
    // AWS 専用は設計であって欠陥ではない。ここを fail にすると赤が意味を失う。
    // 黙っていることだけが欠陥で、それは下の Issue 402 の block が見る。
    const dir = fixture({
      "metadata.json": JSON.stringify({ instructions: "実 AWS アカウントが必要です。" }),
    });
    expect(localPlayableCheck(dir).status).toBe("skip");
  });
});

describe("checkProblem", () => {
  it("should fail an id that has no metadata.json anywhere", () => {
    const report = checkProblem("no-such-problem-id");
    expect(isFailing(report)).toBe(true);
    expect(report.results[0]?.name).toBe("problem exists");
  });

  it("should pass an AWS-only catalog problem with the AWS-only check skipped", () => {
    const report = checkProblem("wp-exposed-backup");
    expect(isFailing(report)).toBe(false);
    expect(report.results.map((r) => r.status)).toContain("skip");
  });

  it("should run the static solvability audit for a course checkpoint problem", () => {
    const report = checkProblem("sha256-bytes-padding");
    const solvability = report.results.find((r) => r.name === "solvability (static)");
    expect(solvability?.status).toBe("pass");
  });

  it("should skip the solvability audit for a problem it does not cover", () => {
    // 監査の対象は `local/verifier/server.py` を持つ問題だけ。対象外に「no problems matched」
    // の exit 2 をそのまま fail として出すと、カタログの大半が赤くなる。
    const report = checkProblem("wp-exposed-backup");
    const solvability = report.results.find((r) => r.name === "solvability (static)");
    expect(solvability?.status).toBe("skip");
  });
});

describe("catalog discovery", () => {
  it("should find a problem under challenges/", () => {
    expect(findProblemDir("wp-exposed-backup")).toBe("challenges/wp-exposed-backup");
  });

  it("should find a problem under battles/", () => {
    expect(findProblemDir("hello-world-battle")).toBe("battles/hello-world-battle");
  });

  it("should list every catalog problem exactly once, sorted", () => {
    const ids = listProblemIds();
    expect(ids).toContain("wp-exposed-backup");
    expect(ids).toContain("hello-world-battle");
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });
});

describe("ホスト側のターミナルが要る問題 (Issue 415)", () => {
  it("は docker コマンドを要求しているのに黙っている問題を落とす", () => {
    // local play の売りは「ブラウザだけで完結する」こと。その前提で選んだ人が
    // 最初の一手で docker compose logs を要求されると詰まる。
    const dir = fixture({
      "metadata.json": JSON.stringify({
        instructions: "## 最初の一手\n`docker compose logs lab` でトークンを控える。",
      }),
    });
    const result = hostTerminalCheck(dir);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("instructions");
  });

  it("は片方の言語だけが書いている状態も落とす", () => {
    const dir = fixture({
      "metadata.json": JSON.stringify({
        instructions: "この問題はホスト側のターミナルが必要です。`docker compose exec app bash`。",
        i18n: { en: { instructions: "Run `docker compose exec app bash`." } },
      }),
    });
    expect(hostTerminalCheck(dir)).toMatchObject({ status: "fail" });
  });

  it("は両言語が書いていれば通す", () => {
    const dir = fixture({
      "metadata.json": JSON.stringify({
        instructions: "この問題はホスト側のターミナルが必要です。`docker compose exec app bash`。",
        i18n: {
          en: {
            instructions:
              "This problem requires a terminal on your machine: `docker compose exec app bash`.",
          },
        },
      }),
    });
    expect(hostTerminalCheck(dir)).toMatchObject({ status: "pass" });
  });

  it("は docker コマンドを要求しない問題に断りを求めない", () => {
    // 大半の問題はブラウザだけで終わる。そこへ余計な但し書きを強いると、
    // 本当に要る 2 問の警告が埋もれる。
    const dir = fixture({
      "metadata.json": JSON.stringify({
        instructions: "ポータルの画面だけで完結します。ターミナルは不要です。",
      }),
    });
    expect(hostTerminalCheck(dir)).toMatchObject({ status: "pass" });
  });

  it("は端末という語だけでは要求と見なさない", () => {
    // `festivalgate-terminal-api` の「端末 token」は会場の端末のことで、shell とは無関係。
    // 語ではなく docker の呼び出しで判定している、というのがこの test の主題。
    const dir = fixture({
      "metadata.json": JSON.stringify({
        instructions: "端末 token で `/api/terminal/customers/<id>` を開く。",
      }),
    });
    expect(hostTerminalCheck(dir)).toMatchObject({ status: "pass" });
  });
});

describe("AWS-only problems (Issue 402)", () => {
  it("should fail an AWS-only problem that does not say so", () => {
    // local play のカタログに出て、カードが開いて、最後に「自チームに deploy されていません」
    // で行き止まる。行き止まってから分かるのが問題であって、AWS 専用であること自体ではない。
    const dir = fixture({
      "metadata.json": JSON.stringify({ instructions: "## はじめに\nSSM を開く。" }),
    });
    const result = localPlayableCheck(dir);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("instructions");
  });

  it("should fail when only the Japanese side says so", () => {
    const dir = fixture({
      "metadata.json": JSON.stringify({
        instructions: "この問題は実 AWS アカウントが必要です。",
        i18n: { en: { instructions: "## Getting started" } },
      }),
    });
    expect(localPlayableCheck(dir)).toMatchObject({ status: "fail" });
  });

  it("should skip an AWS-only problem that says so in both languages", () => {
    const dir = fixture({
      "metadata.json": JSON.stringify({
        instructions: "この問題は実 AWS アカウントが必要です。",
        i18n: { en: { instructions: "This problem requires a real AWS account." } },
      }),
    });
    expect(localPlayableCheck(dir)).toMatchObject({ status: "skip" });
  });

  it("should not ask a locally playable problem for the notice", () => {
    const dir = fixture({ "local/compose.yaml": "services: {}\n", "metadata.json": "{}" });
    expect(localPlayableCheck(dir)).toMatchObject({ status: "pass" });
  });
});
