"use strict";

const TEXT_EN = {
  "a*w + b == c (mod p) かつ lo <= w <= hi": "a*w + b == c (mod p) and lo <= w <= hi",
  "inspect               seeded statementとverifierの検査内容を表示": "inspect               show the seeded statement and what each verifier checks",
  "show classify.py      現在の分類コードを表示": "show classify.py      print your current classification code",
  "show counterexamples.py  現在の反例コードを表示": "show counterexamples.py  print your current counterexample code",
  "test                  公開shape testを実行": "test                  run the public shape tests",
  "prepare               Portal提出用の5つの値を生成": "prepare               build the five values you submit in the Portal",
  "reset                 2ファイルをstarterへ戻す": "reset                 put both files back to the starter",
  "clear                 console出力を消去": "clear                 clear the console",
  "満たす性質、破る性質 — Browser Workbench": "Properties it keeps, properties it breaks — Browser Workbench",
  "満たす性質、破る性質": "Properties it keeps, properties it breaks",
  "3つのtoy verifierを観察し、反例を作って分類します。この画面だけで": "Look at three toy verifiers, build counterexamples, and classify them. This page alone covers",
  "、Python編集、公開テスト、提出データ作成まで完結します。": ", editing the Python, the public tests, and building what you submit.",
  "接続確認中": "Connecting",
  "まず、3つの性質を区別する": "First, tell the three properties apart",
  "verifierは「正しいか」だけで評価しません。正しい入力を通すこと、偽物を通さないこと、 秘密を漏らさないことは別々の約束です。": "A verifier is not judged by \"is it correct\" alone. Letting a genuine input through, refusing a fake one, and leaking no secret are three separate promises.",
  "正しい人を、間違って拒否していないか？": "Is it wrongly rejecting an honest party?",
  "主張を満たす正直なwitnessなら、必ずacceptされる性質です。": "The property that an honest witness satisfying the statement is always accepted.",
  "偽物を、間違って受理していないか？": "Is it wrongly accepting a fake?",
  "主張を満たさないwitnessをacceptできない性質です。": "The property that a witness which does not satisfy the statement cannot be accepted.",
  "判定の途中で、秘密を漏らしていないか？": "Is it leaking the secret while it decides?",
  "公開されたtranscriptだけでは秘密のwitnessを復元できない性質です。": "The property that the published transcript alone does not let you recover the secret witness.",
  "今回の主張": "The statement here",
  "自分のinstanceを観察する": "Look at your own instance",
  "inspectを実行": "Run inspect",
  "statement、各verifierが実際に確認する項目、privacyを破るverifierの公開transcriptを表示します。 値を眺めるだけでなく「何を検査していないか」に注目してください。": "It prints the statement, what each verifier actually checks, and the published transcript of the verifier that breaks privacy. Do not just read the values — look for what is never checked.",
  "inspectを実行してください。": "Run inspect to see it.",
  "分類と反例をPythonで書く": "Write the classification and the counterexamples in Python",
  "にした性質には、実際にその失敗を起こす値が必要です。編集内容はこのブラウザに 自動保存されます。": "needs an actual value that causes that failure. What you write is saved in this browser automatically.",
  "公開テストを実行": "Run the public tests",
  "提出データを作る": "Build what you submit",
  "初期状態へ戻す": "Back to the start",
  "コマンドコンソール": "Command console",
  "一般シェルではなく、この問題に必要な安全なコマンドだけを実行します。": "Not a general shell — it runs only the safe commands this problem needs.",
  "で一覧を表示できます。": "lists them.",
  "コマンド": "command",
  "実行": "Run",
  "Portalへ提出する": "Submit in the Portal",
  "「提出データを作る」を押すと、現在のPythonを実行して5つの提出値を整形します。各値をコピーし、 Participant Portalの同名チェックポイントへ貼り付けてください。公開テスト成功は正解を保証しません。": "\"Build what you submit\" runs your current Python and formats the five values. Copy each one into the checkpoint of the same name in the Participant Portal. Passing the public tests does not mean the answer is right.",
  "まだ提出データは作られていません。": "Nothing has been built yet."
};

const STORAGE_KEY = "tenkacloud.ac26-bridge-properties.sources.v1";
const output = document.querySelector("#terminal-output");
const inspectOutput = document.querySelector("#inspect-output");
const submissionOutput = document.querySelector("#submission-output");
const classifyEditor = document.querySelector("#classify-editor");
const counterexamplesEditor = document.querySelector("#counterexamples-editor");
const connectionStatus = document.querySelector("#connection-status");

let starter = null;

function sources() {
  return {
    "classify.py": classifyEditor.value,
    "counterexamples.py": counterexamplesEditor.value,
  };
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
    "== 3つの性質 ==",
    ...Object.entries(payload.definitions).map(([name, definition]) => `  ${name}: ${definition}`),
    "",
    "== claim ==",
    `  ${payload.claim}`,
    "",
    "== statement ==",
    `  ${JSON.stringify(payload.statement)}`,
    "",
    "== verifierが検査する項目 ==",
    ...Object.entries(payload.verifiers).map(([name, checked]) =>
      `  ${name}: ${checked.join(", ")}`,
    ),
    "",
    `== observerから見える${payload.privacyProtocol} transcript ==`,
    `  ${JSON.stringify(payload.transcript)}`,
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
  print("prepare: 5 portal submissions are ready");
  document.querySelector("#submit-title").scrollIntoView({ behavior: "smooth" });
}

function reset() {
  if (!starter) return;
  classifyEditor.value = starter["classify.py"];
  counterexamplesEditor.value = starter["counterexamples.py"];
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
      print(tp("inspect               seeded statementとverifierの検査内容を表示"));
      print(tp("show classify.py      現在の分類コードを表示"));
      print(tp("show counterexamples.py  現在の反例コードを表示"));
      print(tp("test                  公開shape testを実行"));
      print(tp("prepare               Portal提出用の5つの値を生成"));
      print(tp("reset                 2ファイルをstarterへ戻す"));
      print(tp("clear                 console出力を消去"));
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
    classifyEditor.value = restored?.["classify.py"] || starter["classify.py"];
    counterexamplesEditor.value =
      restored?.["counterexamples.py"] || starter["counterexamples.py"];
    classifyEditor.addEventListener("input", save);
    counterexamplesEditor.addEventListener("input", save);
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
