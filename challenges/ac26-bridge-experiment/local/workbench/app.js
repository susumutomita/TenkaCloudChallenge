"use strict";

const STORAGE_KEY = "tenkacloud.ac26-bridge-experiment.sources.v1";
const output = document.querySelector("#terminal-output");
const inspectOutput = document.querySelector("#inspect-output");
const submissionOutput = document.querySelector("#submission-output");
const counterEditor = document.querySelector("#counter-editor");
const connectionStatus = document.querySelector("#connection-status");

// The two checkpoints the workbench must not produce, and where their values
// come from instead. Rendered next to the prepared cards so the portal journey
// stays complete on one screen.
const MANUAL_CHECKPOINTS = [
  {
    id: "predict",
    hint: "走らせる前に紙で出した、最後にいる数をひとつだけ書きます。途中の数を全部並べるのではありません。",
  },
  {
    id: "first-broken",
    hint: "並んだ数のうち、使ってよい数からはみ出しているものが左から何番目かを書きます。左端が 0 番です。",
  },
];

let starter = null;

function sources() {
  return {
    "counter.py": counterEditor.value,
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

/**
 * The list of numbers, plus a row of positions sitting directly under it.
 *
 * "0 始まりの index" is never named in this problem. The positions are drawn under
 * the numbers instead, which is the same fact and needs no vocabulary. Both rows
 * are pure ASCII digits and spaces, so they line up in any monospace font -- a
 * Japanese label inside the aligned region would not.
 */
function numberedList(values) {
  const parts = values.map((value) => String(value));
  const listing = `[${parts.join(", ")}]`;
  let positions = "";
  let column = 1; // the "[" is one character wide
  parts.forEach((part, index) => {
    positions += " ".repeat(Math.max(column - positions.length, 0)) + String(index);
    column += part.length + 2; // the number itself, then ", "
  });
  return { listing, positions };
}

/** One addition, written the way a reader would do it on paper. */
function addOnce(value, step, modulus) {
  const raw = value + step;
  const sum = `${value} + ${step} = ${raw}`.padEnd(12);
  return raw >= modulus
    ? `${sum} ${raw} は ${modulus} 以上なので、${raw} - ${modulus} = ${raw - modulus}`
    : `${sum} ${raw} は ${modulus} より小さいので、そのまま`;
}

async function inspect() {
  print("$ inspect");
  const payload = await request("/api/inspect");
  const predict = payload.predict;
  const walk = payload.walkback;
  const broken = payload.firstBroken;

  const modulus = predict.modulus;
  const width = String(Math.max(predict.start, predict.step, predict.rounds, modulus)).length;
  const pad = (value) => String(value).padStart(width);
  const first = (predict.start + predict.step) % modulus;
  const noWrapYet = predict.start + predict.step < modulus && first + predict.step < modulus;

  // JavaScript's % keeps the sign of the left operand, so the walk-back gap has to be
  // folded back by hand. show.py gets this free from Python's floored %.
  const gap = (((walk.final - walk.start) % walk.modulus) + walk.modulus) % walk.modulus;
  const product = gap * walk.undoStep;
  const undone = walk.step * walk.undoStep;

  const { listing, positions } = numberedList(broken.trace);

  const lines = [
    "== environment 欄に入れるもの ==",
    `  python    ${payload.environment.python}`,
    `  合言葉    ${payload.environment.healthToken}`,
    "  この合言葉をそのまま Portal の environment 欄に貼ります。",
    "  コンテナが本当に動いた、という証拠にしかなりません。",
    "",
    "== predict 欄に入れるもの ==",
    `  ここで使う数は 0 から ${modulus - 1} までだけです。時計の 10時の3時間後が 13時ではなく`,
    `  1時になるのと同じで、${modulus} 以上になったら ${modulus} を引きます。`,
    `  (${modulus} で割ったあまりにする、と同じことです)`,
    "",
    `    ${pad(predict.start)}  からはじめて`,
    `    ${pad(predict.step)}  を毎回たす`,
    `    ${pad(predict.rounds)}  回くりかえす`,
    `    ${pad(modulus)}  以上になったら ${modulus} を引く`,
    "    (counter.py ではこの4つを start / step / rounds / modulus と呼んでいます)",
    "",
    "  はじめの2回だけ、やってみせます:",
    `    ${addOnce(predict.start, predict.step, modulus)}`,
    `    ${addOnce(first, predict.step, modulus)}`,
    ...(noWrapYet
      ? [`    (${modulus} 以上になった場合は、たとえば ${modulus - 1} + ${predict.step} = ` +
         `${modulus - 1 + predict.step} なので ${modulus - 1 + predict.step} - ${modulus} = ${predict.step - 1})`]
      : []),
    "",
    `  同じように最後まで進めてください。${predict.rounds} 回目を終えたときにいる数が、predict 欄に`,
    "  入れるものです。数はひとつだけで、途中の数を全部並べるのではありません。",
    "  走らせる前に紙で出すこと。それがこの欄の目的です。",
    "",
    "== ここは提出しません: これがまだ何も隠せていない理由 ==",
    `  もう1つ、終わりまで見せる例です。${walk.start} からはじめて ${walk.step} を毎回たし、${walk.modulus} 以上に`,
    `  なったら ${walk.modulus} を引く。これを ${walk.rounds} 回やって ${walk.final} で終わりました。`,
    `  ${walk.final} という数だけ見ても、${walk.step} を何回たしたかは分かりません。答えは必ず 0〜${walk.modulus - 1} の`,
    "  どれかなので、数の大きさが手がかりになりません。",
    "  ところが、たした回数は計算で戻ってきます:",
    `    ここでは ${walk.undoStep} が ${walk.step} を打ち消します。${walk.step} × ${walk.undoStep} = ${undone}、` +
      `${undone} を ${walk.modulus} で割ったあまりが 1。`,
    `    ${walk.start} から ${walk.final} まで数えると ${gap}。${gap} × ${walk.undoStep} = ${product}、` +
      `${product} を ${walk.modulus} で割ったあまりは ${walk.recoveredRounds}。`,
    `    たした回数の ${walk.recoveredRounds} が、そのまま戻ってきました。`,
    "  ひとつは隠せて、ひとつは開いたまま。Week 3 ではたす相手を楕円曲線というものに",
    "  替えて、この最後の計算をできなくします。",
    "",
    "== first-broken 欄に入れるもの ==",
    "  別の人が同じ遊びをして、出てきた数を全部書き出したものです:",
    `  ${broken.start} からはじめて ${broken.step} を毎回たし、${broken.modulus} 以上になったら ${broken.modulus} を引く。これを ${broken.rounds} 回。`,
    `  その ${broken.rounds} 回のうち 1 回だけ、${broken.modulus} を引くのを忘れています。だから下の並びには、`,
    `  0〜${broken.modulus - 1} に収まっていない数がちょうど 1 個あります。`,
    "",
    `    ${listing}`,
    `    ${positions}    ← 左から 0, 1, 2 ... と数えた番号`,
    "",
    `  0〜${broken.modulus - 1} に収まっていない数は、何番目にありますか。`,
    "  その番号ひとつ (左端が 0) を Portal の first-broken 欄に書きます。",
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
  print("prepare: environment と generalize ができました。predict と first-broken は自分で書きます");
  document.querySelector("#submit-title").scrollIntoView({ behavior: "smooth" });
}

function reset() {
  if (!starter) return;
  counterEditor.value = starter["counter.py"];
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
      print("inspect          あなたの数、合言葉、回数が戻ってしまう例、1個だけはみ出した並びを表示");
      print("show counter.py  いま書いているコードを表示");
      print("test             公開テストを実行");
      print("prepare          environment と generalize の提出値を作る (残り2つは自分で書く)");
      print("reset            counter.py を最初の状態に戻す");
      print("clear            この画面の文字を消す");
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
    counterEditor.value = restored?.["counter.py"] || starter["counter.py"];
    counterEditor.addEventListener("input", save);
    connectionStatus.textContent = "Workbench ready";
    connectionStatus.classList.add("ready");
    print("準備できました。inspect を実行してください (コマンド一覧は help)。");
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
