import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

export function flagForSeed(seed) {
  if (typeof seed !== "string" || !/^[a-f0-9]{64}$/.test(seed)) {
    throw new Error("FLAG_SEED must be an injected 64-character hexadecimal secret.");
  }
  return `TC{${createHmac("sha256", seed).update("greeting-expression-lab:flag").digest("hex").slice(0, 32)}}`;
}

export function labEnvironment(seed) {
  // A teaching dictionary, never process.env or a bridge to the operating system.
  return Object.freeze({ FLAG: flagForSeed(seed), COLOR: "blue" });
}

/** Tiny bounded language: print(string or env["name"], joined with +); */
export function interpret(source, environment) {
  if (typeof source !== "string" || source.length > 2048) throw new Error("Invalid lab program.");
  let offset = 0;
  let statements = 0;
  let atoms = 0;
  const output = [];
  const invalid = () => { throw new Error("Invalid lab program."); };
  const space = () => { while (/\s/.test(source[offset] ?? "") && offset < source.length) offset++; };
  const take = (token) => {
    space();
    if (!source.startsWith(token, offset)) invalid();
    offset += token.length;
  };
  const string = () => {
    space();
    const match = /^"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(source.slice(offset));
    if (!match) invalid();
    offset += match[0].length;
    return JSON.parse(match[0]);
  };
  const atom = () => {
    if (++atoms > 64) invalid();
    space();
    if (source[offset] === '"') return string();
    take("env[");
    const key = string();
    take("]");
    if ((key !== "FLAG" && key !== "COLOR") || !Object.hasOwn(environment, key)) invalid();
    if (typeof environment[key] !== "string" || environment[key].length > 256) invalid();
    return environment[key];
  };
  space();
  while (offset < source.length) {
    if (++statements > 16) invalid();
    take("print(");
    let value = atom();
    space();
    while (source[offset] === "+") {
      take("+");
      value += atom();
      space();
    }
    take(")");
    take(";");
    output.push(value);
    if (output.join("\n").length > 8192) invalid();
    space();
  }
  return output.join("\n");
}

export function vulnerableGreeting(name, environment) {
  if (typeof name !== "string" || name.length > 512) throw new Error("Invalid name.");
  // Intentional training flaw: data becomes grammar in the miniature language.
  const source = 'print("Hello, ' + name + '!");';
  return interpret(source, environment);
}

export function safeGreeting(name) {
  if (typeof name !== "string" || name.length > 512) throw new Error("Invalid name.");
  // The repair never constructs or interprets code from the supplied data.
  return `Hello, ${name}!`;
}

