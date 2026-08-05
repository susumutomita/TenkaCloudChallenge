"use strict";

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
    print("$ help\ninspect           server record と 4 本の assertion を表示\nshow assertion.py  編集中の source を表示\ntest              公開テスト\nprepare           3 checkpoint の提出 source を作る\nreset             初期状態へ戻す\nclear             表示を消す");
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
    print("準備できました。まず inspect を実行してください (一覧は help)。");
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
