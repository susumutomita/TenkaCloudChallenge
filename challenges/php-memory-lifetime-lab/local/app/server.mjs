import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { flagFor } from "./flags.mjs";
import {
  QUIZ,
  runBuggyAsan,
  runFixedScenario,
  runGdbBatch,
  runLabEvent,
} from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(HERE, "index.html"), "utf8");

export function send(response, status, type, body) {
  response.writeHead(status, {
    "content-type": `${type}; charset=utf-8`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self'",
  });
  response.end(body);
}

export function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 8192) {
        reject(new Error("Body too large."));
        return;
      }
      body += chunk.toString("utf8");
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function json(response, status, value) {
  send(response, status, "application/json", JSON.stringify(value));
}

export function challengeServer(seed) {
  const server = createServer(async (request, response) => {
    const url = request.url || "/";
    if (request.method === "GET" && url === "/healthz") {
      return send(response, 200, "text/plain", "ok");
    }
    if (request.method === "GET" && url === "/") {
      return send(response, 200, "text/html", PAGE);
    }
    if (request.method === "GET" && url === "/notes") {
      return send(response, 200, "text/html", notesPage());
    }

    try {
      if (request.method === "POST" && url === "/api/observe") {
        const result = await runBuggyAsan();
        const correct = Boolean(result.asanHeapUaf) && Boolean(result.obs.staleAfterFree);
        return json(response, 200, {
          correct,
          asanHeapUaf: result.asanHeapUaf,
          obsLines: result.obs.lines,
          stderrTail: String(result.stderr || "").slice(-4000),
          flag: correct ? flagFor("observe-asan", seed) : null,
          note:
            "ASan の停止は診断用です。普段の実行と同じとは限りません。クラッシュだけでは合格にしません。",
        });
      }

      if (request.method === "POST" && url === "/api/gdb") {
        const result = await runGdbBatch();
        const text = `${result.stdout}\n${result.stderr}`;
        const sawPointer = /worker_retained_note/.test(text);
        const sawBreakpoint = /Breakpoint|next_request_consume_stale/.test(text);
        return json(response, 200, {
          ok: !result.timedOut && (sawPointer || sawBreakpoint),
          output: text.slice(-8000),
          hint:
            "スタック上にあるのはポインタ変数そのもの。指し先の文字列はヒープ側です。ポインタが残っていることと、指し先がまだ有効なことは別です。",
        });
      }

      if (request.method === "POST" && url === "/api/quiz") {
        const body = JSON.parse(await readBody(request));
        const answer = typeof body?.answer === "string" ? body.answer : "";
        const correct = answer === QUIZ.correct;
        return json(response, 200, {
          correct,
          flag: correct ? flagFor("stack-heap", seed) : null,
        });
      }

      if (request.method === "POST" && url === "/api/lab-event") {
        const result = await runLabEvent();
        const correct = Boolean(result.recorded);
        return json(response, 200, {
          correct,
          events: result.events,
          stdout: result.stdout,
          flag: correct ? flagFor("lab-event", seed) : null,
          note:
            "この呼び出しは教材用ハーネスが意図的に実行したものです。脆弱性を使った制御奪取ではありません。",
        });
      }

      if (request.method === "POST" && url === "/api/fix") {
        const result = await runFixedScenario();
        return json(response, 200, {
          correct: Boolean(result.fixedOk),
          staleObs: result.staleObs.lines,
          normalObs: result.normalObs.lines,
          normalEvents: result.normal.events,
          flag: result.fixedOk ? flagFor("fix-ok", seed) : null,
          note:
            "修正後は解放あとの参照を拒否しつつ、正常な確保・利用・後片付けは残ります。",
        });
      }

      return send(response, 404, "text/plain", "Not found.");
    } catch (error) {
      return json(response, 400, { error: "bad_request", detail: String(error.message || error) });
    }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 20000;
  server.maxHeadersCount = 40;
  return server;
}

function notesPage() {
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>補足ノート</title>
<style>body{font-family:system-ui,sans-serif;max-width:52rem;margin:1.5rem auto;padding:0 1rem;line-height:1.55}code,pre{background:#f4f4f5;padding:.1rem .3rem;border-radius:4px}pre{padding:.75rem;overflow:auto}</style>
<p><a href="/">← 実験に戻る</a></p>
<h1>補足ノート（運営・発展）</h1>
<p>この教材の C プログラムは、PHP 本体でも CVE の再現でもありません。ワーカーがリクエスト所有メモリへの参照を残す、という寿命の話を小さな独立プログラムで観測します。</p>
<h2>スタックとヒープ</h2>
<ul>
<li><strong>スタック</strong>: 関数のローカル変数（例: <code>RequestNote req</code> やポインタ変数そのもの）。呼び出しが終わると枠ごと消える。</li>
<li><strong>ヒープ</strong>: <code>malloc</code>/<code>strdup</code> で確保した領域。自分で <code>free</code> するまで残る。解放後に読むと不正。</li>
<li>ポインタ変数が「アドレスを覚えている」ことと、そのアドレス先がまだ有効なことは別です。</li>
</ul>
<h2>ASan と通常実行</h2>
<p>AddressSanitizer は不正アクセスを検出しやすくするために実行条件を変えます。ここで止まったからといって、同じ入力が常に同じ見え方で落ちるとは限りません。採点は「診断で heap-use-after-free を観測できたか」と、ハーネスが記録した事実を見ます。クラッシュだけで合格にはしません。</p>
<h2>PHP の公式情報（背景のみ）</h2>
<ul>
<li><a href="https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w">CVE-2026-109618 / GHSA-w8hw-w9fx-j79w</a>: OOM 時の非局所脱出で初期化途中の状態が残り、終了処理が不正な状態を扱う問題。</li>
<li><a href="https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp">CVE-2026-109619 / GHSA-6wmf-4rv5-p3rp</a>: ワーカーのグローバルがリクエスト所有メモリへの参照を残し、後続が解放済みを扱う問題。</li>
<li>修正コミット（照合済み）: <a href="https://github.com/php/php-src/commit/3584a98bda0f2c0d367255b046798b0d3a221a19"><code>3584a98bda0f2c0d367255b046798b0d3a221a19</code></a> — <em>Avoid state corruption via bailout</em>。遅延 OOM とグローバルのリセットなどが入ります。教材の NULL クリアは PHP パッチと同一ではありません。</li>
<li>スタックの戻り先上書きを、これらの PHP 問題の原因としては説明しません。</li>
</ul>
</html>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const seed = process.env.FLAG_SEED;
  const { assertSeed } = await import("./flags.mjs");
  assertSeed(seed);
  delete process.env.FLAG_SEED;
  challengeServer(seed).listen(Number(process.env.PORT ?? 8080), process.env.BIND ?? "0.0.0.0");
}
