"use strict";

const TEXT_EN = {
  "準備できました。まず inspect を実行してください (一覧は help)。": "Ready. Run inspect first (type help for the list).",
  "$ help inspect server record と 4 本の assertion を表示 show assertion.py 編集中の source を表示 test 公開テスト prepare 3 checkpoint の提出 source を作る reset 初期状態へ戻す clear 表示を消す": "$ help\ninspect            show the server record and the four assertions\nshow assertion.py  print the source you are editing\ntest               public tests\nprepare            build the source submitted to all three checkpoints\nreset              back to the start\nclear              clear the screen",
  "署名は正しい。それでも拒否する — Browser Workbench": "The signature is valid. Reject it anyway — Browser Workbench",
  "署名は正しい。それでも拒否する": "The signature is valid. Reject it anyway",
  "パスキーのサーバ側に立ち、ログイン応答を公開鍵で検証します。その同じコードが、 本人確認をしていない応答も通すところまでを最初の 5 分で見ます。": "You stand on the server side of a passkey and verify a login response with a public key. Within the first five minutes you watch that same code let through a response where nobody was ever verified.",
  "接続確認中": "Connecting",
  "最初に必要なもの": "What you need first",
  "Python だけで始められます": "Python is all you need to start",
  "前提にするもの: Python の bytes、辞書、真偽値。前提にしないもの: 公開鍵、秘密鍵、 署名、challenge、assertion、WebAuthn。ここで順に定義します。楕円曲線の計算は": "Assumed: Python bytes, dicts, booleans. Not assumed: public key, private key, signature, challenge, assertion, WebAuthn — each is defined here as it comes up. The elliptic-curve arithmetic is already finished in",
  "に完成済みで、編集しません。": "and you do not edit it.",
  "端末の authenticator ログイン先の server 秘密鍵を持つ 公開鍵だけを保存 | ^ | challenge と flags に署名 | 署名を検証 +------------- assertion ----------------+ 秘密鍵: 署名を作れる側。端末から送らない。 公開鍵: 署名がその秘密鍵で作られたか確認する側。server に置ける。": "authenticator on the device        server you log in to\n  holds the private key              stores only the public key\n           |                                    ^\n           | signs the challenge and flags      | verifies the signature\n           +-------------- assertion -----------+\n\nprivate key: the side that can produce a signature. Never leaves the device.\npublic key:  the side that checks a signature came from that private key. Safe on the server.",
  "はログインへの署名付き返信です。server が先に出した使い捨ての": "is a signed reply to a login. It binds together the one-time",
  "と、認証器が書いた": "the server issued first, and the",
  "を束ねます。 後者の flags 1 byte には、本人確認をしたかを表す UV bit (": "the authenticator wrote. One byte of flags in the latter carries the UV bit (",
  ") も入ります。": "), which says whether the user was actually verified.",
  "server が持つもの、届いたものを見る": "Look at what the server holds and what arrived",
  "inspect を実行": "Run inspect",
  "server record と 4 本の assertion を表示します。record に公開鍵はありますが秘密鍵は ありません。4 本は「全部正しい」「UV だけ 0」「署名だけ不正」「RP ID だけ不一致」 が必ず 1 本ずつです。WebAuthn の": "It prints the server record and four assertions. The record has the public key and not the private one. The four are always exactly one each of: all correct, UV alone 0, signature alone invalid, RP ID alone mismatched. The WebAuthn",
  "は登録 record と一致し、lab 用の": "matches the registration record, and only the lab",
  "と順番だけが起動ごとに変わります。": "and the order change from one start to the next.",
  "inspect を実行してください。": "Run inspect to see it.",
  "assertion.py を完成させる": "Finish assertion.py",
  "書く順番は次のとおりです。": "Write it in this order.",
  "authenticatorData を decode clientDataJSON を decode → SHA-256 2つをこの順に連結 → 公開鍵で署名検証 flags byte & 0x04 → UV を確認 UV 必須なのに 0 なら、署名が正しくても拒否": "decode authenticatorData\ndecode clientDataJSON → SHA-256\nconcatenate the two in that order → verify the signature with the public key\nflags byte & 0x04 → read UV\nif UV is required and it is 0, reject even though the signature is valid",
  "公開テストを実行": "Run the public tests",
  "提出データを作る": "Build what you submit",
  "初期状態へ戻す": "Back to the start",
  "コマンドコンソール": "Command console",
  "コマンド": "command",
  "実行": "Run",
  "3 checkpoint へ同じ source を提出する": "Submit the same source to all three checkpoints",
  "署名対象の bytes と公開鍵検証だけを未知の fixture で検査します。": "Checks only the signed bytes and the public-key verification, on fixtures you have not seen.",
  "署名が正しく UV=0 の 1 本を、caseId や順番に頼らず選べるか検査します。": "Checks whether you can pick out the one with a valid signature and UV=0 without leaning on caseId or the ordering.",
  "UV 必須時に、正しい署名を": "Checks that, when UV is required, a valid signature is rejected on",
  "だけで拒否します。": "alone.",
  "まだ提出データはありません。": "Nothing has been built yet."
};

