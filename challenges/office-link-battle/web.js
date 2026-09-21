"use strict";
const query = new URLSearchParams(location.search);
const lang = query.get("lang") === "en" ? "en" : "ja";
document.documentElement.lang = lang;
const t = (ja, en) => lang === "en" ? en : ja;
const root = document.getElementById("app");
const stateKey = `office-link:${location.pathname}`;
let state = { mission: 0, started: false, receipts: {}, hints: {}, values: {} };
let missions = [];
let pending = false;
let message = null;
let storageAvailable = true;
try {
  const stored = JSON.parse(localStorage.getItem(stateKey) || "null");
  if (stored && typeof stored === "object" && stored.receipts && stored.hints && stored.values) {
    state = { ...state, ...stored, mission: [0, 1, 2].includes(stored.mission) ? stored.mission : 0 };
  }
} catch { storageAvailable = false; }

function save() {
  try { localStorage.setItem(stateKey, JSON.stringify(state)); }
  catch { storageAvailable = false; }
}
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "class") node.className = value;
    else if (key === "disabled") node.disabled = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}
const button = (label, action, attrs = {}) => el("button", { type: "button", onclick: action, ...attrs }, label);
const heading = (label) => el("p", { class: "eyebrow" }, label);
function move(index) { state.mission = index; message = null; save(); render(); }
function link(role) {
  const url = new URL(location.href);
  url.searchParams.set("role", String(role));
  url.searchParams.set("mission", String(state.mission));
  return url.href;
}
async function copy(value, node) {
  try { await navigator.clipboard.writeText(value); node.textContent = t("コピーしました", "Copied"); }
  catch { node.textContent = t("コピーできません。表示中の文字列を選択してください", "Copy failed. Select the displayed text instead."); }
}
function choices(field, check) {
  const selected = state.values[check] || {};
  return el("fieldset", {}, el("legend", {}, field.label), el("div", { class: "choices" }, field.options.map(option =>
    el("label", { class: "choice" }, el("input", {
      type: "radio", name: field.id, value: option.id,
      disabled: pending,
      ...(selected[field.id] === option.id ? { checked: "" } : {}),
      onchange: () => { (state.values[check] ||= {})[field.id] = option.id; save(); },
    }), el("span", {}, el("strong", {}, option.label), option.detail ? el("small", {}, option.detail) : null))
  )));
}
function roleCards(mission) {
  return el("div", { class: "role-grid" }, mission.cards.map((card, index) => el("article", { class: "role-card" },
    heading(card.role), el("h3", {}, card.title),
    el("a", { href: link(index), target: "_blank", rel: "noopener noreferrer" }, t("担当する手がかりカードを開く ↗", "Open your clue card ↗"))
  )));
}
function receipt(check, label) {
  const result = state.receipts[check];
  if (!result) return null;
  const copyButton = button(t("合言葉をコピー", "Copy passphrase"), event => copy(result.flag, event.currentTarget), { class: "secondary" });
  return el("article", { class: "receipt" },
    el("strong", {}, label), el("span", { class: "points" }, `+${result.points}`),
    el("p", {}, t("ポータルの同じ名前の回答欄へ貼り付けて提出すると得点になります。", "Paste into the matching answer field in the portal and submit to score.")),
    el("code", { tabindex: "0" }, result.flag), copyButton);
}
async function submit(check, required, handoff = false) {
  if (pending) return;
  const values = { ...(state.values[handoff ? `handoff:${check}` : check] || {}) };
  if (required.some(key => typeof values[key] !== "string")) {
    message = { kind: "error", text: handoff ? t("前の担当から操作の合言葉を受け取って、貼り付けてください。", "Paste the repair passphrase from the previous operator.") : t("選択肢をそれぞれ1つ選んでください。", "Choose one option in each group.") };
    render(); return;
  }
  if (!handoff && ["sharing", "restore"].includes(check)) values.previous = state.receipts[check === "sharing" ? "delivery-why" : "sharing-why"]?.flag;
  if (check.endsWith("-why")) values.receipt = state.receipts[check.replace("-why", "")]?.flag;
  pending = true; message = null; render();
  try {
    const response = await fetch(`api/${handoff ? "resume" : "play"}?lang=${lang}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ checkpoint: check, values }),
    });
    if (!response.ok) throw new Error("request failed");
    const result = await response.json();
    if (result.correct === true && typeof result.flag === "string" && (handoff || result.checkpoint === check)) {
      if (handoff) {
        for (const earned of result.receipts) state.receipts[earned.checkpoint] = earned;
        state.mission = missions.findIndex(m => result.checkpoint === m.id || result.checkpoint === m.id + "-why");
      } else state.receipts[check] = result;
      save();
      message = { kind: "success", text: handoff ? t("引き継ぎました。次の相談に答えよう。", "Handoff complete. Answer the next request.") : t("成功！提出用の合言葉を受け取りました。", "Success! Your passphrase is ready to submit.") };
    } else if (result.correct === false && typeof result.message === "string") {
      message = { kind: "error", text: result.message + t(" ここでの試行は減点されません。", " Trying here costs no points.") };
    } else throw new Error("unexpected response");
  } catch {
    message = { kind: "error", text: t("通信できませんでした。入力は残しています。もう一度送るか、運営者を呼んでください。", "Could not connect. Your choices are preserved. Retry or ask the host for help.") };
  } finally { pending = false; render(); }
  document.getElementById("feedback")?.focus();
}
function render() {
  root.replaceChildren();
  const languageUrl = new URL(location.href);
  languageUrl.searchParams.set("lang", lang === "ja" ? "en" : "ja");
  root.append(el("header", { class: "topbar" },
    el("a", { class: "brand", href: `./?lang=${lang}` }, "TENKACLOUD / OFFICE LINK"),
    el("a", { href: languageUrl.href }, lang === "ja" ? "English" : "日本語")));
  const main = el("main"); root.append(main);
  if (!storageAvailable) main.append(el("p", { class: "notice" }, t("このブラウザには進捗を保存できません。更新する前に合言葉をポータルへ提出してください。", "Progress cannot be saved in this browser. Submit passphrases to the portal before reloading.")));
  const requestedRole = query.get("role");
  if (requestedRole === "0" || requestedRole === "1") {
    const index = Number(query.get("mission"));
    const mission = missions[[0, 1, 2].includes(index) ? index : 0];
    const card = mission.cards[Number(requestedRole)];
    main.append(heading(t("仲間に声で伝えるカード", "Read this card to a teammate")), el("h1", {}, card.title),
      el("article", { class: "solo-card" }, el("p", { class: "large" }, card.body)),
      el("p", {}, t("操作担当に、見えている手がかりを伝えてください。自分の画面を見せなくても相談できます。", "Tell the operator what you see. Try helping without showing them your screen.")),
      el("a", { href: `./?lang=${lang}` }, t("操作画面へ戻る", "Back to the control room")));
    return;
  }
  if (!state.started) {
    main.append(el("section", { class: "hero" }, heading(t("相談が、得点になる。", "Turn conversation into points.")),
      el("h1", {}, t("離れていても、\nチームでつなごう。", "Different offices.\nOne team.")),
      el("p", { class: "lead" }, t("準備Challengeで学んだ場所・権限・復旧を使おう。仲間の手がかりを集めて、3つのミッションを1つずつクリア。", "Use the regions, permissions and recovery concepts from Preparation. Combine your teammates' clues to clear three missions, one at a time.")),
      el("p", {}, t("AWS経験・プログラミング不要。4人で、読む人・操作する人・確認する人を交代します。", "No AWS or coding experience required. In teams of four, rotate reader, operator and checker.")),
      button(t("役割を分けて、はじめる →", "Choose roles and begin →"), () => { state.started = true; save(); render(); }, { class: "primary" }),
      el("div", { class: "journey", "aria-label": t("3つのミッション", "Three missions") }, missions.map((m, i) => el("div", {}, el("span", { class: "icon" }, m.icon), el("strong", {}, `${i + 1}. ${m.title}`))))));
    main.append(el("p", { class: "boundary" }, t("これはクラウドの仕組みを体験する模型です。実際の社内資料やAWSの設定は変更しません。正式な得点はTenkaCloudポータルで確認します。", "This is a model of cloud concepts. It does not change real company files or AWS settings. Official scores live in the TenkaCloud portal.")));
    return;
  }
  if (state.mission > 0 && !state.receipts[missions[state.mission - 1].id + "-why"]) state.mission = 0;
  const m = missions[state.mission];
  main.append(el("nav", { class: "missions", "aria-label": t("ミッション", "Missions") }, missions.map((item, i) =>
    button(`${i > 0 && !state.receipts[missions[i - 1].id + "-why"] ? "🔒 " : state.receipts[item.id + "-why"] ? "✓ " : ""}${i + 1}. ${item.title}`, () => move(i), { class: i === state.mission ? "active" : "", "aria-current": i === state.mission ? "step" : "false", disabled: pending || (i > 0 && !state.receipts[missions[i - 1].id + "-why"]) })
  )));
  main.append(el("section", { class: "mission-heading" }, heading(`MISSION 0${state.mission + 1} / 03`), el("h1", {}, m.title), el("p", { class: "lead" }, m.goal)));
  main.append(el("p", { class: "role-tip" }, t("読む人：カードを1枚ずつ担当 ／ 操作する人：話を聞いて試す ／ 確認する人：結果を声に出す", "Readers: take a card each / Operator: listen and try / Checker: say what changed")));
  main.append(roleCards(m));
  if (message) main.append(el("div", { id: "feedback", class: `feedback ${message.kind}`, role: "status", tabindex: "-1" }, message.text));
  const done = state.receipts[m.id];
  {
    const handoffKey = `handoff:${m.id}`;
    main.append(el("details", { class: "handoff" },
      el("summary", {}, t("仲間から続きを引き継ぐ", "Resume from a teammate's device")),
      el("p", {}, t("前の担当が最後に得た合言葉（AまたはB）を受け取ります。そこまでの進捗を復元します。", "Ask your teammate for their last earned passphrase (A or B). Progress up to that point will be restored.")),
      el("label", { for: "handoff-receipt" }, t("最後に得た合言葉", "Last earned passphrase")),
      el("input", { id: "handoff-receipt", class: "handoff-code", type: "text", autocomplete: "off", maxlength: "100", disabled: pending,
        value: state.values[handoffKey]?.receipt || "", oninput: event => { (state.values[handoffKey] ||= {}).receipt = event.target.value.trim(); save(); } }),
      button(t("続きを受け取る", "Resume from this point"), () => submit(m.id, ["receipt"], true), { class: "secondary", disabled: pending })
    ));
  }
  if (!done) {
    const panel = el("section", { class: "control-room" }, heading(t("操作担当の画面", "Operator's panel")), el("h2", {}, m.before));
    for (const field of m.fields) panel.append(choices(field, m.id));
    panel.append(button(pending ? t("確認しています…", "Checking…") : m.button, () => submit(m.id, m.fields.map(f => f.id)), { class: "primary", disabled: pending }));
    const count = state.hints[m.id] || 0;
    panel.append(el("div", { class: "hint-area" }, button(t(`助け舟を出す（無料） ${count}/3`, `Get a free hint ${count}/3`), () => { state.hints[m.id] = Math.min(count + 1, 3); save(); render(); }, { class: "secondary", disabled: count >= 3 }),
      m.hints.slice(0, count).map((hint, i) => el("p", {}, `${i + 1}. ${hint}`))));
    main.append(panel);
  } else {
    main.append(el("section", { class: "lesson" }, heading(t("直った！今度は、仲間に説明しよう。", "Repaired! Now explain it to a teammate.")), el("h2", {}, t("なぜ、うまくいった？", "Why did that work?")), el("p", { class: "lead" }, m.lesson)));
    if (!state.receipts[m.id + "-why"]) {
      const panel = el("section", { class: "control-room" }, heading(t("解説ミッション / 操作担当を交代", "Explanation mission / Swap the operator")),
        choices({ id: "reason", label: m.why, options: m.reasons }, m.id + "-why"),
        el("p", {}, t("選ぶ前に、その理由を仲間へ一言で伝えよう。", "Before choosing, tell a teammate why in one sentence.")),
        button(pending ? t("確認しています…", "Checking…") : t("この説明で引き継ぐ", "Send this explanation"), () => submit(m.id + "-why", ["reason"]), { class: "primary", disabled: pending }),
        el("details", {}, el("summary", {}, t("解説ミッションの助け舟（無料）", "Free explanation hint")), el("p", {}, m.whyHint)));
      main.append(panel);
    } else {
      main.append(el("section", { class: "finished" }, el("h2", {}, t("解説ミッションも成功！", "Explanation cleared!")),
        el("p", {}, t("次は役割を交代しよう。合言葉の提出も忘れずに。", "Swap roles for the next mission. Remember to submit your passphrases.")),
        state.mission < 2 ? button(t("次のミッションへ →", "Next mission →"), () => move(state.mission + 1), { class: "primary" }) : null));
    }
  }
  main.append(el("section", { class: "receipts" }, el("h2", {}, t("ポータルへ提出する合言葉", "Passphrases to submit in the portal")),
    el("p", {}, t("ここは提出前の控えです。ポータルの得点・提出済み表示が正式な結果です。操作と解説は別々に提出できます。ポータルへの誤った合言葉は5点減点なので、コピーして同じ番号の欄へ貼り付けます。", "These are your submission notes. The portal's score and solved status are official. Repair and explanation score independently. A wrong portal passphrase costs 5 points, so copy it into the matching numbered field.")),
    receipt(m.id, `${state.mission + 1}A. ${m.title}`), receipt(m.id + "-why", `${state.mission + 1}B. ${t("仲間に説明する", "Explain to a teammate")}`)));
  if (Object.keys(state.receipts).length === 6) main.append(el("section", { class: "celebration" }, el("h2", {}, t("3つのミッション、つながった！", "All three missions connected!")), el("p", {}, t("6つの合言葉を提出して100点へ。最後に『仲間のどの一言が役立った？』を1人ずつ話そう。", "Submit all six passphrases for 100 points. Finish by sharing one thing a teammate said that helped."))));
  main.append(el("footer", {}, t("模型の中で何度でも試せます。ヒント・操作の試行・未完了による減点はありません。公式の残り時間はポータルで確認。", "Retry freely in this model. Hints, repair attempts and unfinished missions cost no points. Check the portal for the official time remaining.")));
}
async function start() {
  try {
    const response = await fetch(`api/scenario?lang=${lang}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("unavailable");
    missions = (await response.json()).missions;
    render();
  } catch {
    root.replaceChildren(el("main", {}, el("h1", {}, t("問題を開けませんでした", "Could not open the mission")),
      el("p", {}, t("運営者から受け取ったURLを確認してください。", "Check the URL provided by your host.")), button(t("再読み込み", "Reload"), () => location.reload(), { class: "primary" })));
  }
}
start();
