"use strict";

const STORAGE_KEY = "tenkacloud.ac26-w1-constraint-lab.sources.v1";
const FILE_NAMES = ["field.py", "circuit.py", "gadgets.py"];
const output = document.querySelector("#terminal-output");
const inspectOutput = document.querySelector("#inspect-output");
const submissionOutput = document.querySelector("#submission-output");
const editors = {
  "field.py": document.querySelector("#field-editor"),
  "circuit.py": document.querySelector("#circuit-editor"),
  "gadgets.py": document.querySelector("#gadgets-editor"),
};
const connectionStatus = document.querySelector("#connection-status");

// The checkpoint the workbench must not produce, and where its value comes from
// instead. Rendered next to the prepared cards so the portal journey stays
// complete on one screen.
const MANUAL_CHECKPOINTS = [
  {
    id: "first-broken",
    hint: "壊れたwitnessのtraceを読み、最初にresidualが0でないconstraintのidを、Portalのfirst-broken欄へ直接入力します。",
  },
];

let starter = null;

function sources() {
  const files = {};
  for (const name of FILE_NAMES) files[name] = editors[name].value;
  return files;
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sources()));
}

function print(message = "") {
  output.textContent += `${message}\n`;
  output.scrollTop = output.scrollHeight;
}

async function request(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    // Clipboard permission can be denied even on loopback. Keep the browser-only
    // journey usable with the older, user-gesture-based copy path.
  }
  const fallback = document.createElement("textarea");
  fallback.value = value;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.opacity = "0";
  document.body.append(fallback);
  fallback.select();
  const copied = document.execCommand("copy");
  fallback.remove();
  if (!copied) throw new Error("clipboard copy was refused");
}

async function inspect() {
  print("$ inspect");
  const payload = await request("/api/inspect");
  const lines = [
    "== field ==",
    `  p = ${payload.field.p}`,
    `  membership gadgetのallowed set: ${JSON.stringify(payload.field.allowedSet)}`,
    "",
    "== circuit ==",
    ...payload.circuit.map((constraint) => `  ${JSON.stringify(constraint)}`),
    "",
    "== 正しいwitness ==",
    `  ${JSON.stringify(payload.honestWitness)}`,
    "  すべてのresidualが0になるはずです。走らせる前にそれを確認してください。",
    "",
    "== 壊れたwitness (checkpoint: first-broken) ==",
    `  ${JSON.stringify(payload.brokenWitness)}`,
    "  ちょうど1つのconstraintが最初に違反されます。そのidを提出します。",
    "",
    `health token: ${payload.healthToken}`,
  ];
  inspectOutput.textContent = lines.join("\n");
  print("inspect: evidence updated");
}

async function test() {
  print("$ test");
  const result = await request("/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ files: sources() }),
  });
  print(result.output.trimEnd());
  print(result.passed ? "test: public shape checks passed" : "test: failed");
}

function renderSubmissions(submissions) {
  submissionOutput.replaceChildren();
  for (const [checkpoint, rawValue] of Object.entries(submissions)) {
    const value = String(rawValue);
    const card = document.createElement("article");
    card.className = "submission-card";
    const title = document.createElement("h3");
    title.textContent = checkpoint;
    const pre = document.createElement("pre");
    pre.textContent = value;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "コピー";
    button.addEventListener("click", async () => {
      try {
        await copyText(value);
        button.textContent = "コピーしました";
      } catch {
        button.textContent = "手動で選択してください";
        pre.focus();
      }
      setTimeout(() => {
        button.textContent = "コピー";
      }, 1500);
    });
    pre.tabIndex = 0;
    card.append(title, pre, button);
    submissionOutput.append(card);
  }
  for (const manual of MANUAL_CHECKPOINTS) {
    const card = document.createElement("article");
    card.className = "submission-card";
    const title = document.createElement("h3");
    title.textContent = `${manual.id} (手入力)`;
    const note = document.createElement("p");
    note.className = "empty";
    note.textContent = manual.hint;
    card.append(title, note);
    submissionOutput.append(card);
  }
}

async function prepare() {
  print("$ prepare");
  const result = await request("/api/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ files: sources() }),
  });
  if (!result.ok) {
    print(result.output || "prepare: failed");
    return;
  }
  renderSubmissions(result.submissions);
  print("prepare: 4 portal submissions are ready; first-broken stays yours");
  document.querySelector("#submit-title").scrollIntoView({ behavior: "smooth" });
}

function reset() {
  if (!starter) return;
  for (const name of FILE_NAMES) editors[name].value = starter[name];
  save();
  submissionOutput.innerHTML = '<p class="empty">初期状態へ戻しました。</p>';
  print("$ reset");
  print("reset: starter restored");
}

function show(name) {
  const files = sources();
  if (!(name in files)) {
    print(`show: unknown file ${name || "(missing)"}`);
    return;
  }
  print(`$ show ${name}`);
  print(files[name]);
}

async function runCommand(commandLine) {
  const [command, argument] = commandLine.trim().split(/\s+/, 2);
  if (!command) return;
  switch (command) {
    case "help":
      print("$ help");
      print("inspect            field、circuit、正しいwitness、壊れたwitnessを表示");
      print("show field.py      現在のfield演算コードを表示");
      print("show circuit.py    現在のresidual/traceコードを表示");
      print("show gadgets.py    現在のgadgetコードを表示");
      print("test               公開shape testを実行");
      print("prepare            4つのcode checkpointの提出JSONを生成");
      print("reset              3ファイルをstarterへ戻す");
      print("clear              console出力を消去");
      break;
    case "inspect":
      await inspect();
      break;
    case "test":
      await test();
      break;
    case "prepare":
      await prepare();
      break;
    case "reset":
      reset();
      break;
    case "show":
      show(argument);
      break;
    case "clear":
      output.textContent = "";
      break;
    default:
      print(`command not found: ${command}. Run help.`);
  }
}

async function withBusy(command, button) {
  const buttons = document.querySelectorAll("button");
  buttons.forEach((item) => {
    item.disabled = true;
  });
  try {
    await runCommand(command);
  } catch (error) {
    print(`${command}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    buttons.forEach((item) => {
      item.disabled = false;
    });
    button?.focus();
  }
}

async function boot() {
  try {
    starter = await request("/api/starter");
    let restored = null;
    try {
      restored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      restored = null;
    }
    for (const name of FILE_NAMES) {
      editors[name].value = restored?.[name] || starter[name];
      editors[name].addEventListener("input", save);
    }
    connectionStatus.textContent = "Workbench ready";
    connectionStatus.classList.add("ready");
    print("Browser workbench ready. Run help or inspect.");
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
