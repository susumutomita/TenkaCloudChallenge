import { useEffect, useState } from "react";
import type { PortalSlotProps, PortalCoordinationClient } from "@tenkacloud/portal-plugin-sdk";
import type { Action, Control, Projection } from "../game/types.ts";
import "./style.css";

const actions: Record<Action,[string,string,number]> = {
  addAdmin:["架空の管理者を追加","Add fictional admin",40], unlink:["ダミー顧客のリンクを解除","Unlink dummy customer",30],
  export:["ダミー顧客表を持ち出す","Export dummy customer list",20],spend:["模擬広告の予算を変更","Change simulated ad budget",10],
};
const controls: Record<Control,[string,string,number,string,string]> = {
  revoke:["今あるセッションを失効","Revoke existing sessions",2,"今あるログイン済みの証拠をサーバーで無効にする。後で発行される証拠には届かない。","Invalidate existing login evidence on the server; future evidence is unaffected."],
  stepUp:["重要操作で追加本人確認","Require fresh owner authorization",3,"管理者追加・リンク解除・予算変更のたびに、本人用の別経路で短時間の操作限定許可を発行する。顧客表の閲覧は対象外。","Admin changes, unlinking and spending need a short-lived, action-bound owner grant. Export is outside this policy."],
  approval:["管理操作は別担当者も承認","Require a separate reviewer",2,"管理者追加・リンク解除は、別担当者の操作限定許可も必要。顧客表と予算変更は対象外。誤った承認や両担当者の侵害は別の危険。","Admin changes and unlinking also need a reviewer grant. Export and spending remain outside this policy; mistaken approval or compromise of both principals is a separate risk."],
  leastPrivilege:["普段の役割は担当者に限定","Reduce everyday privileges",2,"管理者追加・リンク解除を禁止。顧客表の閲覧と予算変更は担当者の仕事として許可。","Deny admin changes and unlinking; export and spending remain normal operator duties."],
  shortTTL:["証拠の期限を15秒に短縮","Expire evidence after 15 seconds",1,"対策を適用してから最大15秒で演習用証拠が切れる。期限前に使われた操作は戻らない。","Lab evidence expires at most 15 seconds after deployment; actions before expiry are not undone."],
  strongLogin:["初回ログインを強化","Strengthen initial login",1,"パスキーの働きを模型で表す。パスキー自体は未実装。発行済みの証拠に追加条件は付かない。","Models a passkey-protected initial login. No passkey implementation; issued evidence gains no extra condition."],
  httpOnly:["HttpOnlyを設定","Set HttpOnly",1,"HttpOnly＝ページのJavaScriptからCookieを読み取らせない設定。このゲームは既に渡された証拠を使うため、その再利用には影響しない。端末侵害を防ぐ万能策ではない。","HttpOnly prevents page JavaScript from reading a cookie. It does not stop reuse of evidence already supplied here, or protect against every device compromise."],
};
const results: Record<string,[string,string]> = {
  executed:["実行された","Executed"],revoked:["失効済み","Revoked"],expired:["期限切れ","Expired"],invalid_session:["この演習の証拠ではない","Invalid lab session"],
  role_denied:["担当者の権限ではできない","Role denied"],reauth_required:["本人の新しい操作限定許可が必要","Fresh owner grant required"],approval_required:["別担当者の承認が必要","Reviewer grant required"],
  already_changed:["既に変更済み・追加被害なし","Already changed; no extra damage"],legitimate_success:["正規の担当者は操作を完了","Legitimate operation succeeded"],controls_applied:["対策を適用","Controls deployed"],
  reviewer_success:["別担当者の操作限定承認で正規の管理操作が通った","Reviewer grant authorized a legitimate admin change"],
  baseline_complete:["対策前の観察を完了","Baseline observation complete"],baseline_timeout:["対策前の時間終了","Baseline time ended"],
  no_controls_timeout:["選択時間終了・対策なしで再試験","Selection time ended; retest with no controls"],waiting_for_legitimate:["正規の仕事の確認を待つ","Waiting for legitimate work check"],
  submitted:["ラウンドの精算完了","Round settled"],timeout:["時間終了で精算","Settled on timeout"],legitimate_failed:["正規の仕事が拒否された","Legitimate work denied"],
};
const eventNames:Record<string,[string,string]>={finish:["試験終了","Finish test"],defend:["防衛設定","Deploy defense"],legitimate:["正規の仕事","Legitimate work"],reviewed_admin:["承認付きの管理操作","Reviewed admin operation"],settle:["得点精算","Score settlement"]};
export function Game({client,locale="ja"}:{client:PortalCoordinationClient;locale?:"ja"|"en"}) {
  const en=locale==="en", t=(ja:string,english:string)=>en?english:ja;
  const [p,setP]=useState<Projection>();const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  const [token,setToken]=useState("");const [selected,setSelected]=useState<Control[]>([]);
  const [pending,setPending]=useState<Record<string,unknown>>();
  const accept=(next:Projection)=>setP(prev=>!prev||next.revision>prev.revision||(next.revision===prev.revision&&next.now>=prev.now)?next:prev);
  const refresh=async()=>{try {const out=await client.getProjection();if(out.kind==="ok")accept(out.projection as Projection);else setError(out.kind);}catch{setError(t("通信に失敗しました。再試行できます。","Connection failed. You can retry."));}};
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),1000);return()=>clearInterval(timer);},[client]);
  useEffect(()=>{setToken("");setSelected([]);},[p?.round,p?.phase]);
  async function send(payload:Record<string,unknown>, retry=false) {
    if(!p || busy)return;setBusy(true);setError("");
    const op=retry?payload:{...payload,id:crypto.randomUUID(),revision:p.revision};setPending(op);
    try {const out=await client.submitOp(op);if(out.kind==="ok"){accept(out.projection as Projection);setPending(undefined);}else{setError(out.kind==="rejected"?out.error:out.kind);setPending(undefined);await refresh();}}
    catch{setError(t("結果が届きませんでした。同じ操作を再送できます。","Response lost. Retry the same operation."));}
    finally{setBusy(false);}
  }
  if(!p)return <div className="session-defense"><p role="status">{error || t("演習を読み込み中…","Loading lab…")}</p></div>;
  const active=!busy&&!pending, remaining=Math.max(0,Math.ceil((p.deadline-p.now)/1000));
  const c=selected.reduce((n,k)=>n+controls[k][2],0);
  return <main className="session-defense">
    <header><div className="sd-kicker">TENKACLOUD · SESSION DEFENSE</div><h1>{t("セッション防衛戦","Session Defense Arena")}</h1>
      <p>{t("架空の広告管理室を守る2人対戦。セッション＝ログイン後に続けて使える状態。その証拠となる演習用の合言葉を使い、被害を確認し、予算6で対策を組み直します。","A two-player fictional ad desk. A session is the continuing state after login. Reuse supplied lab evidence, observe damage, and defend with a budget of 6.")}</p>
      <p className="sd-boundary">{t("Cookie＝ブラウザが保存して送る小さなデータ。ここでは実アカウント・実Cookie・外部サイトを使いません。実際の事件の侵入経路を再現したものではありません。","A cookie is a small data item a browser stores and sends. No real accounts, cookies or external targets are used. This does not reconstruct any incident's entry path.")}</p></header>
    <div className="sd-scoreboard">{Object.entries(p.scores).map(([id,score])=><div key={id}><span>{p.names[id]}{id===p.me?t("（自分）"," (you)"):""}</span><strong>{score}<small> pt</small></strong></div>)}</div>
    <div className="sd-stage"><strong>{p.phase==="finished"?t("終了","Finished"):`${t("ラウンド","Round")} ${p.round} / 4 · ${p.role==="attacker"?t("攻撃役","Attacker"):t("防衛役","Defender")}`}</strong><span>{p.deadline?`${remaining}${t("秒","s")}`:""}</span></div>
    {error && <p role="alert" className="sd-error">{error}</p>}
    {pending && !busy && <button onClick={()=>void send(pending,true)}>{t("同じ操作を再送","Retry same operation")}</button>}
    {p.phase==="waiting" && <section><h2>{t("最初の一歩","First move")}</h2><p>{t("両者が準備完了したら、攻撃役は「演習用の証拠を入力へコピー」→管理操作を1つ試す。防衛役は右側の被害記録を見ます。各段階は75秒。ラウンドごとに役割を交代します。","After both seats are ready, the attacker copies the supplied lab evidence and tries one management operation. The defender watches the damage log. Each phase lasts 75 seconds; roles swap each round.")}</p>
      <p>{t("準備完了した席","Ready seats")}: {p.ready.length} / 2</p><button disabled={!active||p.ready.includes(p.me)} onClick={()=>void send({kind:"ready"})}>{p.ready.includes(p.me)?t("相手を待っています","Waiting for partner"):t("準備完了","Ready")}</button></section>}
    {p.phase!=="waiting"&&p.phase!=="finished"&&<div className="sd-grid"><section>
      <h2>{p.phase==="baseline"?t("試す → 被害を確認","Try → observe damage"):p.phase==="configure"?t("予算6で対策を選ぶ","Choose controls within 6"):t("再試験","Retest")}</h2>
      <p>{p.lateLeak?t("今回は対策を適用した後の新しい証拠も演習内で渡されます。","This round also supplies fresh evidence issued after controls are deployed."):t("今回は対策を適用する前の証拠だけが渡されます。","This round supplies only evidence issued before defense.")}</p>
      {p.phase==="configure"&&p.role==="defender"?<><p>{t("予算は対策の重さ。被害を減らし、正規の仕事も通してください。","Budget measures operational cost. Minimize damage while allowing legitimate work.")}</p>
        <div className="sd-controls">{(Object.keys(controls) as Control[]).map(k=><label key={k}><input type="checkbox" checked={selected.includes(k)} onChange={()=>setSelected(selected.includes(k)?selected.filter(x=>x!==k):[...selected,k])}/><span><strong>{controls[k][en?1:0]} · {controls[k][2]}</strong><small>{controls[k][en?4:3]}</small></span></label>)}</div>
        <p>{t("使用予算","Budget")}: {c} / 6</p><button disabled={!active||c>6} onClick={()=>void send({kind:"defend",controls:selected})}>{t("この対策で再試験へ","Deploy and retest")}</button></>:null}
      {p.role==="attacker"&&["baseline","contest"].includes(p.phase)?<>
        <p>{t("証拠の取得は演習が代行済みです。入力した証拠をサーバーが照合します。初回の本人確認を突破する操作はありません。","The exercise supplies the evidence; the server checks what you enter. You do not break the initial login.")}</p>
        <div className="sd-evidence"><strong>{t("演習用の漏えい証拠","Supplied lab evidence")}</strong><code>{p.leak}</code><button onClick={()=>setToken(p.leak??"")}>{t("演習用の証拠を入力へコピー","Copy lab evidence to input")}</button></div>
        <label className="sd-token">{t("試す証拠","Evidence to try")}<input aria-label={t("試す証拠","Evidence to try")} value={token} maxLength={100} onChange={e=>setToken(e.target.value)} placeholder="lab_session_…"/></label>
        <p>{t("残り試行券","Attempts left")}: {p.tickets} / 4</p>
        <div className="sd-actions">{(Object.keys(actions) as Action[]).map(k=><button key={k} disabled={!active||!token||!p.tickets||p.attackFinished} onClick={()=>void send({kind:"try",action:k,token})}>{actions[k][en?1:0]}<small>{t("被害","Damage")} {actions[k][2]}</small></button>)}</div>
        <button className="sd-secondary" disabled={!active||p.attackFinished||(p.phase==="baseline"&&p.tickets===4)} onClick={()=>void send({kind:"finish"})}>{p.attackFinished?t("正規の仕事の確認を待っています","Waiting for legitimate work check"):p.phase==="baseline"?t("被害を確認した・防衛役へ","Observed damage; hand over"):t("このラウンドを精算","Settle round")}</button>
      </>:null}
      {p.phase==="contest"&&p.role==="defender"?<><p>{t("相手の再試験を見ながら、正規の担当者も模擬予算を変更できるか確認します。本人用の別経路が、短時間の操作限定許可をサーバー内で発行し、一度だけ使います。パスキーは模型です。承認を選んだ場合は、別担当者の模型で管理者追加も確認します。普段の役割で管理操作を禁止していれば、承認があっても拒否されます。","While your opponent retests, check legitimate spending. A separate owner channel issues and consumes a short-lived, single-use server grant; passkeys are simulated. With reviewer approval enabled, a simulated distinct reviewer also authorizes a legitimate admin change. An everyday role restriction still denies it.")}</p><button disabled={!active||p.legitimate} onClick={()=>void send({kind:"legitimate"})}>{p.legitimate?t("正規の仕事も通った","Legitimate work succeeded"):t("正規の担当者で仕事を確認","Check legitimate work")}</button></>:null}
      {(p.phase==="baseline"&&p.role==="defender"||p.phase==="configure"&&p.role==="attacker")&&<p>{t("相手の操作を待っています。記録は自動更新されます。","Waiting for partner. The log updates automatically.")}</p>}
    </section><section><h2>{t("架空管理室の被害記録","Fictional desk damage log")}</h2><div className="sd-damage"><span>{t("対策前","Before defense")}<strong>{p.baselineDamage}</strong></span><span>{t("再試験","Retest")}<strong>{p.damage}</strong></span></div>
      <p>{t("通った操作はダミーデータだけを変更。同じ操作を繰り返しても追加の被害点は付きません。再試験は元のダミーデータから開始します。","Executed operations affect only dummy data. Repeated identical actions add no damage. Retesting starts from clean dummy data.")}</p>
      <dl><dt>{t("架空の管理者","Fictional admins")}</dt><dd>{p.desk.admins.join(", ")}</dd><dt>{t("ダミー顧客のリンク","Dummy customer link")}</dt><dd>{p.desk.customerLinked?t("接続中","Connected"):t("解除された","Unlinked")}</dd><dt>{t("持ち出した表の数","Exported copies")}</dt><dd>{p.desk.exportedCopies}</dd><dt>{t("模擬広告予算","Simulated ad budget")}</dt><dd>{p.desk.adBudget}</dd></dl>
      <ul className="sd-log">{p.events.filter(e=>e.round===p.round).map((e,i)=><li key={i}><span>{actions[e.action as Action]?.[en?1:0]??eventNames[e.action]?.[en?1:0]??e.action}</span><strong>{results[e.result]?.[en?1:0]??e.result}{e.damage?` · +${e.damage}`:""}</strong></li>)}</ul>
    </section></div>}
    <section><h2>{t("得点とラウンドの比較","Score and round comparison")}</h2><p>{t("攻撃点＝再試験での被害。防衛点＝100−被害−使用予算×3−正規の仕事が未確認なら20（最低0）。例：被害20、予算4、仕事成功なら68点。待機と対策前の操作は0点。","Attack points = retest damage. Defense points = max(0, 100 − damage − budget × 3 − 20 if legitimate work was not checked). Example: damage 20, cost 4, work succeeds → 68 points. Waiting and baseline moves award zero.")}</p>
      {p.results.map(r=><p key={r.round}>R{r.round} · {p.names[r.defender]}: {r.defensePoints} / {p.names[r.attacker]}: {r.attackPoints} · {t("被害","damage")} {r.damage} · {t("対策","controls")}: {r.controls.map(c=>controls[c][en?1:0]).join(" / ")||t("なし","none")}</p>)}</section>
    <section><details><summary>{t("無料の手がかり","Free clues")}</summary><p>{t("1 · 仕組み：初回ログインは本人かを確かめます。その後は証拠を照合します。記録で『実行された』と『失効済み』などを比べてください。","1 · Mechanism: initial login checks who you are; later requests present evidence. Compare executed and denied results in the log.")}</p><p>{t("2 · 小さい例：被害が30から20へ減り、予算を1使ったなら、防衛点は10−3＝7増えます。正規の仕事が通るかも一緒に確認します。","2 · Small example: reducing damage from 30 to 20 at a cost of 1 improves defense points by 10 − 3 = 7. Check that legitimate work still succeeds.")}</p><p>{t("3 · 手順：攻撃役は演習用の証拠をコピーして管理操作を試す。防衛役は記録と各対策の説明から組合せを選ぶ。再試験では同じ操作の結果と、正規の仕事の結果を比較する。","3 · Procedure: the attacker copies the lab evidence and tries an operation. The defender reads the log and control descriptions, then chooses a combination. Compare the same operation and legitimate work in the retest.")}</p></details></section>
    <section><details><summary>{t("端末に結び付ければ、コピーされたCookieは使えない？","Can device binding stop copied cookies?")}</summary>
      <p>{t("DBSC（端末鍵でセッション更新を保護する仕組み）は、短期限のCookieを更新するとき、元の端末にある秘密鍵で証明させます。秘密鍵＝許可の証明を作る秘密の値。Cookieだけを別端末へコピーしても更新を続けられません。ただし、期限が残る間の利用や、対応ブラウザ・サービスの保護対象・強制条件は別に確認が必要です。このゲームはDBSC未実装で、15秒の期限だけをDBSCとは呼びません。","Device Bound Session Credentials (DBSC) require proof from a key held on the original device to renew short-lived cookies. A private key is a secret value used to create authorization proofs. Copying cookies alone does not allow continued renewal elsewhere. An unexpired-cookie window, browser support, protected service scope and enforcement still matter. This game does not implement DBSC; a 15-second expiry alone is not DBSC.")}</p>
      <p>{t("元の端末上でログイン済みブラウザや鍵の機能を使われる危険は残ります。DBSCは端末が健全であることや、特定の管理端末であることの保証ではありません。端末管理がなかったから実事件が起きた、とも断定できません。実際の端末侵害やCookie読取は実装していません。","Activity through the authenticated browser or key on the original device remains a risk. DBSC does not guarantee device health or the identity of a particular managed device. The real incident cannot be attributed to absent device management from this evidence. No actual device compromise or cookie reading is implemented.")}</p>
      <p><a href="https://developer.chrome.com/docs/web-platform/device-bound-session-credentials">{t("Chromeの仕組み説明","Chrome mechanism guide")}</a> · <a href="https://w3c.github.io/webappsec-dbsc/#non-goals">{t("W3Cの非目標","W3C non-goals")}</a></p>
    </details></section>
    {p.phase==="finished"&&<section><h2>{t("リプレイから何が分かる？","What does the replay show?")}</h2><p>{t("初回ログインの本人確認を強くしても、その後に使う証拠が再利用可能なら権限を使われます。失効は今ある証拠を止め、追加本人確認は指定した重要操作を止めます。承認と権限分離も対象外の操作は守りません。期限を短くしても期限前の被害は残ります。この模型は実サービスの安全性を検証しません。","A strong initial login does not prevent reuse of issued bearer evidence. Revocation stops existing evidence; fresh owner checks protect specified operations. Approval and role separation leave out-of-scope actions available. Short expiry does not undo damage before expiry. This model does not validate a real service's security.")}</p><details><summary>{t("4ラウンドの操作記録","Four-round replay")}</summary><ul className="sd-log">{p.events.map((e,i)=><li key={i}>R{e.round} · {p.names[e.actor]} · {actions[e.action as Action]?.[en?1:0]??eventNames[e.action]?.[en?1:0]??e.action} · {results[e.result]?.[en?1:0]??e.result} · {e.damage}</li>)}</ul></details></section>}
  </main>;
}
export default function StatusPanel(props:PortalSlotProps) {
  if(!props.coordinationClient)return <div className="session-defense">{props.locale==="en"?"Host coordination client is not configured.":"本体の競技接続が設定されていません。"}</div>;
  return <Game key={`${props.problemId}:${props.jobId}:${props.team.teamId??""}`} client={props.coordinationClient} locale={props.locale}/>;
}
