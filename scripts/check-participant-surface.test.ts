import { describe, expect, it } from "bun:test";
import {
  checkSource,
  findBodyColorPairIssues,
  findColorSchemeIssues,
  findScriptEscapeIssues,
} from "./check-participant-surface";

/**
 * 検出器そのものの test (Issue 398)。
 *
 * この file が無いと「常に空配列を返す検出器」でも `bun run validate` は緑になる。実際に
 * 起きた 2 件の欠陥を fixture として持ち、**それを検出できること**と、**正しい書き方を
 * 誤検出しないこと**の両方を固定する。誤検出する検出器は、作者に正解を不正解と教えるので
 * 見逃す検出器より害が大きい。
 */

describe("script escape (Issue 395)", () => {
  it("should catch the escape the outer template literal eats", () => {
    // 実際に配信を壊していた形。外側のテンプレートリテラルが `\n` を実際の改行にするので、
    // 配信される script では文字列リテラルが行をまたいで SyntaxError になる。
    const source = String.raw`
      return ` + "`" + String.raw`<!doctype html><script>
        output.textContent = status + "\n\n" + text;
      </script>` + "`" + String.raw`;
    `;
    const findings = findScriptEscapeIssues(source, "server.mjs");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.rule).toBe("script-escape");
  });

  it("should accept a doubled backslash, which survives the outer literal", () => {
    const source = String.raw`<script>const nl = "\\n";</script>`;
    expect(findScriptEscapeIssues(source, "server.mjs")).toEqual([]);
  });

  it("should accept ${JSON.stringify(...)}, the documented correct form", () => {
    // Issue 398 がこれを正典と呼んでいる。ここを誤検出すると、直し方を示した先で落ちる。
    const source =
      "<script>output.textContent = status + ${JSON.stringify(" +
      String.raw`"\n\n"` +
      ")} + text;</script>";
    expect(findScriptEscapeIssues(source, "server.mjs")).toEqual([]);
  });

  it("should ignore escapes outside a script block", () => {
    // サーバ側 (配信されない) の JS は普通に `\n` を書いてよい。
    const source = String.raw`const separator = "\n\n"; // plain server code`;
    expect(findScriptEscapeIssues(source, "server.mjs")).toEqual([]);
  });

  it("should report the line where the escape actually sits", () => {
    const source =
      "line1\nline2\n<script>\nconst a = 1;\nconst b = " + String.raw`"\n"` + ";\n</script>";
    expect(findScriptEscapeIssues(source, "server.mjs")[0]?.line).toBe(5);
  });
});

describe("color scheme (Issue 396)", () => {
  it("should catch an HTML document that declares no color-scheme", () => {
    const source = `<!doctype html><html><head><title>x</title></head><body>hi</body></html>`;
    const findings = findColorSchemeIssues(source, "server.mjs");
    expect(findings.length).toBe(1);
    expect(findings[0]?.rule).toBe("color-scheme");
  });

  it("should accept the meta form", () => {
    const source = `<!doctype html><html><head><meta name="color-scheme" content="light dark"></head></html>`;
    expect(findColorSchemeIssues(source, "server.mjs")).toEqual([]);
  });

  it("should accept the CSS form", () => {
    const source = `<!doctype html><html><head><style>:root{color-scheme:light dark}</style></head></html>`;
    expect(findColorSchemeIssues(source, "server.mjs")).toEqual([]);
  });

  it("should stay silent for a file that serves no HTML", () => {
    // API だけを返す問題に「ダークモード対応しろ」と言っても意味がない。
    expect(findColorSchemeIssues(`send(response, 200, { ok: true });`, "api.mjs")).toEqual([]);
  });
});

describe("checkSource", () => {
  it("should report both classes from one file", () => {
    const source =
      `<!doctype html><html><head></head><body><script>const s = ` +
      String.raw`"\n"` +
      `;</script></body></html>`;
    expect(new Set(checkSource(source, "server.mjs").map((f) => f.rule))).toEqual(
      new Set(["script-escape", "color-scheme"]),
    );
  });
});

describe("body colour pair (Issue 400 の実プレイで判明)", () => {
  it("should catch a body that sets only a text colour", () => {
    // `color-scheme` を宣言するとブラウザはダークモードで canvas を暗く塗る。そこへ暗い
    // 文字色だけを置くと、宣言が無かったとき (Issue 396 の元の形) と同じ結果になる。
    const source = `<!doctype html><html><head><meta name="color-scheme" content="light dark">
<style>body{font-family:system-ui;color:#1b2733}</style></head><body>hi</body></html>`;
    const findings = findBodyColorPairIssues(source, "server.mjs");
    expect(findings.length).toBe(1);
    expect(findings[0]?.rule).toBe("body-color-pair");
  });

  it("should accept a body that sets both", () => {
    const source = `<!doctype html><html><head></head>
<style>body{background:#fff;color:#1b2733}</style><body>hi</body></html>`;
    expect(findBodyColorPairIssues(source, "server.mjs")).toEqual([]);
  });

  it("should accept a body that sets neither, leaving the browser's own pair", () => {
    // 何も指定しなければ文字色と背景はブラウザが組で決める。壊れるのは片方だけ書いたとき。
    const source = `<!doctype html><html><head></head><style>body{margin:0}</style><body>hi</body></html>`;
    expect(findBodyColorPairIssues(source, "server.mjs")).toEqual([]);
  });

  it("should catch the same mistake written as an inline style attribute", () => {
    const source = `<!doctype html><html><body style="font-family:system-ui;color:#111">hi</body></html>`;
    expect(findBodyColorPairIssues(source, "server.mjs")).toHaveLength(1);
  });

  it("should accept background-color as the background half", () => {
    const source = `<!doctype html><html><style>body{background-color:#fff;color:#111}</style><body>hi</body></html>`;
    expect(findBodyColorPairIssues(source, "server.mjs")).toEqual([]);
  });

  it("should stay silent for a file that serves no HTML", () => {
    expect(findBodyColorPairIssues(`const body = { color: "red" };`, "api.mjs")).toEqual([]);
  });
});
