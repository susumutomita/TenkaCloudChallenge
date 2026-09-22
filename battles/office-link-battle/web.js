"use strict";
const language = new URLSearchParams(location.search).get("lang") === "en" ? "en" : "ja";
document.documentElement.lang = language;
const t = (ja, en) => language === "en" ? en : ja;
const app = document.getElementById("app");
let state = null, busy = false, message = "", hints = 0, choice = null;
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith("on")) n.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "disabled") n.disabled = value;
    else n.setAttribute(key, value);
  }
  children.flat().filter(x => x !== null).forEach(x => n.append(typeof x === "string" ? document.createTextNode(x) : x));
  return n;
}
const button = (label, run, secondary = false) => el("button", {type:"button", class:secondary ? "secondary" : "primary", disabled:busy, onclick:run}, label);
async function update(action) {
  if (busy) return;
  busy = true; render();
  try {
    const r = await fetch(`api/${action || "state"}?lang=${language}`, action ? {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({revision:state.revision, choice}), signal:AbortSignal.timeout(35000)} : {signal:AbortSignal.timeout(35000)});
    if (!r.ok) throw new Error(r.status === 409 ? "changed" : "aws");
    const result = await r.json();
    if (result.correct === false) message = result.message;
    else {
      if (state?.revision !== result.revision) {hints = 0; choice = null;}
      state = result;
      message = action ? t("確認できました。仲間に何が変わったか伝えよう。", "Verified. Tell your teammates what changed.") : "";
    }
  } catch (e) {message = e.message === "changed" ? t("ラウンドが更新されました。「状況を更新」で確認してください。", "The round changed. Refresh the situation.") : t("AWSを確認できません。再試行して続く場合は運営者へ連絡してください。", "Could not check AWS. Retry; if it persists, contact the host.");}
  finally {busy = false; render();}
}
const resourceLabels = {
  region:["AWSの地域", "AWS Region"], serverName:["EC2の名前", "EC2 name"], publicIp:["公開IP", "Public IP"], vpcId:["拠点のVPC", "Site VPC"], subnetId:["サブネット", "Subnet"], gatewayId:["外への出口（IGW）", "Internet gateway"], routeTableId:["道案内（ルートテーブル）", "Route table"], instanceProfileName:["EC2に付けるIAMロール", "EC2 IAM role"], securityGroupId:["入口の許可（セキュリティグループ）", "Security group"],
};
function render() {
  app.replaceChildren(el("header", {class:"topbar"}, el("span", {class:"brand"}, "TENKACLOUD / RECOVERY BATTLE"), el("a", {href:`?lang=${language === "ja" ? "en" : "ja"}`}, language === "ja" ? "English" : "日本語")));
  const main = el("main");app.append(main);
  main.append(el("h1", {}, t("拠点をつなぎ続けろ", "Keep the sites connected")), el("p", {class:"lead"}, t("相談 → AWSで復旧 → 仲間へ説明。動かし続けた時間で競います。", "Discuss → recover on AWS → explain. Compete on time kept healthy.")));
  if (state?.mode === "preview") main.append(el("p", {class:"notice"}, t("画面用テストデータです。実AWSの操作・得点はありません。", "UI fixtures only. No real AWS operations or scoring.")));
  if (message) main.append(el("p", {class:"feedback", role:"status"}, message));
  if (!state) {main.append(button(t("読み込む", "Load"), () => update()));return;}
  main.append(el("p", {class:"team-note"}, t("最初にポータルのEndpoint登録へ HealthUrlHint を登録。正常な1分は+100点、不通・管理権限なしの1分は−100点。登録前は採点されません。", "First register HealthUrlHint in the portal’s health endpoint. A healthy minute earns +100; unreachable or missing management permissions costs 100. No scoring before registration.")));
  main.append(el("div", {class:"actions"}, button(t("状況を更新", "Refresh situation"), () => update(), true), el("span", {}, `${t("説明まで完了", "Reviewed")}: ${state.index} / ${state.total}`)));
  main.append(el("p", {class:"small"}, t("本戦は準備Challengeとは別のEC2・VPCです。操作するIDは「このチームの構成」と照合してください。", "This Battle has its own EC2 and VPC, separate from preparation. Match target IDs with This team’s resources.")));
  const left = el("section", {class:"mission"});const right = el("aside", {class:"resources"});main.append(el("div", {class:"workspace"}, left, right));
  if (state.index === state.total) left.append(el("h2", {}, t("4つの復旧をやりきった！", "All four recoveries complete!")), el("p", {}, t("最後まで接続を保ち、ポータルの得点を確認しよう。別の担当だった障害も、仲間に直し方を聞いてみよう。", "Keep the connection healthy and check the portal score. Ask teammates how they fixed the rounds they operated.")));
  else if (state.phase === "idle") left.append(el("h2", {}, t("次の障害を待っています", "Waiting for the next fault")), el("p", {}, t("運営者が一度に1つだけ開始します。ページを開き、4人の役割を決めておこう。操作・図の確認・手順の説明・結果の確認を交代します。", "The host starts one fault at a time. Open the page and assign roles: operator, diagram reader, explainer, and result checker.")));
  else if (["applying", "restoring"].includes(state.phase)) left.append(el("h2", {}, t("運営の処理中です", "Host operation in progress")), el("p", {}, t("障害の開始または自動復旧を処理しています。少し待ち、状況を更新してください。", "A fault is being started or restored. Wait briefly, then refresh.")));
  else {
    const r = state.round;
    left.append(el("p", {class:"eyebrow"}, `${t("操作担当", "Operator")} ${state.index + 1} / 4`), el("h2", {}, r.title), el("p", {class:"lead"}, r.symptom), el("p", {class:"route-map"}, r.diagram));
    if (state.phase === "active") {
      const consolePath = r.kind === "role" ? "ec2/home#Instances:" : r.kind === "http" ? "ec2/home#SecurityGroups:" : r.kind === "gateway" ? "vpcconsole/home#igws:" : "vpcconsole/home#RouteTables:";
      const url = `https://${state.resources.region}.console.aws.amazon.com/${consolePath.replace("#", `?region=${state.resources.region}#`)}`;
      left.append(el("a", {class:"console-link", href:url, target:"_blank", rel:"noopener noreferrer"}, t("AWSで直す ↗", "Repair in AWS ↗")), el("p", {}, t("先にポータルのAWS Console接続で、チームの権限に入ってください。", "First sign in with the team role through the portal’s AWS Console link.")), button(t("復旧できたか確かめる", "Check our recovery"), () => update("check")), el("p", {class:"small"}, t("未復旧が10分続くと自動復旧を始めます。確認は1分間隔で、前の復旧処理と重ねず、失敗時は最短3分後に再試行します。失った点は戻りません。", "Automatic recovery starts after 10 minutes. The watchdog checks each minute and prevents overlapping restores and retries failures after at least three minutes. Lost points are not refunded.")));
    } else {
      left.append(el("p", {class:"success"}, state.recoveredBy === "team" ? t("チームで復旧！ 理由を共有して次へ。", "Recovered by your team! Explain why before moving on.") : t("運営の復旧が入りました。直った理由を確認して次へ。", "Host recovery assisted this round. Review why it works before continuing.")), el("fieldset", {}, el("legend", {}, r.question), r.choices.map((text, index) => el("label", {class:"choice"}, el("input", {type:"radio", name:"choice", value:String(index), ...(choice === String(index) ? {checked:""} : {}), onchange:() => {choice = String(index);}}), el("span", {}, text)))), button(t("説明を確かめて、次のラウンドへ", "Check our explanation and finish this round"), () => update("explain")));
    }
    left.append(el("div", {class:"hint-area"}, button(t(`助け舟（無料） ${hints}/3`, `Free hint ${hints}/3`), () => {hints = Math.min(3, hints + 1);render();}, true), (state.phase === "active" ? r.hints : r.explanationHints).slice(0, hints).map(h => el("p", {}, h))));
  }
  right.append(el("h3", {}, t("このチームの構成", "This team’s resources")), el("a", {href:`http://${state.resources.publicIp}/`, target:"_blank", rel:"noopener noreferrer", class:"console-link"}, t("拠点のページを開く ↗", "Open the site page ↗")));
  const dl=el("dl");right.append(dl);
  for (const [key,value] of Object.entries(state.resources)) dl.append(el("dt", {}, t(...resourceLabels[key])), el("dd", {}, el("code", {}, String(value))));
  main.append(el("p", {class:"small"}, t("別端末でも同じGameUrlから同じラウンドを見られます。進捗と得点は別：説明だけで追加得点は入りません。", "The same GameUrl shows the same round on another device. Progress and points are separate: explanations do not award extra points.")));
}
update();
