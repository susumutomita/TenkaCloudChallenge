"use strict";

const terminalOutput = document.querySelector("#terminal-output");
const inspectOutput = document.querySelector("#inspect-output");
const submissionOutput = document.querySelector("#submission-output");
const editorsRoot = document.querySelector("#editors");
const manualPanel = document.querySelector("#manual-panel");
const manualFieldsRoot = document.querySelector("#manual-fields");
const connectionStatus = document.querySelector("#connection-status");

let config = null;
let starter = null;
let storageKey = null;
const editors = new Map();
const manualFields = new Map();

function print(message = "") {
  terminalOutput.textContent += `${message}\n`;
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

async function request(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function currentFiles() {
  return Object.fromEntries([...editors].map(([name, editor]) => [name, editor.value]));
}

function currentManual() {
  return Object.fromEntries([...manualFields].map(([id, field]) => [id, field.value]));
}

function save() {
  if (!storageKey) return;
  localStorage.setItem(storageKey, JSON.stringify({ files: currentFiles(), manual: currentManual() }));
}

function restoredState() {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) || {};
  } catch {
    return {};
  }
}

function buildEditors(restored) {
  editorsRoot.replaceChildren();
  editors.clear();
  for (const name of config.submittedFiles) {
    const label = document.createElement("label");
    label.className = "editor-card";
    const heading = document.createElement("span");
    heading.textContent = name;
    const editor = document.createElement("textarea");
    editor.spellcheck = false;
    editor.setAttribute("aria-label", `${name} editor`);
    editor.value = restored?.files?.[name] || starter[name];
    editor.addEventListener("input", save);
    label.append(heading, editor);
    editorsRoot.append(label);
    editors.set(name, editor);
  }
}

function buildManualFields(restored) {
  manualFieldsRoot.replaceChildren();
  manualFields.clear();
  const manual = config.checkpoints.filter((checkpoint) => checkpoint.kind === "answer");
  manualPanel.hidden = manual.length === 0;
  for (const checkpoint of manual) {
    const label = document.createElement("label");
    label.className = "manual-card";
    const heading = document.createElement("span");
    heading.textContent = `${checkpoint.id} — ${checkpoint.label}`;
    const field = document.createElement("textarea");
    field.rows = 5;
    field.placeholder = "回答。object / array / number は JSON で入力";
    field.value = restored?.manual?.[checkpoint.id] || "";
    field.addEventListener("input", save);
    label.append(heading, field);
    manualFieldsRoot.append(label);
    manualFields.set(checkpoint.id, field);
  }
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = value;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.append(fallback);
    fallback.select();
    const copied = document.execCommand("copy");
    fallback.remove();
    return copied;
  }
}

async function inspect() {
  print("$ inspect");
  const payload = await request("/api/inspect");
  inspectOutput.textContent = payload.output;
  print("inspect: evidence updated");
}

async function test() {
  print("$ test");
  const result = await request("/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ files: currentFiles() }),
  });
  print(result.output.trimEnd());
  print(result.passed ? "test: passed" : "test: failed");
}

function renderSubmissions(submissions) {
  submissionOutput.replaceChildren();
  for (const checkpoint of config.checkpoints) {
    const value = String(submissions[checkpoint.id] ?? "");
    const card = document.createElement("article");
    card.className = "submission-card";
    const title = document.createElement("h3");
    title.textContent = `${checkpoint.id} — ${checkpoint.label}`;
    const pre = document.createElement("pre");
    pre.textContent = value;
    pre.tabIndex = 0;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "コピー";
    button.addEventListener("click", async () => {
      button.textContent = (await copyText(value)) ? "コピーしました" : "手動で選択してください";
      setTimeout(() => { button.textContent = "コピー"; }, 1500);
    });
    card.append(title, pre, button);
    submissionOutput.append(card);
  }
}

async function prepare() {
  print("$ prepare");
  const result = await request("/api/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ files: currentFiles(), manual: currentManual() }),
  });
  if (!result.ok) {
    print(result.output || "prepare: failed");
    for (const checkpoint of result.missingManual || []) {
      manualFields.get(checkpoint)?.focus();
      break;
    }
    return;
  }
  renderSubmissions(result.submissions);
  print(`prepare: ${Object.keys(result.submissions).length} portal submissions are ready`);
  submissionOutput.scrollIntoView({ behavior: "smooth", block: "start" });
}

function reset() {
  for (const [name, editor] of editors) editor.value = starter[name];
  for (const field of manualFields.values()) field.value = "";
  save();
  submissionOutput.innerHTML = '<p class="empty">初期状態へ戻しました。</p>';
  print("$ reset");
  print("reset: starter restored");
}

function show(name) {
  const editor = editors.get(name);
  print(`$ show ${name || ""}`);
  print(editor ? editor.value : `show: unknown file ${name || "(missing)"}`);
}

async function runCommand(commandLine) {
  const [command, argument] = commandLine.trim().split(/\s+/, 2);
  if (!command) return;
  switch (command) {
    case "help":
      print("$ help");
      print("inspect       deploy 固有の証拠を表示");
      print("files         編集対象を表示");
      print("show <file>   現在のソースを表示");
      print("test          公開テストを実行");
      print("prepare       Portal 提出値を生成");
      print("reset         starter と回答欄を初期化");
      print("clear         console を消去");
      break;
    case "inspect": await inspect(); break;
    case "test": await test(); break;
    case "prepare": await prepare(); break;
    case "reset": reset(); break;
    case "files": print(`$ files\n${config.submittedFiles.join("\n")}`); break;
    case "show": show(argument); break;
    case "clear": terminalOutput.textContent = ""; break;
    default: print(`command not found: ${command}. Run help.`);
  }
}

async function withBusy(command, focusTarget) {
  const buttons = document.querySelectorAll("button");
  buttons.forEach((button) => { button.disabled = true; });
  try {
    await runCommand(command);
  } catch (error) {
    print(`${command}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
    focusTarget?.focus();
  }
}

async function boot() {
  try {
    [config, starter] = await Promise.all([request("/api/config"), request("/api/starter")]);
    storageKey = `tenkacloud.${config.id}.workbench.v1`;
    const restored = restoredState();
    document.title = `${config.name} — Browser Workbench`;
    document.querySelector("#problem-name").textContent = config.name;
    document.querySelector("#problem-description").textContent = config.description;
    buildEditors(restored);
    buildManualFields(restored);
    connectionStatus.textContent = "Workbench ready";
    connectionStatus.classList.add("ready");
    print("Browser Workbench ready. Run help or inspect.");
  } catch (error) {
    connectionStatus.textContent = "接続失敗";
    print(`boot: ${error instanceof Error ? error.message : String(error)}`);
  }
}

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", () => void withBusy(button.dataset.command, button));
});

document.querySelector("#terminal-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector("#terminal-input");
  const command = input.value;
  input.value = "";
  void withBusy(command, input);
});

void boot();