const STORAGE_KEY = "tenkacloud.ac26-w3-passkey-assertion.sources.v1";
const output = document.querySelector("#terminal-output");
const inspectOutput = document.querySelector("#inspect-output");
const submissionOutput = document.querySelector("#submission-output");
const assertionEditor = document.querySelector("#assertion-editor");
const connectionStatus = document.querySelector("#connection-status");
let starter = null;

function sources() { return { "assertion.py": assertionEditor.value }; }
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(sources())); }
function print(message = "") { output.textContent += `${message}\n`; output.scrollTop = output.scrollHeight; }

async function request(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

async function copyText(value) {
  try { await navigator.clipboard.writeText(value); return; } catch { /* loopback may deny it */ }
  const area = document.createElement("textarea");
  area.value = value; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0";
  document.body.append(area); area.select(); const copied = document.execCommand("copy"); area.remove();
  if (!copied) throw new Error("clipboard copy was refused");
}

async function inspect() {
  print("$ inspect");
  const payload = await request("/api/inspect");
  inspectOutput.textContent = [
    "== server record: public key and expected context; no credential private key ==",
    JSON.stringify(payload.serverRecord, null, 2), "",
    "== received assertions ==", JSON.stringify(payload.assertions, null, 2), "",
    "authenticatorData: first 32 bytes = rpIdHash, next byte = flags, last 4 = signCount",
    "WebAuthn id matches serverRecord. caseId is only a changing lab label.",
    "UV is bit 0x04 of the signed flags byte. Use your functions; do not guess from caseId.",
  ].join("\n");
  print("inspect: deployment-specific record and assertions shown");
}

async function test() {
  print("$ test");
  const result = await request("/api/test", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ files: sources() }),
  });
  print(result.output.trimEnd()); print(result.passed ? "test: passed" : "test: failed");
}

function renderSubmissions(submissions) {
  submissionOutput.replaceChildren();
  for (const [checkpoint, raw] of Object.entries(submissions)) {
    const value = String(raw); const card = document.createElement("article"); card.className = "submission-card";
    const title = document.createElement("h3"); title.textContent = checkpoint;
    const pre = document.createElement("pre"); pre.textContent = value; pre.tabIndex = 0;
    const button = document.createElement("button"); button.type = "button"; button.textContent = "コピー";
    button.addEventListener("click", async () => {
      try { await copyText(value); button.textContent = "コピーしました"; }
      catch { button.textContent = "手動で選択してください"; pre.focus(); }
      setTimeout(() => { button.textContent = "コピー"; }, 1500);
    });
    card.append(title, pre, button); submissionOutput.append(card);
  }
}

async function prepare() {
  print("$ prepare");
  const result = await request("/api/prepare", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ files: sources() }),
  });
  if (!result.ok) { print(result.output || "prepare: failed"); return; }
  renderSubmissions(result.submissions); print("prepare: same source prepared for 3 independent checkpoints");
  document.querySelector("#submit-title").scrollIntoView({ behavior: "smooth" });
}

function reset() {
  if (!starter) return;
  assertionEditor.value = starter["assertion.py"]; save();
  submissionOutput.innerHTML = '<p class="empty">初期状態へ戻しました。</p>';
  print("$ reset"); print("reset: starter restored");
}

function show(name) {
  const files = sources();
  if (!(name in files)) { print(`show: unknown file ${name || "(missing)"}`); return; }
  print(`$ show ${name}`); print(files[name]);
}

async function runCommand(line) {
  const [command, argument] = line.trim().split(/\s+/, 2); if (!command) return;
  if (command === "help") {
    print(tp("$ help\ninspect           server record と 4 本の assertion を表示\nshow assertion.py  編集中の source を表示\ntest              公開テスト\nprepare           3 checkpoint の提出 source を作る\nreset             初期状態へ戻す\nclear             表示を消す"));
  } else if (command === "inspect") await inspect();
  else if (command === "test") await test();
  else if (command === "prepare") await prepare();
  else if (command === "reset") reset();
  else if (command === "show") show(argument);
  else if (command === "clear") output.textContent = "";
  else print(`command not found: ${command}. Run help.`);
}

