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
  return interpret(`print("Hello, ${name}!");`, environment);
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
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Greeting Workshop / あいさつ工房</title>
<h1>Greeting Workshop / あいさつ工房</h1>
<p>Try a name and inspect the preview. 名前を入れ、出力を調べよう。</p>
<form method="post" action="/greet"><label>Name / 名前 <input name="name" maxlength="512" value="${escapeHtml(name)}"></label><button>Preview / 表示</button></form>
<h2>Template / テンプレート</h2><pre>print("Hello, &lt;name&gt;!");</pre>
<p>The name replaces &lt;name&gt; before this tiny program runs. 名前を埋めてから、この小さな言語を実行します。</p>
<p>Grammar / 文法: print(文字列 / string); + joins strings / 文字列を連結。</p>
<pre>print("red" + " blue"); → red blue
print(env["COLOR"]); → blue</pre>
<p>env is a teaching dictionary of named settings. COLOR is public; FLAG holds this instance's fictional passphrase. env は名前付き設定の教材用辞書です。COLOR は公開値、FLAG はこの環境の架空の合言葉です。</p>
<p>Only strings, +, print and env lookup exist: no real OS commands, files, network or memory access. 文字列・連結・表示・辞書参照のみで、OS 操作やメモリ参照はありません。</p>
<h2>Output / 出力</h2><pre>${escapeHtml(output)}</pre></html>`;
}

export function challengeServer(environment) {
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/healthz") return send(response, 200, "text/plain", "ok");
    if (request.method === "GET" && request.url === "/") return send(response, 200, "text/html", page());
    if (request.method !== "POST" || request.url !== "/greet") return send(response, 404, "text/plain", "Not found.");
    try {
      const name = new URLSearchParams(await readBody(request)).get("name") ?? "";
      let output;
      try { output = vulnerableGreeting(name, environment); }
      catch { output = "Invalid lab program. / 教材の文法に合いません。"; }
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
