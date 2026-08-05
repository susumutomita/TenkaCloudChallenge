"use strict";

const TEXT_EN = {
  "witnessがcircuitを満たす ⇔ すべてのconstraintのresidualが0": "the witness satisfies the circuit ⇔ every constraint has residual 0",
  "inspect            field、circuit、正しいwitness、壊れたwitnessを表示": "inspect            show the field, the circuit, and both the correct and broken witness",
  "show field.py      現在のfield演算コードを表示": "show field.py      print your current field arithmetic",
  "show circuit.py    現在のresidual/traceコードを表示": "show circuit.py    print your current residual / trace code",
  "show gadgets.py    現在のgadgetコードを表示": "show gadgets.py    print your current gadget code",
  "test               公開shape testを実行": "test               run the public shape tests",
  "prepare            4つのcode checkpointの提出JSONを生成": "prepare            build the submission JSON for the four code checkpoints",
  "reset              3ファイルをstarterへ戻す": "reset              put all three files back to the starter",
  "clear              console出力を消去": "clear              clear the console",
  "壊れた場所を言えるか — Browser Workbench": "Can you say where it broke — Browser Workbench",
  "壊れた場所を言えるか": "Can you say where it broke",
  "算術回路の監査ツールを完成させます。この画面だけで": "You finish an audit tool for an arithmetic circuit. This page alone covers",
  "、 3ファイルのPython編集、公開テスト、提出データ作成まで完結します。 first-brokenの答えだけは、traceを読んだあなたがJSONで組み立てます。": ", editing three Python files, the public tests, and building what you submit. Only the first-broken answer is yours to assemble as JSON, after reading the trace.",
  "接続確認中": "Connecting",
  "まず、residualという言葉を持つ": "First, get hold of the word residual",
  "constraintは「この式は0に等しい」という主張です。witnessを入れて評価した値が residualで、0なら満たされ、それ以外なら壊れています。monitorのpass/failでは 見えない「どこが壊れたか」を、traceが言えるようにします。": "A constraint is the claim \"this expression equals 0\". Put the witness in, evaluate, and the value you get is the residual: 0 means the constraint holds, anything else means it is broken. A pass/fail monitor cannot say where it broke; the trace can.",
  "各constraintは、いくつ外れているか？": "By how much is each constraint off?",
  "F_p上でresidualを計算し、circuit順のtraceを出します。負数の正規化が急所です。": "Compute the residual over F_p and print the trace in circuit order. Normalising negative numbers is the sharp edge.",
  "最初に破れたのは、どのconstraintか？": "Which constraint broke first?",
  "最初にresidualが0でないconstraintのidと、そのresidualをJSONで提出します。": "Submit, as JSON, the id of the first constraint whose residual is not 0, together with that residual.",
  "gadgetは、狙った集合だけを許すか？": "Does the gadget allow only the set you meant?",
  "signalを0か1だけに、または許可された値だけに縛るconstraintを組みます。": "Build constraints that pin a signal to 0 or 1 only, or to the allowed values only.",
  "不変条件": "The invariant",
  "自分のfield、circuit、witnessを観察する": "Look at your own field, circuit, and witness",
  "inspectを実行": "Run inspect",
  "自分のfield、circuit、正しいwitnessと壊れたwitnessを表示します。正しいwitnessの residualがすべて0になることを、走らせる前に確認してください。": "It prints your field, your circuit, and both a correct and a broken witness. Check by hand, before running anything, that the correct witness gives residual 0 everywhere.",
  "inspectを実行してください。": "Run inspect to see it.",
  "3つのファイルをPythonで書く": "Write the three files in Python",
  "はF_pの演算、": "is the arithmetic over F_p,",
  "はresidualとtrace、": "is the residual and the trace,",
  "は条件を制約へ変換します。編集内容はこのブラウザに自動保存されます。": "turns a condition into constraints. What you write is saved in this browser automatically.",
  "公開テストを実行": "Run the public tests",
  "提出データを作る": "Build what you submit",
  "初期状態へ戻す": "Back to the start",
  "コマンドコンソール": "Command console",
  "一般シェルではなく、この問題に必要な安全なコマンドだけを実行します。": "Not a general shell — it runs only the safe commands this problem needs.",
  "で一覧を表示できます。": "lists them.",
  "コマンド": "command",
  "実行": "Run",
  "Portalへ提出する": "Submit in the Portal",
  "「提出データを作る」は現在の3ファイルをJSONに整形し、residuals / boolean / membership / transferの4欄に貼る値を作ります。first-brokenは壊れたwitnessの traceを自分で読み、": "\"Build what you submit\" formats your current three files as JSON and produces the values for the residuals / boolean / membership / transfer boxes. For first-broken, read the trace of the broken witness yourself and type",
  "の形で Portalへ直接入力してください。 公開テスト成功は正解を保証しません。": "straight into the Portal. Passing the public tests does not mean the answer is right.",
  "まだ提出データは作られていません。": "Nothing has been built yet."
};

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
    hint: '壊れたwitnessのtraceを読み、最初にresidualが0でない行を {"constraintId":"...","residual":...} のJSONでPortalへ入力します。',
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
    '  最初にresidualが0でない行を {"constraintId":"...","residual":...} で提出します。',
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
      print(tp("inspect            field、circuit、正しいwitness、壊れたwitnessを表示"));
      print(tp("show field.py      現在のfield演算コードを表示"));
      print(tp("show circuit.py    現在のresidual/traceコードを表示"));
      print(tp("show gadgets.py    現在のgadgetコードを表示"));
      print(tp("test               公開shape testを実行"));
      print(tp("prepare            4つのcode checkpointの提出JSONを生成"));
      print(tp("reset              3ファイルをstarterへ戻す"));
      print(tp("clear              console出力を消去"));
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
