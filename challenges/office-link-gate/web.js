"use strict";
const lang = new URLSearchParams(location.search).get("lang") === "en" ? "en" : "ja";
document.documentElement.lang = lang;
const t = (ja, en) => lang === "en" ? en : ja;
const root = document.getElementById("app");
const key = `office-link-gate:${location.pathname}`;
let receipt = "", current = null, selected = null, hintCount = 0, pending = false, feedback = "", storageAvailable = true;
try { receipt = localStorage.getItem(key) || ""; } catch { storageAvailable = false; }
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "disabled") n.disabled = v;
    else n.setAttribute(k, v);
  }
  children.flat().filter(c => c !== null && c !== undefined).forEach(c => n.append(typeof c === "string" ? document.createTextNode(c) : c));
  return n;
}
const button = (label, action, cls = "primary") => el("button", { type: "button", class: cls, onclick: action, disabled: pending }, label);
async function copy(value, event) {
  const node = event.currentTarget;
  try { await navigator.clipboard.writeText(value); node.textContent = t("コピーしました", "Copied"); }
  catch { feedback = t("コピーできません。表示中の文字列を選択してください。", "Copy failed. Select the displayed text instead."); render(); }
}
async function request(route, payload) {
  const r = await fetch(`api/${route}?lang=${lang}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(r.status === 403 ? "progress" : "network");
  return r.json();
}
function accept(result) {
  current = result; receipt = result.token; selected = null; hintCount = 0;
  try { localStorage.setItem(key, receipt); } catch { storageAvailable = false; }
}
async function restore(value = receipt) {
  pending = true; render();
  try { accept(await request("state", { token: value })); feedback = ""; }
  catch (e) { feedback = e.message === "progress" ? t("このチームの引き継ぎコードを確認してください。最初から学び直すこともできます。", "Check this team's handoff code. You can also start learning again.") : t("接続できません。再試行するか運営者へ連絡してください。", "Could not connect. Retry or contact the host."); }
  finally { pending = false; render(); }
}
async function submit() {
  if (pending) return;
  if (selected === null) { feedback = t("相談して、答えを1つ選んでください。", "Discuss and choose one answer."); render(); return; }
  pending = true; feedback = ""; render();
  try {
    const result = await request("answer", { token: receipt, stage: current.stage, choice: selected });
    if (result.correct === true) { accept(result); feedback = t("確認できました。次は担当を交代しよう。", "Checked! Swap roles for the next step."); }
    else feedback = result.message;
  } catch { feedback = t("送信できません。選択は残しています。再試行してください。", "Could not submit. Your choice is preserved. Retry."); }
  finally { pending = false; render(); document.getElementById("feedback")?.focus(); }
}
function render() {
  root.replaceChildren(el("header", { class: "topbar" }, el("span", { class: "brand" }, "TENKACLOUD / GATE"), el("a", { href: `?lang=${lang === "ja" ? "en" : "ja"}` }, lang === "ja" ? "English" : "日本語")));
  const main = el("main"); root.append(main);
  main.append(el("p", { class: "eyebrow" }, t("4人で準備 → 修了 → Battle", "Prepare together → graduate → Battle")), el("h1", {}, t("チームで、準備をそろえよう。", "Get your team ready.")));
  if (feedback) main.append(el("p", { id: "feedback", class: "feedback", role: "status", tabindex: "-1" }, feedback));
  if (!storageAvailable) main.append(el("p", { class: "notice" }, t("進捗を保存できません。端末を閉じる前に引き継ぎコードを控えてください。", "Progress cannot be saved. Keep your handoff code before closing the browser.")));
  if (!current) {
    main.append(button(t("読み込み直す", "Retry loading"), () => restore()), button(t("最初から学ぶ", "Start learning again"), () => restore(""), "secondary"));
    return;
  }
  if (current.done) {
    main.append(el("section", { class: "celebration" }, el("h2", {}, t("4つの確認、修了！", "All four checks completed!")), el("p", {}, t("ポータルの「つながるオフィスの準備」へ修了の合言葉を提出。100点と修了が反映されたら、問題一覧を更新してBattleへ進みます。", "Submit your completion passphrase to Office Link Preparation in the portal. Once the 100 points and completion appear, refresh the problem list and open Battle."))));
    main.append(el("article", { class: "receipt" }, el("code", {}, current.flag), button(t("修了の合言葉をコピー", "Copy completion passphrase"), e => copy(current.flag, e))));
  } else {
    const l = current.lesson;
    main.append(el("p", { class: "eyebrow" }, `${t("確認", "Check")} ${current.stage + 1} / 4`), el("p", { class: "role-tip" }, t(`説明担当は${current.stage + 1}人目。残りの3人は例を読み、操作し、結果を確かめます。`, `Teammate ${current.stage + 1} explains. The other three read the example, operate and check the result.`)));
    main.append(el("section", { class: "lesson" }, el("h2", {}, l.title), el("p", { class: "lead" }, l.concept), el("p", {}, l.example)));
    main.append(el("section", { class: "control-room" }, el("fieldset", {}, el("legend", {}, l.question), el("div", { class: "choices" }, l.options.map((label, i) => el("label", { class: "choice" }, el("input", { type: "radio", name: "choice", value: String(i), ...(selected === String(i) ? { checked: "" } : {}), disabled: pending, onchange: () => { selected = String(i); } }), el("span", {}, label))))), el("p", {}, t("選ぶ前に、なぜそう思うか仲間へ一言で伝えよう。", "Before choosing, tell your teammates why in one sentence.")), button(pending ? t("確認中…", "Checking…") : t("相談した答えを確かめる", "Check our answer"), submit), el("div", { class: "hint-area" }, button(t(`助け舟（無料） ${hintCount}/3`, `Free hint ${hintCount}/3`), () => { hintCount = Math.min(3, hintCount + 1); render(); }, "secondary"), l.hints.slice(0, hintCount).map(h => el("p", {}, h)))));
    main.append(el("p", { class: "boundary" }, t("今は準備中。4つすべて確認してから、修了の合言葉を1つ受け取ります。ここでの試行・ヒントは減点なし。", "This is preparation. Complete all four checks to receive one completion passphrase. Attempts and hints here have no penalty.")));
  }
  const input = el("input", { class: "handoff-code", id: "handoff", autocomplete: "off", maxlength: "100", disabled: pending });
  main.append(el("details", { class: "handoff" }, el("summary", {}, t("別の端末へ担当を交代する", "Hand over to another device")), el("p", {}, t("同じ端末なら人だけ交代。別端末では同じGameUrlを開き、このコードで続きを受け取ります。ポータルへ提出する合言葉とは別です。", "On the same device, swap people. On another device, open the same GameUrl and import this code. It is not a portal scoring passphrase.")), receipt ? el("article", { class: "receipt" }, el("code", {}, receipt), button(t("引き継ぎコードをコピー", "Copy handoff code"), e => copy(receipt, e), "secondary")) : null, el("label", { for: "handoff" }, t("仲間から受け取ったコード", "Code from your teammate")), input, button(t("続きを受け取る", "Resume from code"), () => restore(input.value.trim()), "secondary")));
}
restore();
