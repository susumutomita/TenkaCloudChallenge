"use strict";

/**
 * [#2877] このページは Portal とは別オリジンで動くので、 Portal の locale 設定
 * (localStorage) は読めない。 言語は ?lang= → このページで選んだ設定 → ブラウザの言語
 * → ja の順で決め、 右上のトグルで切り替える。
 *
 * 文言は data-i18n 属性 (HTML) と t() (実行時) の 2 経路。 どちらも同じ辞書を引く。
 */
const STRINGS = {
  ja: {
    loading: "問題を読み込んでいます。",
    connecting: "接続確認中",
    ready: "Workbench 準備完了",
    connectFailed: "接続失敗",
    runInspect: "inspect を実行",
    inspectLead: "deploy ごとに変わる fixture と、問題を解くために公開された証拠を確認します。",
    inspectEmpty: "inspect を実行してください。",
    editStarter: "starter を編集",
    editLead: "各タブのソースを修正します。内容はこのブラウザに自動保存されます。",
    runTests: "公開テスト",
    reset: "初期状態へ戻す",
    manualHeading: "直接回答を組み立てる",
    manualLead:
      "コード以外の checkpoint は、inspect と実験結果から回答します。JSON を求める欄は JSON のまま入力してください。prepare は回答を deploy 固有の提出値へ変換します。",
    prepareHeading: "Portal 提出値を作る",
    prepareLead: "生成された各値を Participant Portal の同名 checkpoint へコピーします。",
    noSubmissions: "まだ提出値は作られていません。",
    consoleHeading: "安全なコマンド",
    consoleLead: "一般シェルではありません。この問題に必要な操作だけを実行します。",
    run: "実行",
    answerPlaceholder: "回答。object / array / number は JSON で入力",
    copy: "コピー",
    copied: "コピーしました",
    copyFailed: "手動で選択してください",
    resetDone: "初期状態へ戻しました。",
    bootReady: "Browser Workbench の準備ができました。help か inspect を実行してください。",
    langToggle: "English",
    helpInspect: "inspect       deploy 固有の証拠を表示",
    helpFiles: "files         編集対象を表示",
    helpShow: "show <file>   現在のソースを表示",
    helpTest: "test          公開テストを実行",
    helpPrepare: "prepare       Portal 提出値を生成",
    helpReset: "reset         starter と回答欄を初期化",
    helpClear: "clear         console を消去",
  },
  en: {
    loading: "Loading the problem.",
    connecting: "Connecting",
    ready: "Workbench ready",
    connectFailed: "Connection failed",
    runInspect: "Run inspect",
    inspectLead:
      "Shows the fixtures this deploy was given, and the evidence published for solving it.",
    inspectEmpty: "Run inspect to see it.",
    editStarter: "Edit the starter",
    editLead: "Edit the source in each tab. Your changes are saved in this browser automatically.",
    runTests: "Public tests",
    reset: "Back to the starter",
    manualHeading: "Write the answers by hand",
    manualLead:
      "Checkpoints that are not code are answered from inspect and from what your experiment showed. A field that asks for JSON takes JSON. prepare turns your answers into the values this deploy expects.",
    prepareHeading: "Build the Portal values",
    prepareLead: "Copy each generated value into the checkpoint of the same name in the Portal.",
    noSubmissions: "No values have been built yet.",
    consoleHeading: "Safe commands",
    consoleLead: "This is not a general shell. It runs only what this problem needs.",
    run: "Run",
    answerPlaceholder: "Your answer. Use JSON for an object, array, or number",
    copy: "Copy",
    copied: "Copied",
    copyFailed: "Select it by hand",
    resetDone: "Back to the starter.",
    bootReady: "Browser Workbench ready. Run help or inspect.",
    langToggle: "\u65e5\u672c\u8a9e",
    helpInspect: "inspect       show what this deploy was given",
    helpFiles: "files         list the files you edit",
    helpShow: "show <file>   print the current source",
    helpTest: "test          run the public tests",
    helpPrepare: "prepare       build the Portal values",
    helpReset: "reset         restore the starter and clear your answers",
    helpClear: "clear         clear the console",
  },
};

