import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

/**
 * `stackstack-base/app/server.mjs` serves a `/docs` API console shared by
 * every `stackstack-*` problem (onboarding + the eight StackStack-proper
 * scenarios). Its "任意の API を試す" panel and Swagger UI both depend on an
 * inline `<script>` block that `docsPage()` emits from a template literal.
 *
 * 2026-08-08 incident: that script contained a literal `"\n\n"` written
 * *inside* the outer template literal, so the template's own interpolation
 * consumed the escape and emitted a raw newline into the generated HTML.
 * A raw newline inside a JS string literal is a `SyntaxError` — the whole
 * inline script silently failed to parse, so neither Swagger UI nor the
 * "実行" button's click handler ever ran. Every `stackstack-*` problem that
 * tells a participant "ターミナル不要、/docs から実行する" was, in fact,
 * unsolvable without a terminal. Reading `server.mjs` did not reveal this:
 * the source looks correct, only the *generated* HTML is broken.
 *
 * These tests fetch the real `/docs` response over HTTP and check the
 * emitted script the way a browser would — parse it, and drive the actual
 * request panel — instead of asserting on server.mjs's source text, which
 * this incident proved gives no signal at all.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const SERVER = join(REPO_ROOT, "stackstack-base", "app", "server.mjs");

// Clear of the catalog's 18080/18081 convention so this suite can run
// alongside a live `make local` session.
const CHALLENGE_PORT = 18290;
const VERIFY_PORT = 18291;
const BOARD = `http://127.0.0.1:${CHALLENGE_PORT}`;
const SEED = "stackstack-base-docs-console-test-seed";

let scratch = "";
let server: ReturnType<typeof spawn>;

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), "stackstack-base-docs-"));
  const configPath = join(scratch, "app.json");
  // onboarding's shipped config is a minimal, known-good fixture for any
  // scenario that reads APP_CONFIG at boot.
  writeFileSync(
    configPath,
    readFileSync(
      join(REPO_ROOT, "challenges", "stackstack-onboarding", "local", "config", "app.json"),
    ),
  );

  server = spawn("bun", [SERVER], {
    env: {
      ...process.env,
      SCENARIO: "onboarding",
      FLAG_SEED: SEED,
      APP_CONFIG: configPath,
      CHALLENGE_PORT: String(CHALLENGE_PORT),
      VERIFY_PORT: String(VERIFY_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const deadline = Date.now() + 4_000;
  for (;;) {
    try {
      const health = await fetch(`${BOARD}/healthz`);
      if (health.ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error("the board never became healthy");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

afterAll(() => {
  server?.kill();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

/** Extract every inline `<script>...</script>` block's source text. */
function extractInlineScripts(html: string): string[] {
  return [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1])
    .filter((s) => s.trim().length > 0);
}

describe("stackstack-base /docs console", () => {
  it("should serve a docs page whose inline scripts are syntactically valid JavaScript", async () => {
    const response = await fetch(`${BOARD}/docs?lang=ja`);
    expect(response.status).toBe(200);
    const html = await response.text();
    const scripts = extractInlineScripts(html);
    // If this is 0, the page markup changed and the assertion below is
    // vacuously true — guard against that silently passing.
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      // `new Function` parses (and, at call time, runs) the script body the
      // same way a browser's HTML parser would — a raw newline inside a
      // string literal throws SyntaxError here exactly as it would client-side.
      expect(() => new Function(script)).not.toThrow();
    }
  });

  it("should serve the same syntactically valid script in English", async () => {
    const response = await fetch(`${BOARD}/docs?lang=en`);
    expect(response.status).toBe(200);
    const scripts = extractInlineScripts(await response.text());
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(() => new Function(script)).not.toThrow();
    }
  });

  it("should actually execute the request-workbench's send handler and render a response", async () => {
    // Reproduces what "実行" does in a browser: fetch /docs, pull out the
    // handler source, and run it against a DOM-like stub. This is the
    // regression check for the incident itself — with the bug present, the
    // handler is never even reached because the enclosing script throws
    // before `addEventListener` runs.
    const html = await (await fetch(`${BOARD}/docs?lang=ja`)).text();
    const scripts = extractInlineScripts(html);
    const workbenchScript = scripts.find((s) => s.includes("request-send"));
    expect(workbenchScript).toBeDefined();

    const elements: Record<string, { value: string; textContent: string }> = {
      "request-send": { value: "", textContent: "" },
      "request-method": { value: "GET", textContent: "" },
      "request-path": { value: "/healthz", textContent: "" },
      "request-headers": { value: "{}", textContent: "" },
      "request-body": { value: "", textContent: "" },
      "request-response": { value: "", textContent: "" },
    };
    let clickHandler: (() => Promise<void>) | undefined;
    const stubDocument = {
      getElementById: (id: string) => {
        const el = elements[id];
        if (!el) return null;
        return {
          get value() {
            return el.value;
          },
          get textContent() {
            return el.textContent;
          },
          set textContent(v: string) {
            el.textContent = v;
          },
          addEventListener: (_event: string, handler: () => Promise<void>) => {
            if (id === "request-send") clickHandler = handler;
          },
        };
      },
    };

    // The script references `document`, `window`, `fetch`, and `URL` as
    // ambient globals — bind exactly those, the same surface a <script> tag
    // gets in a real page.
    const run = new Function(
      "document",
      "window",
      "fetch",
      "URL",
      "SwaggerUIBundle",
      `${workbenchScript}`,
    );
    // A real browser's `fetch` resolves a relative URL against the current
    // page automatically; Bun's global `fetch` does not, so the stub does
    // that resolution itself before delegating to the real network call.
    const originResolvedFetch = (input: string, init?: RequestInit) =>
      fetch(new URL(input, BOARD), init);
    run(stubDocument, { location: { origin: BOARD } }, originResolvedFetch, URL, () => {});

    expect(clickHandler).toBeDefined();
    await clickHandler?.();

    // With the incident's bug present, the enclosing script never parses, so
    // `request-send` never gets a listener and this would already have
    // failed at the `toBeDefined()` above. Checking the rendered output too
    // pins the *intended* newline-separated "status line, blank line, body"
    // shape the fix restores.
    expect(elements["request-response"].textContent).toMatch(/^200 OK\n\n/);
    expect(elements["request-response"].textContent).toContain('"ok":true');
  });

  it("should declare a light color-scheme so dark-mode browsers do not render black-on-black", async () => {
    // 2026-08-08: /docs and the board it links to were unreadable in a
    // dark-mode browser — no background/color-scheme was declared, so the
    // page fell through to the UA's dark default canvas under light-themed
    // component colors (or vice versa). The fix pins light explicitly;
    // this problem's screens are not meant to demonstrate theming.
    const html = await (await fetch(`${BOARD}/docs?lang=ja`)).text();
    expect(html).toMatch(/color-scheme\s*:\s*light/);
    expect(html).toMatch(/body\s*\{[^}]*background\s*:\s*#fff/);
  });
});