async function withBusy(command, focus) {
  const buttons = document.querySelectorAll("button"); buttons.forEach((item) => { item.disabled = true; });
  try { await runCommand(command); }
  catch (error) { print(`${command}: ${error instanceof Error ? error.message : String(error)}`); }
  finally { buttons.forEach((item) => { item.disabled = false; }); focus?.focus(); }
}

async function boot() {
  try {
    starter = await request("/api/starter"); let restored = null;
    try { restored = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { restored = null; }
    assertionEditor.value = restored?.["assertion.py"] || starter["assertion.py"];
    assertionEditor.addEventListener("input", save);
    connectionStatus.textContent = "Workbench ready"; connectionStatus.classList.add("ready");
    print(tp("準備できました。まず inspect を実行してください (一覧は help)。"));
  } catch (error) { connectionStatus.textContent = "接続失敗"; print(`boot: ${error}`); }
}

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", () => void withBusy(button.dataset.command, button));
});
document.querySelector("#terminal-form").addEventListener("submit", (event) => {
  event.preventDefault(); const input = document.querySelector("#terminal-input"); const command = input.value;
  input.value = ""; void withBusy(command, input);
});
void boot();

/**
 * [#2877] このページは Portal と別オリジンなので Portal の locale を読めない。
 * 言語は ?lang= → このページで選んだ設定 → ブラウザの言語 → ja の順。
 *
 * 本文は HTML に日本語のまま置き、 英語表示のときだけテキストノードを差し替える。
 * 図 (<pre>) は改行が意味を持つので畳まずに照合する。
 */
const LANG_KEY = "tenkacloud.workbench.lang";
const I18N_SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA"]);
const originalText = new WeakMap();

function resolveLang() {
  const asked = new URLSearchParams(window.location.search).get("lang");
  if (asked === "ja" || asked === "en") return asked;
  const stored = window.localStorage.getItem(LANG_KEY);
  if (stored === "ja" || stored === "en") return stored;
  return (navigator.language || "ja").toLowerCase().startsWith("en") ? "en" : "ja";
}

let lang = resolveLang();

function i18nKey(node) {
  // 図 (<pre>) も畳んだ形で照合する。 差し替える English 側は改行を保ったまま入るので、
  // 図の形は English の値そのものが決める。
  return originalText.get(node).trim().replace(/\s+/g, " ");
}

/** print() 用。 英語表示なら TEXT_EN を引き、 無ければ日本語のまま出す。 */
function tp(japanese) {
  if (lang !== "en") return japanese;
  return TEXT_EN[japanese.trim().replace(/\s+/g, " ")] ?? japanese;
}

function i18nTextNodes() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement && !I18N_SKIP.has(node.parentElement.tagName) && node.textContent.trim()
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  return nodes;
}

function applyLang() {
  document.documentElement.lang = lang;
  for (const node of i18nTextNodes()) {
    if (!originalText.has(node)) originalText.set(node, node.textContent);
    const raw = originalText.get(node);
    if (lang === "ja") {
      node.textContent = raw;
      continue;
    }
    const translated = TEXT_EN[i18nKey(node)];
    // 前後の空白は元のまま残す。 レイアウトが空白に依存している箇所があるため。
    if (translated !== undefined) {
      const lead = raw.slice(0, raw.length - raw.trimStart().length);
      const tail = raw.slice(raw.trimEnd().length);
      node.textContent = lead + translated + tail;
    }
  }
  const title = TEXT_EN[document.title.trim().replace(/\s+/g, " ")];
  if (lang === "en" && title) document.title = title;
  if (lang === "ja" && originalTitle) document.title = originalTitle;
  const toggle = document.querySelector("#lang-toggle");
  if (toggle) toggle.textContent = lang === "ja" ? "English" : "\u65e5\u672c\u8a9e";
}

const originalTitle = document.title;

document.querySelector("#lang-toggle")?.addEventListener("click", () => {
  lang = lang === "ja" ? "en" : "ja";
  window.localStorage.setItem(LANG_KEY, lang);
  applyLang();
});

// 起動時と、 boot が本文を書き換えた後の両方で当てる。
applyLang();
document.addEventListener("tenkacloud:rendered", applyLang);