export function send(response, status, type, body) {
  response.writeHead(status, {
    "content-type": `${type}; charset=utf-8`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(body);
}

export function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 4096) { reject(new Error("Body too large.")); return; }
      body += chunk.toString("utf8");
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

function page(name = "", output = "") {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Visitor Card Preview / 来訪者カード</title>
<h1>Visitor Card Preview / 来訪者カード</h1>
<p>Reception preview — enter a display name. 受付用プレビュー。来訪者の表示名を入力してください。</p>
<form method="post" action="/greet"><label>Display name / 表示名 <input name="name" maxlength="512" value="${escapeHtml(name)}"></label><button>Preview / 表示</button></form>
<h2>Preview / プレビュー</h2><pre>${escapeHtml(output)}</pre>
<p><a href="/handover">Maintainer handover / 保守担当への引き継ぎメモ</a></p>
<p>Training preview only: no real OS, files, network or memory access. 限定した模擬環境です。実OS・ファイル・外部通信・メモリは扱いません。</p></html>`;
}

function handoverPage() {
  const snippet = String.raw`const source = 'print("Hello, ' + name + '!");';
return interpret(source, environment);`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Maintainer handover / 引き継ぎメモ</title>
<h1>Maintainer handover / 引き継ぎメモ</h1><p><a href="/">Back to preview / プレビューへ戻る</a></p>
<h2>Acceptance notes / 受け入れ時のメモ</h2>
<p>Names, including punctuation, should appear unchanged between Hello, and !. 記号を含む表示名も、Hello, と ! の間にそのまま表示する要件です。</p>
<p>Reception reported Ada worked, but Blue &quot;Team&quot; failed. They also reported an unexplained extra line; its input was not recorded. 受付の記録は「Ada は成功、Blue &quot;Team&quot; は失敗」。別の入力では行が増えましたが、その入力は記録されていません。</p>
<h2>Current server fragment / 現在のサーバー処理の断片</h2><pre>${escapeHtml(snippet)}</pre>
<p>name is the submitted display name. const names the string assembled with +; interpret processes that string. interpret runs the following tiny preview language; it does not run JavaScript. name は送信された表示名です。const は + で連結した文字列に名前を付け、interpret がその文字列を処理します。interpret は次の専用言語だけを扱い、JavaScriptは実行しません。</p>
<h2>Preview-language reference / 表示用言語の仕様</h2>
<p>A program is one or more print(expression); statements. An expression is a string or dictionary lookup, optionally joined with +. 文は print(式); の形で、複数の文を並べられます。式は文字列か辞書参照で、+ で連結できます。</p>
<p>Strings use double quotes and JSON-style escapes: &#92;&quot; for a quote, &#92;&#92; for a backslash, &#92;n for a line break. A semicolon ends a statement, not a string. 文字列は二重引用符で囲み、引用符は &#92;&quot;、バックスラッシュは &#92;&#92;、改行は &#92;n のように書けます（JSON形式）。セミコロンは文の終わりです。単語と括弧は print( と env[ の形で続けて書きます。</p>
<pre>print("red" + " blue"); → red blue
print(env["COLOR"]); → blue
print("A");print("B"); → A then B on separate lines / AとBを別の行へ</pre>
<p>env is the supplied teaching settings dictionary, not process.env. env は引数で渡す教材用設定辞書で、実OSのprocess.envではありません。</p>
<table><tr><th>Key / 設定名</th><th>Use / 用途</th><th>Value in this note / このメモの値</th></tr>
<tr><td>COLOR</td><td>Public theme / 公開テーマ色</td><td>blue</td></tr>
<tr><td>FLAG</td><td>Private operational check code; not for card output / 運用確認コード。カードには表示しない</td><td>Not included / 非掲載</td></tr></table>
<p>Only strings, +, print and these two dictionary keys exist. No other calls, property traversal, assignments, comments, loops or OS APIs. Limits: name 512 characters, program 2048 characters, 16 statements, 64 total value terms, 8192 output characters. 名前は512文字、生成プログラムは2048文字、16文、式の項は合計64個、出力8192文字まで。文字列・連結・表示・上記2キーの参照以外はなく、print以外の呼出し・属性走査・代入・コメント・ループ・OS APIは使えません。</p>
<p>The code is fictional and instance-specific. Do not put real credentials in this preview. コードはこの環境だけの架空値です。本物の認証情報は入れません。</p></html>`;
}

export function challengeServer(environment) {
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/healthz") return send(response, 200, "text/plain", "ok");
    if (request.method === "GET" && request.url === "/") return send(response, 200, "text/html", page());
    if (request.method === "GET" && request.url === "/handover") return send(response, 200, "text/html", handoverPage());
    if (request.method !== "POST" || request.url !== "/greet") return send(response, 404, "text/plain", "Not found.");
    try {
      const name = new URLSearchParams(await readBody(request)).get("name") ?? "";
      let output;
      try { output = vulnerableGreeting(name, environment); }
      catch { output = "Preview could not be generated. / プレビューを作れませんでした。引き継ぎメモを確認してください。"; }
      return send(response, 200, "text/html", page(name, output));
    } catch { return send(response, 413, "text/plain", "Request rejected."); }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 32;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const environment = labEnvironment(process.env.FLAG_SEED);
  delete process.env.FLAG_SEED;
  challengeServer(environment).listen(8080, "0.0.0.0");
}
