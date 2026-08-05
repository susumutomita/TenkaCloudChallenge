"use strict";

/**
 * [#2877] このページは Portal と別オリジンなので Portal の locale は読めない。
 * 言語は ?lang= → このページで選んだ設定 → ブラウザの言語 → ja の順で決める。
 */
const STRINGS = {
  ja: {
    "prepareDone": "prepare: environment と generalize ができました。predict と first-broken は自分で書きます",
    "helpInspect": "inspect          あなたの数、合言葉、回数が戻ってしまう例、1個だけはみ出した並びを表示",
    "helpShow": "show counter.py  いま書いているコードを表示",
    "helpTest": "test             公開テストを実行",
    "helpPrepare": "prepare          environment と generalize の提出値を作る (残り2つは自分で書く)",
    "helpReset": "reset            counter.py を最初の状態に戻す",
    "helpClear": "clear            この画面の文字を消す",
    "bootReady": "準備できました。inspect を実行してください (コマンド一覧は help)。",
    "pageTitle": "予測してから走らせる",
    "heroLead": "暗号がなぜ「割ったあまり」で計算するのか、その理由をいちばん簡単な形で自分の手で作ります。この画面だけで inspect、Python の編集、公開テスト、提出データ作りまで終わります。4つの提出欄のうち2つは、あなたの頭で決めます。",
    "connecting": "接続確認中",
    "ready": "Workbench 準備完了",
    "connectFailed": "接続失敗",
    "step1Heading": "まず、これだけ",
    "clockPara": "時計を思い出してください。10時の3時間後は 13時ではなく 1時です。12 を超えたら戻ってくる。同じことを、たとえば 10 でやります。10 以上になったら 10 を引いて戻す。答えは必ず 0 から 9 のどれかになります。「10 で割ったあまりにする」と言っても同じことです。",
    "ringFigure": "12 は 10 以上 → 12 - 10 = 2\n 9 は 10 未満 → そのまま 9\n\n        0\n    9       1\n  8           2     ← 0 から 9 の 10 個しかない輪\n  7           3\n    6       4\n        5\n\n6 から 3 進むと 9。9 から 3 進むと 12 …ではなく、0 を通り越して 2 に着く。",
    "exampleNote": "この 10 は説明のための例です。あなたが使う数は STEP 2 の inspect が出します。",
    "whyPara": "普通の足し算は、答えの大きさが手がかりになります。5000 になったと聞けば、何回足したのかの見当がつく。輪の上を回る足し算なら、答えは必ず 0 から 9 のどれかで、大きさからは何も分かりません。暗号が数をこう閉じ込めるのは、この手がかりを消すためです。ただし、足した回数のほうは掛け算ひとつで戻せてしまいます (inspect があなたの数で実際にやって見せます)。Week 3 では足す相手を楕円曲線というものに替えて、その戻し方が効かないようにします。",
    "claimLabel": "約束",
    "claimBody": "出てくる数は毎回はみ出した分を引いて戻すので、いつも 0 以上、引く目印の数より小さい",
    "step2Heading": "自分の数を見る",
    "runInspect": "inspectを実行",
    "step2Lead": "合言葉、あなたが使う 4 つの数、足した回数が戻ってしまう例、1 個だけはみ出した並びが出ます。inspect は証拠を出すコマンドの名前で、書き込む欄の名前ではありません（欄の名前は environment / predict / first-broken / generalize）。数は起動するたびに変わるので、他の人の数値は使えません。",
    "inspectEmpty": "inspectを実行してください。",
    "step3Heading": "advanceを完成させる",
    "step3Lead": "最初のコードはわざと未完成で、はみ出した分を一度も引きません。書いた内容はこのブラウザに自動保存されます。advance の 4 つの引数 start / step / rounds / modulus は、inspect が見せる「からはじめて」「を毎回たす」「回くりかえす」「以上になったら引く」の 4 つの数です。公開テストは形を見るだけで、たす数がマイナスの場合も 0 の場合も試しません。",
    "runTests": "公開テストを実行",
    "buildValues": "提出データを作る",
    "reset": "初期状態へ戻す",
    "consoleHeading": "コマンドコンソール",
    "consoleLead": "一般シェルではなく、この問題に必要な安全なコマンドだけを実行します。help で一覧を表示できます。",
    "commandLabel": "コマンド",
    "run": "実行",
    "step4Heading": "Portalへ提出する",
    "step4Lead": "書く欄は4つ。「提出データを作る」が用意してくれるのは environment と generalize の2つだけです。残りの2つは自分で決めて、Participant Portal の同じ名前の欄へ直接書きます。",
    "fromButton": "ボタンが出す",
    "fromButton2": "ボタンが出す",
    "byHandCalc": "自分で計算して書く",
    "byHandRead": "自分で読んで書く",
    "environmentBody": "表示された合言葉をそのまま貼ります。コンテナが本当に動いた証拠です。",
    "predictBody": "inspect が見せた4つの数を紙で追い、最後にいる数をひとつだけ。途中の数を全部並べるのではありません。",
    "firstBrokenBody": "並んだ数のうち、はみ出している1個が左から何番目か。左端が0番です。",
    "generalizeBody": "書き上げた counter.py の中身を全部貼ります。見たことのない数で試されます。",
    "noSubmissions": "まだ提出データは作られていません。",
    "copy": "コピー",
    "copied": "コピーしました",
    "copyFailed": "手動で選択してください",
    "langToggle": "English"
  },
  en: {
    "prepareDone": "prepare: environment and generalize are ready. predict and first-broken you write yourself",
    "helpInspect": "inspect          show your numbers, your pass phrase, the example that comes back out, and the list with one out of place",
    "helpShow": "show counter.py  print the code you are writing",
    "helpTest": "test             run the public tests",
    "helpPrepare": "prepare          build the environment and generalize values (you write the other two)",
    "helpReset": "reset            put counter.py back to how it started",
    "helpClear": "clear            clear this screen",
    "bootReady": "Ready. Run inspect (type help for the list of commands).",
    "pageTitle": "Predict, then run",
    "heroLead": "Why does cryptography count with remainders? You build the simplest thing that answers that, by hand. Everything happens on this page: inspect, editing the Python, the public tests, and building what you submit. Two of the four boxes you fill in yourself.",
    "connecting": "Connecting",
    "ready": "Workbench ready",
    "connectFailed": "Connection failed",
    "step1Heading": "Just this, first",
    "clockPara": "Think of a clock. Three hours after 10 o'clock is 1 o'clock, not 13. Once you pass 12 you come back round. Do the same with, say, 10: whenever a number reaches 10, take 10 off it. Every answer is then one of 0 to 9. Saying \"take the remainder after dividing by 10\" means exactly this.",
    "ringFigure": "12 is 10 or more → 12 - 10 = 2\n 9 is below 10   → leave it as 9\n\n        0\n    9       1\n  8           2     ← only ten numbers on the ring, 0 to 9\n  7           3\n    6       4\n        5\n\nFrom 6, move 3 and you land on 9. From 9, move 3 and you do not land on\n12 — you go past 0 and land on 2.",
    "exampleNote": "This 10 is only an example for the explanation. The numbers you actually use come from inspect, in STEP 2.",
    "whyPara": "With ordinary addition the size of the answer is a clue. Hear that it reached 5000 and you can guess roughly how many times something was added. Going round the ring, every answer is one of 0 to 9, and the size tells you nothing. Cryptography closes numbers in like this to remove that clue. The number of times, though, comes straight back out with a single multiplication — inspect does it with your own numbers, to show you. In Week 3 the thing being added is swapped for something called an elliptic curve, so that way back stops working.",
    "claimLabel": "The promise",
    "claimBody": "every number that comes out has had the overflow taken off, so it is always 0 or more and smaller than the number you subtract by",
    "step2Heading": "Look at your own numbers",
    "runInspect": "Run inspect",
    "step2Lead": "It prints your pass phrase, the four numbers you will use, an example where the number of additions comes back out, and a list with exactly one number out of place. inspect is the name of the command that shows you evidence, not the name of a box you fill in (the boxes are environment / predict / first-broken / generalize). The numbers change every time it starts, so someone else's will not work.",
    "inspectEmpty": "Run inspect to see it.",
    "step3Heading": "Finish advance",
    "step3Lead": "The code you start from is unfinished on purpose: it never takes the overflow off. What you write is saved in this browser automatically. The four arguments to advance — start / step / rounds / modulus — are the four numbers inspect shows you as \"start at\", \"add each time\", \"repeat this many times\" and \"take this off once you reach it\". The public tests only check the shape; they never try a negative step or a step of 0.",
    "runTests": "Run the public tests",
    "buildValues": "Build what you submit",
    "reset": "Back to the start",
    "consoleHeading": "Command console",
    "consoleLead": "Not a general shell — it runs only the safe commands this problem needs. Type help for the list.",
    "commandLabel": "command",
    "run": "Run",
    "step4Heading": "Submit in the Portal",
    "step4Lead": "There are four boxes. \"Build what you submit\" fills in only two of them, environment and generalize. The other two you work out yourself and type straight into the box of the same name in the Participant Portal.",
    "fromButton": "the button gives it",
    "fromButton2": "the button gives it",
    "byHandCalc": "work it out and type it",
    "byHandRead": "read it and type it",
    "environmentBody": "Paste the pass phrase exactly as shown. It is only proof that the container really ran.",
    "predictBody": "Follow the four numbers inspect gave you, on paper, and give the number you end on — just that one. Not the whole list of numbers along the way.",
    "firstBrokenBody": "In the list, one number is out of place. Which position is it, counting from the left? The leftmost is 0.",
    "generalizeBody": "Paste the whole contents of the counter.py you finished. It is tried on numbers you have not seen.",
    "noSubmissions": "Nothing has been built yet.",
    "copy": "Copy",
    "copied": "Copied",
    "copyFailed": "Select it by hand",
    "langToggle": "日本語"
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

function t(key) {
  return STRINGS[lang][key] ?? STRINGS.ja[key] ?? key;
}

function applyLang() {
  document.documentElement.lang = lang;
  for (const node of document.querySelectorAll("[data-i18n]")) {
    const value = STRINGS[lang][node.dataset.i18n];
    if (value !== undefined) node.textContent = value;
  }
  document.title = `${t("pageTitle")} — Browser Workbench`;
  const toggle = document.querySelector("#lang-toggle");
  if (toggle) toggle.textContent = t("langToggle");
}

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
  // 14 clears the widest sum this problem can print ("22 + 22 = 44"), so the
  // explanation never runs straight into the arithmetic.
  const sum = `${value} + ${step} = ${raw}`.padEnd(14);
  return raw >= modulus
    ? `${sum}${raw} は ${modulus} 以上なので、${raw} - ${modulus} = ${raw - modulus}`
    : `${sum}${raw} は ${modulus} より小さいので、そのまま`;
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
    button.textContent = t("copy");
    button.addEventListener("click", async () => {
      try {
        await copyText(value);
        button.textContent = t("copied");
      } catch {
        button.textContent = t("copyFailed");
        pre.focus();
      }
      setTimeout(() => {
        button.textContent = t("copy");
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
  print(t("prepareDone"));
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
      print(t("helpInspect"));
      print(t("helpShow"));
      print(t("helpTest"));
      print(t("helpPrepare"));
      print(t("helpReset"));
      print(t("helpClear"));
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
});

applyLang();
