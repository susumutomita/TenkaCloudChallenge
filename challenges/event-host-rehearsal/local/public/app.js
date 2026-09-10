const $ = (id) => document.getElementById(id);
const ids = ["plan", "rehearsal", "incident", "closeout"];
let state,
  stage = 0,
  lang = "ja",
  busy = false;
const t = (ja, en) => (lang === "ja" ? ja : en);
const option = (value, label) => `<option value="${value}">${label}</option>`;
const select = (name, label, options) =>
  `<label>${label}<select name="${name}" required>${option("", t("選んでください", "Choose"))}${options.map(([v, ja, en]) => option(v, t(ja, en))).join("")}</select></label>`;
const number = (name, label) =>
  `<label>${label}<input name="${name}" type="number" min="0" max="100" step="1" required></label>`;
const names = () => [
  t("準備数と担当", "Resources and owner"),
  t("開始できる？", "Ready to start?"),
  t("得点の問い合わせ", "A score question"),
  t("撤収の引き継ぎ", "Teardown handover"),
];
function render() {
  document.documentElement.lang = lang;
  $("title").textContent = t(
    "はじめての開催責任者",
    "Your first event as host",
  );
  $("intro").textContent = t(
    "「来月、みんなで暗号イベントをやろう！」あなたは開催責任者。4つの場面で、準備と判断を練習します。ここは架空のイベントで、AWSの起動や参加者への送信は行いません。",
    "“Let’s host a cryptography event next month!” You are the organizer. Practise planning and decisions in four scenes. This fictional exercise launches no AWS resources and contacts nobody.",
  );
  $("guide").textContent = t(
    "開催ランブックを別タブで読む",
    "Open the event runbook in another tab",
  );
  $("guide").href =
    lang === "ja"
      ? "https://tenkacloud.com/docs/operate/run-an-event/"
      : "https://tenkacloud.com/docs/operate/run-an-event/index.en.html";
  $("progress").innerHTML = names()
    .map(
      (name, i) =>
        `<span class="${state.completed.includes(ids[i]) ? "done" : stage === i ? "active" : ""}">${state.completed.includes(ids[i]) ? "✓" : i + 1} ${name}</span>`,
    )
    .join("");
  $("receipt-box").hidden = true;
  $("result").textContent = "";
  if (stage >= 4) {
    $("scene").hidden = true;
    $("scene").innerHTML = "";
    $("finish").hidden = false;
    $("finish").textContent = t(
      "開催リハーサルを完了しました。\n次はランブックの企画表に、自分のイベントの人数・会場・協力者・期限を記入してください。今回の仮想判断だけでは、実環境の準備完了にはなりません。",
      "Rehearsal complete.\nNext, fill the runbook with your actual audience, venue, helpers and deadlines. These fictional decisions do not certify a real environment.",
    );
    return;
  }
  $("scene").hidden = false;
  $("finish").hidden = true;
  const heading = `<h2>${stage + 1}. ${names()[stage]}</h2>`;
  let scene, fields;
  if (stage === 0) {
    scene =
      t(
        `<p>3週間前。参加希望は<strong>${state.participants}人</strong>。1チームは最大${state.perTeam}人、全員がPCを1台ずつ使い、予備は${state.spares}台です。チームは何組、PCは何台用意しますか？</p><p>チーム数は人数を${state.perTeam}で割り、端数があれば1組増やします。例：9人・4人組なら3組。PCは参加人数＋予備台数です。</p><p>競技は13〜17時。開始・中断・得点確定を判断できる担当を、全時間対応できる人から選びます。受付と技術対応は別の協力者に割り当てます。</p>`,
        `<p>Three weeks before. <strong>${state.participants} people</strong>, at most ${state.perTeam} per team. Each uses one computer; add ${state.spares} spares. How many teams and computers?</p><p>Divide people by ${state.perTeam} and round up. Example: nine people in teams of four need three teams. Computers = participants + spares.</p><p>Play is 13:00–17:00. Choose a person available throughout to decide start, interruptions and final scores. Assign reception and technical support separately.</p>`,
      ) +
      `<table><tr><th>${t("協力者", "Helper")}</th><th>${t("対応可能時間", "Available")}</th></tr><tr><td>Aoi</td><td>09:00–18:00</td></tr><tr><td>Ren</td><td>09:00–12:00</td></tr><tr><td>Mei</td><td>13:00–18:00</td></tr></table>`;
    fields =
      number("teams", t("用意するチーム数", "Teams to prepare")) +
      number(
        "computers",
        t("予備を含むPCの総数", "Total computers including spares"),
      ) +
      select("owner", t("競技中の判断責任者", "Decision owner during play"), [
        ["aoi", "Aoi", "Aoi"],
        ["ren", "Ren", "Ren"],
        ["mei", "Mei", "Mei"],
      ]);
  } else if (stage === 1) {
    scene = t(
      "<p>1週間前のリハーサル。テストチームはログインでき、回答の受付も確認できました。しかし得点と履歴が更新されません。</p><p>開始の条件は「ログイン・回答・採点を一通り確認済み」。受付成功だけでは採点の確認になりません。今の開催判断と、追加確認する箇所を選びます。</p>",
      "<p>One week before: the test team can log in and its answer is accepted, but score and history do not update.</p><p>Sign-off requires verified login, answering and scoring. Acceptance alone does not verify scoring. Choose the current decision and what needs checking.</p>",
    );
    fields =
      select("decision", t("今の開催判断", "Current decision"), [
        ["start", "開始可能とする", "Sign off"],
        ["hold", "準備完了の判断を保留する", "Hold sign-off"],
      ]) +
      select("check", t("追加確認する箇所", "Check next"), [
        ["scoring", "採点・履歴の反映", "Scoring and history"],
        ["venue", "会場の看板", "Venue sign"],
        ["none", "追加確認なし", "Nothing"],
      ]);
  } else if (stage === 2) {
    scene = t(
      `<p>競技中。チームから「回答したのに得点が違う」と連絡が来ました。相手の画面には<strong>${state.order}</strong>と表示されています。</p><p>技術担当へオーダー番号と時刻・画面を渡し、採点記録と照合します。確認前の一律加点や、繰り返し送信の指示は行いません。共通の問題なら責任者から全員へ案内します。</p>`,
      `<p>During play, a team reports a score mismatch. Its screen shows <strong>${state.order}</strong>.</p><p>Give the technical lead the Order ID, time and screen evidence to reconcile scoring records. Do not add points or request repeated submissions before checking. The owner announces any shared issue to everyone.</p>`,
    );
    fields =
      `<label>${t("問い合わせに添えるオーダー番号", "Order ID to include")}<input name="order" required maxlength="30" autocomplete="off"></label>` +
      select("recipient", t("調査を依頼する担当", "Investigation owner"), [
        ["technical", "技術担当", "Technical lead"],
        ["reception", "受付だけ", "Reception only"],
      ]) +
      select("action", t("最初に行うこと", "First action"), [
        [
          "reconcile",
          "画面と採点記録を照合する",
          "Reconcile screen and scoring records",
        ],
        ["add", "全チームへ加点する", "Add points to every team"],
        ["repeat", "何度も回答を送らせる", "Ask for repeated submissions"],
      ]);
  } else {
    scene = t(
      `<p>終了後。削除要求を送信しましたが、一覧には<strong>${state.remainingResources}個のリソースが残存</strong>しています。技術担当は本日中の再確認を引き受けています。</p><p>撤収の完了は削除結果と費用の確認まで。要求の送信だけで完了にしません。残件の状態・担当・次の確認を引き継ぎ表へ記録します。</p>`,
      `<p>After play: deletion was requested, but <strong>${state.remainingResources} resources remain</strong>. The technical lead has agreed to recheck today.</p><p>Teardown includes confirming deletion results and costs. A request alone is not completion. Record status, owner and next check in the handover.</p>`,
    );
    fields =
      select("status", t("撤収の状態", "Teardown status"), [
        ["done", "完了", "Complete"],
        ["pending", "残件あり", "Work remains"],
      ]) +
      select("owner", t("残件の担当", "Remaining-work owner"), [
        ["technical", "技術担当", "Technical lead"],
        ["none", "担当なし", "Nobody"],
      ]) +
      select("next", t("本日中の次の確認", "Next check today"), [
        [
          "check-deletion-and-cost",
          "削除結果と残存リソースの費用を確認",
          "Check deletion results and remaining-resource costs",
        ],
        ["nothing", "確認不要", "No check needed"],
      ]);
  }
  $("scene").innerHTML =
    heading +
    scene +
    `<form id="answer">${fields}<button type="submit">${t("この計画・判断を確認する", "Check this plan or decision")}</button></form>`;
  $("answer").addEventListener("submit", submit);
}
async function submit(event) {
  event.preventDefault();
  if (busy) return;
  busy = true;
  const form = event.currentTarget;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const answer = Object.fromEntries(new FormData(form));
    if (stage === 0) {
      answer.teams = Number(answer.teams);
      answer.computers = Number(answer.computers);
    }
    const response = await fetch("submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: ids[stage], answer }),
    });
    if (!response.ok) throw Error();
    const result = await response.json();
    if (!result.accepted) {
      $("result").textContent = t(
        "条件に合っていません。場面の人数・時間・確認結果を読み直してください。",
        "This does not match the conditions. Recheck the scene’s numbers, times and evidence.",
      );
      return;
    }
    state.completed = result.completed;
    $("result").textContent = t(
      "この場面の判断を確認できました。",
      "Your decision for this scene is confirmed.",
    );
    $("receipt-box").hidden = false;
    $("receipt").value = result.receipt;
    $("receipt-label").textContent = t(
      "ポータルへ提出する確認票",
      "Receipt to submit in the Portal",
    );
    $("receipt-help").textContent = t(
      `チェックポイント「${names()[stage]}」（${ids[stage]}）へ、この確認票をコピーして提出すると25点です。この練習画面だけではポータルの得点は増えません。`,
      `Copy this receipt into checkpoint “${names()[stage]}” (${ids[stage]}) in the Portal for 25 points. This practice page alone does not change Portal scores.`,
    );
    $("next").textContent = t("次の場面へ", "Next scene");
    $("receipt-box").scrollIntoView({ block: "nearest" });
  } catch {
    $("result").textContent = t(
      "確認できませんでした。接続を確認して再試行してください。",
      "Could not check the result. Check the connection and retry.",
    );
  } finally {
    busy = false;
    button.disabled = false;
  }
}
$("locale").addEventListener("change", () => {
  if (busy) return;
  lang = $("locale").value;
  render();
});
$("next").addEventListener("click", () => {
  stage++;
  render();
});
fetch("scenario")
  .then((r) => {
    if (!r.ok) throw Error();
    return r.json();
  })
  .then((data) => {
    state = data;
    render();
  })
  .catch(() => {
    $("result").textContent = "読み込み失敗 / Could not load. Reload to retry.";
  });
