"use strict";

const TEXT_EN = {
  "inspect         ポリシー、deploy済み回路、正常なwitness 2種類を表示": "inspect         show the policy, the deployed circuit, and the two working witnesses",
  "show policy.py  現在のコードを表示": "show policy.py  print your current code",
  "test            公開shape testを実行": "test            run the public shape tests",
  "prepare         5つのcode checkpointの提出値を生成": "prepare         build the values for the five code checkpoints",
  "reset           policy.pyをstarterへ戻す": "reset           put policy.py back to the starter",
  "clear           console出力を消去": "clear           clear the console",
  "通るのに、守れていない — Browser Workbench": "It passes, and still fails to hold — Browser Workbench",
  "通るのに、守れていない": "It passes, and still fails to hold",
  "資格確認回路の監査です。この画面だけで": "An audit of an eligibility circuit. This page alone covers",
  "の編集、 公開テスト、提出データ作成まで完結します。root-causeの診断だけは、 あなたの audit と反例から組み立てます。": "editing, the public tests, and building what you submit. Only the root-cause diagnosis is yours to assemble, from your own audit and counterexample.",
  "接続確認中": "Connecting",
  "まず、underconstraintを知る": "First, meet underconstraint",
  "回路に比較はありません。「このsignalは0か」は、proverが供給する補助signal": "A circuit has no comparison. \"Is this signal 0\" is expressed by two constraints that use an auxiliary signal",
  "を使った2本の制約で表します。片方だけでは、それぞれ別の嘘が通ります。 deploy済み回路はどちらか一方を欠いており、どちらが欠けるかはseedで変わります。": "supplied by the prover. With only one of the two, a different lie gets through in each case. The deployed circuit is missing one of them, and which one changes with the seed.",
  "本来の回路と、何が違うか？": "How does it differ from the circuit it should be?",
  "ポリシーどおりの回路を組み、deploy済み回路に欠けている制約をちょうど特定します。": "Build the circuit the policy calls for, and name exactly the constraint the deployed circuit is missing.",
  "欠落は、実際に突けるか？": "Can the gap actually be exploited?",
  "deploy済み回路を充足し、intended回路を充足しないwitnessを作ります。反例が主張を支えます。": "Produce a witness that satisfies the deployed circuit and not the intended one. The counterexample is what backs the claim.",
  "最小限で、塞げるか？": "Can you close it with the minimum?",
  "原因を構造化して提出し、正常系2ケースを壊さずに欠落を塞ぎます。全部盛りは修復ではありません。": "Submit the cause in structured form and close the gap without breaking the two working cases. Throwing everything at it is not a repair.",
  "deploy済み回路を観察する": "Look at the deployed circuit",
  "inspectを実行": "Run inspect",
  "ポリシー、deploy済みの回路、正常なwitness2種類を表示します。回路には、ポリシーが 必要とする制約が1本足りません。どの嘘を防ぐ制約が無いのかに注目してください。": "It prints the policy, the deployed circuit, and two witnesses that should work. The circuit is missing one constraint the policy requires. Look for which lie is no longer prevented.",
  "inspectを実行してください。": "Run inspect to see it.",
  "policy.pyの4つの関数を書く": "Write the four functions in policy.py",
  "順に「本来の回路を組む」「欠落を特定する」「反例を作る」「最小限で直す」に対応します。 編集内容はこのブラウザに自動保存されます。公開テストはstarterのままでも通ります — それがこの問題の主張です。": "In order: build the intended circuit, identify the gap, produce the counterexample, repair with the minimum. What you write is saved in this browser automatically. The public tests pass on the untouched starter — that is this problem's point.",
  "公開テストを実行": "Run the public tests",
  "提出データを作る": "Build what you submit",
  "初期状態へ戻す": "Back to the start",
  "コマンドコンソール": "Command console",
  "一般シェルではなく、この問題に必要な安全なコマンドだけを実行します。": "Not a general shell — it runs only the safe commands this problem needs.",
  "で一覧を表示できます。": "lists them.",
  "コマンド": "command",
  "実行": "Run",
  "Portalへ提出する": "Submit in the Portal",
  "「提出データを作る」は現在の": "\"Build what you submit\" takes your current",
  "を、build / audit / exploit / repair / mutation-transferの5欄に貼る値として整形します。root-causeは": "and formats it for the build / audit / exploit / repair / mutation-transfer boxes. For root-cause, assemble JSON of the form",
  "の形のJSONを自分で組み立て、 Portalへ直接入力してください。欠けた制約のidはあなたのauditが、変更前後の値は正常な witnessと反例の比較が教えてくれます。": "yourself and type it straight into the Portal. Your audit gives you the id of the missing constraint; comparing the working witness with your counterexample gives you the before and after values.",
  "まだ提出データは作られていません。": "Nothing has been built yet."
};

const STORAGE_KEY = "tenkacloud.ac26-w1-underconstraint.sources.v1";
const output = document.querySelector("#terminal-output");
const inspectOutput = document.querySelector("#inspect-output");
const submissionOutput = document.querySelector("#submission-output");
const policyEditor = document.querySelector("#policy-editor");
const connectionStatus = document.querySelector("#connection-status");

// The checkpoint the workbench must not produce, and where its value comes from
// instead. Rendered next to the prepared cards so the portal journey stays
// complete on one screen.
const MANUAL_CHECKPOINTS = [
  {
    id: "root-cause",
    hint: '{"missingConstraintId":"...","manipulatedSignals":[{"signal":"...","before":1,"after":0}]} の形のJSONを自分で組み立てます。欠けたidはauditが、変更前後の値は正常なwitnessと反例の比較が教えてくれます。',
  },
];

let starter = null;

function sources() {
  return {
    "policy.py": policyEditor.value,
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
  const witnesses = payload.honestWitnesses;
  const lines = [
    "== the policy ==",
    `  ${payload.policy}`,
    "",
    "== parameters ==",
    `  ${JSON.stringify(payload.parameters)}`,
    "  (revoked != 0: このcredentialは本当に失効しています)",
    "",
    "== deploy済みの回路 ==",
    ...payload.deployedCircuit.map((constraint) => `  ${JSON.stringify(constraint)}`),
    "  ポリシーが必要とする制約が、この一覧に1本足りません。",
    "",
    "== 正常なwitness (修復後も両方受理されること) ==",
    `  失効済みcredential: ${JSON.stringify(witnesses.revokedCredential)}`,
    `  正常なcredential:   ${JSON.stringify(witnesses.cleanCredential)}`,
    "",
    "== is-zero gadget ==",
    `  iszero_a:  ${payload.iszeroGadget.iszero_a}`,
    `  iszero_b:  ${payload.iszeroGadget.iszero_b}`,
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
  print("prepare: 5 portal submissions are ready; root-cause stays yours");
  document.querySelector("#submit-title").scrollIntoView({ behavior: "smooth" });
}

function reset() {
  if (!starter) return;
  policyEditor.value = starter["policy.py"];
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
      print(tp("inspect         ポリシー、deploy済み回路、正常なwitness 2種類を表示"));
      print(tp("show policy.py  現在のコードを表示"));
      print(tp("test            公開shape testを実行"));
      print(tp("prepare         5つのcode checkpointの提出値を生成"));
      print(tp("reset           policy.pyをstarterへ戻す"));
      print(tp("clear           console出力を消去"));
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
    policyEditor.value = restored?.["policy.py"] || starter["policy.py"];
    policyEditor.addEventListener("input", save);
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