const LANG_KEY = "tenkacloud.workbench.lang";

function resolveLang() {
  const asked = new URLSearchParams(window.location.search).get("lang");
  if (asked === "ja" || asked === "en") return asked;
  const stored = window.localStorage.getItem(LANG_KEY);
  if (stored === "ja" || stored === "en") return stored;
  return (navigator.language || "ja").toLowerCase().startsWith("en") ? "en" : "ja";
}

let lang = resolveLang();

/** Container-served problem text for the current language, falling back to Japanese. */
function localizedConfig() {
  if (!config) return { name: "", description: "", labels: {} };
  const en = lang === "en" ? config.i18n?.en : undefined;
  return {
    name: en?.name || config.name,
    description: en?.description || config.description,
    labels: en?.checkpointLabels || {},
  };
}

function checkpointLabel(checkpoint) {
  return localizedConfig().labels[checkpoint.id] || checkpoint.label;
}

function t(key) {
  return STRINGS[lang][key] ?? STRINGS.ja[key] ?? key;
}

/** Problem name / description, in the current language. Re-run when the language flips. */
function applyProblemText() {
  if (!config) return;
  const { name, description } = localizedConfig();
  document.title = `${name} — Browser Workbench`;
  document.querySelector("#problem-name").textContent = name;
  const lead = document.querySelector("#problem-description");
  lead.textContent = description;
  // 読み込み中の文言に戻されないよう、 一度中身が入ったら静的辞書の対象から外す。
  lead.removeAttribute("data-i18n");
}

/** Checkpoint headings carry container-served labels, so they follow the language too. */
function rebuildManualLabels() {
  if (!config) return;
  for (const checkpoint of config.checkpoints) {
    const heading = manualFieldsRoot.querySelector(`[data-checkpoint="${checkpoint.id}"]`);
    if (heading) heading.textContent = `${checkpoint.id} — ${checkpointLabel(checkpoint)}`;
  }
}

/** Re-render every static string. Runtime text re-reads t() the next time it prints. */
function applyLang() {
  document.documentElement.lang = lang;
  for (const node of document.querySelectorAll("[data-i18n]")) {
    const value = STRINGS[lang][node.dataset.i18n];
    if (value !== undefined) node.textContent = value;
  }
  const toggle = document.querySelector("#lang-toggle");
  if (toggle) toggle.textContent = t("langToggle");
  for (const field of manualFieldsRoot.querySelectorAll("textarea")) {
    field.placeholder = t("answerPlaceholder");
  }
}

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
    heading.textContent = `${checkpoint.id} — ${checkpointLabel(checkpoint)}`;
    heading.dataset.checkpoint = checkpoint.id;
    const field = document.createElement("textarea");
    field.rows = 5;
    field.placeholder = t("answerPlaceholder");
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
    button.textContent = t("copy");
    button.addEventListener("click", async () => {
      button.textContent = (await copyText(value)) ? t("copied") : t("copyFailed");
      setTimeout(() => { button.textContent = t("copy"); }, 1500);
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
  submissionOutput.innerHTML = `<p class="empty">${t("resetDone")}</p>`;
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
      print(t("helpInspect"));
      print(t("helpFiles"));
      print(t("helpShow"));
      print(t("helpTest"));
      print(t("helpPrepare"));
      print(t("helpReset"));
      print(t("helpClear"));
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
    applyProblemText();
    buildEditors(restored);
    buildManualFields(restored);
    connectionStatus.textContent = t("ready");
    connectionStatus.classList.add("ready");
    print(t("bootReady"));
  } catch (error) {
    connectionStatus.textContent = t("connectFailed");
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

document.querySelector("#lang-toggle").addEventListener("click", () => {
  lang = lang === "ja" ? "en" : "ja";
  window.localStorage.setItem(LANG_KEY, lang);
  applyLang();
  applyProblemText();
  rebuildManualLabels();
});

applyLang();
