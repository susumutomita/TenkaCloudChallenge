"use strict";
const lang = new URLSearchParams(location.search).get("lang") === "en" ? "en" : "ja";
document.documentElement.lang = lang;
const t = (ja, en) => lang === "en" ? en : ja;
const root = document.getElementById("app");
const key = `aws-intro:v1:${location.pathname}`;
let fieldValues = {};
let receipt = "", current = null, selected = null, hintCount = 0, pending = false, feedback = "", failed = false, storageAvailable = true;
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
  const r = await fetch(`api/${route}?lang=${lang}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(35000) });
  if (!r.ok) throw new Error(r.status === 403 ? "progress" : r.status === 503 ? "aws" : "network");
  return r.json();
}
function accept(result) {
  current = result; receipt = result.token; selected = null; hintCount = 0; fieldValues = {};
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
  if (current.phase === "explain" && selected === null) { feedback = t("相談して、答えを1つ選んでください。", "Discuss and choose one answer."); render(); return; }
  pending = true; feedback = ""; failed = false; render();
  try {
    const result = await request("check", { token: receipt, stage: current.stage, choice: selected, inputs: fieldValues });
    if (result.correct === true) { accept(result); feedback = current.phase === "explain" ? t("AWSの状態を確認できました。仲間に、何が変わったか伝えよう。", "AWS state verified. Tell your teammates what changed.") : t("ミッション達成！ 操作担当を交代しよう。", "Mission complete! Swap the operator."); }
    else { failed = true; feedback = [result.message, result.observation].filter(Boolean).join(" "); }
  } catch (e) { failed = true; feedback = e.message === "aws" ? t("AWSの確認処理でエラーが起きました。進捗はそのままです。再試行して続く場合は運営へ連絡してください。", "The AWS check failed. Progress is preserved. Retry; if it persists, contact the host.") : t("送信できません。入力は残しています。再試行してください。", "Could not submit. Your input is preserved. Retry."); }
  finally { pending = false; render(); document.getElementById("feedback")?.focus(); }
}
const resourceNames = {
  tableName: ["作成するテーブル名", "Table name to create"], queueName: ["作成するキュー名", "Queue name to create"], alarmName: ["作成するアラーム名", "Alarm name to create"], instanceId: ["監視するEC2のID", "EC2 instance to monitor"],
  functionName: ["実行する関数", "Function to run"], studentLogGroup: ["探すログの保存場所", "Log group to inspect"], testEvent: ["テスト用の入力（JSON）", "Test input (JSON)"],
  bucketName: ["バケット（保存場所）", "Bucket (storage)"], objectKey: ["ファイル名", "Object key (file name)"], fileContent: ["届けたい内容", "Intended content"],
  serverName: ["サーバー名（EC2のName）", "Server name (EC2 Name)"], publicIp: ["公開IP（サーバーの住所）", "Public IP (server address)"],
  namePrefix: ["チーム識別名（タグの値）", "Team identifier (tag value)"], region: ["リージョン（AWSの地域）", "AWS Region"],
  vpcId: ["VPC", "VPC"], subnetId: ["サブネット", "Subnet"], networkInterfaceId: ["ネットワーク接続口", "Network interface"],
  launchTemplateId: ["起動テンプレート", "Launch template"], instanceType: ["サーバーのサイズ", "Server size"], imageId: ["OSのイメージ", "OS image"],
  routeTableId: ["ルートテーブル", "Route table"], instanceProfileName: ["EC2に付けるロール", "Role to attach to EC2"],
  securityGroupId: ["セキュリティグループ", "Security group"], httpSourceCidr: ["HTTPを許可する接続元", "Allowed HTTP source"],
};
function consoleUrl(kind, resources) {
  const region = encodeURIComponent(resources.region);
  if (kind === "dynamodb") return `https://${resources.region}.console.aws.amazon.com/dynamodbv2/home?region=${region}#tables`;
  if (kind === "sqs") return `https://${resources.region}.console.aws.amazon.com/sqs/v3/home?region=${region}#/queues`;
  if (kind === "alarm") return `https://${resources.region}.console.aws.amazon.com/cloudwatch/home?region=${region}#alarmsV2:`;
  const paths = {launch: "ec2/home#LaunchTemplates:", instance: "ec2/home#Instances:", gateway: "vpcconsole/home#igws:", route: "vpcconsole/home#RouteTables:", security: "ec2/home#SecurityGroups:"};
  if (kind === "lambda") return `https://${resources.region}.console.aws.amazon.com/lambda/home?region=${region}#/functions/${encodeURIComponent(resources.functionName)}?tab=testing`;
  if (kind === "logs") return `https://${resources.region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/${encodeURIComponent(resources.studentLogGroup)}`;
  if (kind === "s3") return `https://s3.console.aws.amazon.com/s3/buckets/${encodeURIComponent(resources.bucketName)}?region=${region}&tab=objects`;
  const path = paths[kind];
  return path ? `https://${resources.region}.console.aws.amazon.com/${path.replace("#", `?region=${region}#`)}` : null;
}
function render() {
  root.replaceChildren(el("header", {class:"topbar"}, el("span", {class:"brand"}, "TENKACLOUD / AWS CHALLENGE"), el("a", {href:`?lang=${lang === "ja" ? "en" : "ja"}`}, lang === "ja" ? "English" : "日本語")));
  const main = el("main"); root.append(main);
  main.append(el("p", {class:"eyebrow"}, t("相談する → AWSで試す → 仲間へつなぐ", "DISCUSS → TRY ON AWS → HAND OVER")), el("h1", {}, current?.title || t("チームのミッション", "Your team's mission")));
  if (current?.mode === "preview") main.append(el("p", {class:"notice"}, t("画面検証用プレビューです。AWSの観測はテスト用データで、実AWSの操作・採点は行いません。", "UI preview only. AWS observations are test fixtures; no real AWS operations or official scoring.")));
  if (current?.evidence && Object.keys(current.evidence).length) main.append(el("p", {class:"success"}, Object.entries(current.evidence).map(([key,value]) => `${key}: ${value}`).join(" · ")));
  if (feedback) main.append(el("p", {id:"feedback", class:`feedback${failed ? " error" : ""}`, role:"status", tabindex:"-1"}, feedback));
  if (!storageAvailable) main.append(el("p", {class:"notice"}, t("進捗を保存できません。閉じる前に引き継ぎコードを控えてください。", "Progress cannot be stored. Keep a handoff code before closing.")));
  if (!current) { main.append(button(t("読み込み直す", "Retry loading"), () => restore()), button(t("最初から学ぶ", "Start again"), () => restore(""), "secondary")); return; }
  const missionIndex = Math.floor(current.stage / 2);
  main.append(el("ol", {class:"journey", "aria-label":t("進み具合", "Progress")}, current.steps.map((title, i) => el("li", {class:i < missionIndex ? "past" : i === missionIndex ? "active" : "", ...(i === missionIndex ? {"aria-current":"step"} : {})}, `${i < missionIndex ? "✓" : i + 1} ${title}`))));
  if (current.done) {
    main.append(el("section", {class:"celebration"}, el("h2", {}, t("チームでミッション達成！", "Mission accomplished together!")), el("p", {}, t("下の合言葉をコピーし、このChallengeのポータル回答欄へ提出してください。100点と完了の表示を確認しよう。準備Gateとして開催されている場合は、問題一覧を更新するとBattleへ進めます。", "Copy this passphrase and submit it to this Challenge's answer box in the portal. Check for 100 points and completion. If this is the event's preparation Gate, refresh the problem list to enter Battle.")), el("article", {class:"receipt"}, el("code", {}, current.flag), button(t("修了の合言葉をコピー", "Copy completion passphrase"), e => copy(current.flag, e)))));
  } else {
    const m = current.mission;
    main.append(el("p", {class:"team-note"}, t(`操作担当は${missionIndex % 4 + 1}人目。ほかの3人は、図を読む・次の一手を説明する・結果を確認する役です。`, `Teammate ${missionIndex % 4 + 1} operates. The other three read the diagram, explain the next action, and verify the result.`)));
    const box = el("section", {class:"mission"});
    const side = el("aside", {class:"resources", "aria-label":t("今回の対象", "Your resources")});
    main.append(el("div", {class:"workspace"}, box, side));
    box.append(el("p", {class:"eyebrow"}, `${missionIndex + 1} / ${current.total} · ${current.phase === "operate" ? t("AWSで試す", "TRY ON AWS") : t("仲間へ説明する", "EXPLAIN TO YOUR TEAM")}`), el("h2", {}, m.title), el("p", {class:"lead"}, m.goal));
    const link = consoleUrl(m.console, current.resources);
    if (current.phase === "operate" && link) box.append(el("a", {class:"console-link", href:link, target:"_blank", rel:"noopener noreferrer"}, t("AWSで操作する ↗", "Open AWS console ↗")));
    box.append(el("p", {class:"concept"}, m.concept));
    if (m.diagram) box.append(el("div", {class:"route-map", role:"img", "aria-label":m.diagram.join(" → ")}, m.diagram.flatMap((label, i) => [i ? el("b", {"aria-hidden":"true"}, "→") : null, el("span", {class:i === m.diagramFocus ? "focus" : ""}, label)])));
    if (current.phase === "operate") {
      box.append(el("ol", {class:"steps"}, m.steps.map(step => el("li", {}, step))), el("p", {class:"success"}, `✓ ${m.success}`));
      if (m.check === "s3-save") box.append(el("a", {href:"starter.txt", download:"handover.txt", class:"console-link"}, t("配布ファイルを保存", "Download the supplied file")));
      for (const input of m.inputs || []) {
        const control = el("input", {id:`answer-${input.key}`, type:"text", value:fieldValues[input.key] || "", maxlength:"256", autocomplete:"off", disabled:pending, oninput:e => {fieldValues[input.key] = e.target.value;}});
        box.append(el("label", {class:"answer-field", for:`answer-${input.key}`}, input.label, control));
      }
      box.append(el("div", {class:"actions"}, button(pending ? t("AWSを確認中…", "Checking AWS…") : t("操作できたか確かめる", "Check my AWS changes"), submit)));
      box.append(el("p", {class:"small"}, t("先にポータルの「AWS Consoleを開く」でチームの権限へ接続してください。上のリンクはAWSの画面を開きます。", "First use Open AWS Console in the portal to sign in with your team's role. The link above opens the relevant AWS screen.")));
    } else {
      box.append(el("fieldset", {}, el("legend", {}, m.question), el("div", {class:"choices"}, m.choices.map((label, i) => el("label", {class:"choice"}, el("input", {type:"radio", name:"choice", value:String(i), ...(selected === String(i) ? {checked:""} : {}), disabled:pending, onchange:() => {selected = String(i);}}), el("span", {}, label))))), button(pending ? t("確認中…", "Checking…") : t("相談した答えを確かめる", "Check our answer"), submit));
    }
    box.append(el("div", {class:"hint-area"}, button(t(`助け舟（無料） ${hintCount}/3`, `Free hint ${hintCount}/3`), () => {hintCount = Math.min(3, hintCount + 1); render();}, "secondary"), (current.phase === "operate" ? m.hints : m.explanationHints).slice(0, hintCount).map(h => el("p", {}, h))));
    side.append(el("h3", {}, t("自分のチームのものを選ぶ", "Choose your team's resources")), el("p", {class:"small"}, t("同じ名前のものがあっても、IDとリージョンを照合しよう。", "Match the IDs and Region, even if names look similar.")));
    const dl = el("dl"); side.append(dl);
    if (m.check === "http" && current.resources.publicIp) side.append(el("p", {}, el("a", {href:`http://${current.resources.publicIp}/`, target:"_blank", rel:"noopener noreferrer"}, t("チームのページを開く ↗", "Open the team page ↗"))));
    for (const key of ["region", ...m.resourceKeys]) {
      if (current.resources[key] !== undefined) dl.append(el("dt", {}, resourceNames[key] ? t(...resourceNames[key]) : key), el("dd", {}, el("code", {}, String(current.resources[key]))));
    }
    side.append(el("p", {class:"boundary"}, t("この画面での確認・助け舟は無料。すべて達成したら、最後に1つの合言葉を提出して得点します。", "Checks and hints here are free. Finish every mission, then submit one passphrase for points.")), el("a", {href:m.source, target:"_blank", rel:"noopener noreferrer", class:"small"}, t("AWS公式の手順 ↗", "AWS official instructions ↗")));
  }
  const input = el("input", {id:"handoff", autocomplete:"off", maxlength:"100", disabled:pending});
  main.append(el("details", {class:"handoff"}, el("summary", {}, t("別の端末へ担当を交代する", "Hand over to another device")), el("p", {}, t("同じ端末なら人だけ交代。別端末では同じGameUrlを開き、このコードで続きを受け取ります。得点用の合言葉とは別です。チーム内だけで共有してください。", "On the same device, swap people. On another device, open the same GameUrl and import this code. It is not a scoring passphrase. Share only within your team.")), receipt ? el("article", {class:"receipt"}, el("code", {}, receipt), button(t("引き継ぎコードをコピー", "Copy handoff code"), e => copy(receipt, e), "secondary")) : null, el("label", {for:"handoff"}, t("仲間から受け取ったコード", "Code from your teammate")), input, button(t("続きを受け取る", "Resume from code"), () => restore(input.value.trim()), "secondary")));
}
restore();
