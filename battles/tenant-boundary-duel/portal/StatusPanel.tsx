import { useEffect, useState } from "react";
import type { PortalSlotProps, PortalCoordinationClient } from "@tenkacloud/portal-plugin-sdk";
import type { Projection } from "../game/types.ts";
import "./style.css";

export function Game({
  client,
  locale = "ja",
}: {
  client: PortalCoordinationClient;
  locale?: "ja" | "en";
}) {
  const en = locale === "en",
    t = (ja: string, english: string) => (en ? english : ja);
  const [p, setP] = useState<Projection>();
  const [authorize, setAuthorize] = useState("actor.active"),
    [detect, setDetect] = useState("false");
  const [documentId, setDocumentId] = useState(""),
    [claim, setClaim] = useState("blue");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Record<string, unknown>>();
  function accept(next: Projection) {
    setP((prev) =>
      !prev ||
      next.revision > prev.revision ||
      (next.revision === prev.revision && next.now >= prev.now)
        ? next
        : prev,
    );
  }
  async function refresh() {
    try {
      const out = await client.getProjection();
      if (out.kind === "ok") accept(out.projection as Projection);
      else setError(out.kind);
    } catch {
      setError(
        t("通信を確認してください。再試行できます。", "Check the connection. You can retry."),
      );
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => clearInterval(timer);
  }, [client]);
  useEffect(() => {
    setAuthorize("actor.active");
    setDetect("false");
    setDocumentId("");
    setClaim("blue");
  }, [p?.round]);
  async function send(payload: Record<string, unknown>, retry = false) {
    if (!p || busy) return;
    setBusy(true);
    setError("");
    const op = retry ? payload : { ...payload, id: crypto.randomUUID(), revision: p.revision };
    setPending(op);
    try {
      const out = await client.submitOp(op);
      if (out.kind === "ok") {
        accept(out.projection as Projection);
        setPending(undefined);
      } else {
        setError(out.kind === "rejected" ? out.error : out.kind);
        setPending(undefined);
        await refresh();
      }
    } catch {
      setError(
        t(
          "結果が届きません。同じ操作を再送してください。",
          "Response lost. Retry the same operation.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  if (!p) return <p role="status">{error || t("読み込み中…", "Loading…")}</p>;
  const active = !busy && !pending;
  const chosen = documentId || p.documents[1]?.id || "";
  return (
    <main className="tenant-duel">
      <header>
        <small>TENKACLOUD · TENANT BOUNDARY</small>
        <h1>{t("テナント境界防衛戦", "Tenant Boundary Duel")}</h1>
        <p>
          {t(
            "あなたは架空の共有ノートの開発者。ログインできた人が、別の組織のノートまで変更できています。テナント＝データを分ける組織の単位。認可＝誰がどの操作をしてよいかの判断。2チームで攻撃役と防衛役を交代し、認可と検知の式を修正します。",
            "You develop a fictional shared notebook. A signed-in reader can change another organization's notes. A tenant is an organization whose data is kept separate. Authorization decides who may perform each action. Two teams swap attack and defense roles and repair authorization and detection expressions.",
          )}
        </p>
        <p>
          {t(
            "最初の一歩：両者が準備完了。攻撃役は Orange notebook を選び「読む」。ログの allowed（許可したか）と組織名、ノートの読取回数を比較してください。",
            "First move: both seats press Ready. The attacker selects Orange notebook and presses Read. Compare allowed (whether access succeeded), tenant names and the document's read count in the log.",
          )}
        </p>
        <p>
          {t(
            "合成データだけを使います。式は限定した文法で評価され、任意プログラム・実アカウント・外部通信は扱いません。",
            "Synthetic data only. Expressions use a bounded grammar; no arbitrary programs, real accounts or external traffic.",
          )}
        </p>
      </header>
      <div className="td-scores">
        {Object.entries(p.scores).map(([id, score]) => (
          <div key={id}>
            {p.names[id]}
            {id === p.me ? t("（自分）", " (you)") : ""}
            <strong>{score} pt</strong>
          </div>
        ))}
      </div>
      <p className="td-stage">
        {p.phase === "finished"
          ? t("試合終了", "Match finished")
          : `${t("ラウンド", "Round")} ${p.round} / 4 · ${p.role === "attacker" ? t("攻撃役", "Attacker") : t("防衛役", "Defender")}`}{" "}
        {p.deadline ? `· ${Math.max(0, Math.ceil((p.deadline - p.now) / 1000))}s` : ""}
      </p>
      {error && (
        <p role="alert">
          {t("操作を確認してください", "Check the operation")}: {error}
        </p>
      )}
      {pending && !busy && (
        <button onClick={() => void send(pending, true)}>
          {t("同じ操作を再送", "Retry same operation")}
        </button>
      )}
      {p.phase === "waiting" && (
        <section>
          <p>
            {t("準備完了した席", "Ready seats")}: {p.ready.length} / 2
          </p>
          <button
            disabled={!active || p.ready.includes(p.me)}
            onClick={() => void send({ kind: "ready" })}
          >
            {t("準備完了", "Ready")}
          </button>
        </section>
      )}
      {!["waiting", "finished"].includes(p.phase) && (
        <div className="td-grid">
          <section>
            <h2>
              {p.phase === "baseline"
                ? t("操作と証拠を比較", "Compare action and evidence")
                : p.phase === "patch"
                  ? t("認可と検知を実装", "Implement authorization and detection")
                  : t("再試験", "Retest")}
            </h2>
            <p>
              {t(
                "reader＝読む係、editor＝変更できる係。攻撃役の本人情報はサーバーが固定：active=true、tenant=blue、role=reader。組織の自己申告 request.tenant は自由に変えられます。",
                "A reader may read; an editor may edit. The server fixes the attacker's identity: active=true, tenant=blue, role=reader. The client claim request.tenant can be changed freely.",
              )}
            </p>
            <p>
              {p.round >= 3
                ? t(
                    "後半：Shared reading copy にはこの読者への閲覧委任があります。委任＝別組織が、特定の人とノートに読む操作だけを許すこと。",
                    "Later rounds: Shared reading copy has a read grant for this reader. Delegation permits a specific person to read a specific document across tenants.",
                  )
                : t(
                    "前半：ノートへの閲覧委任はありません。後半で条件を増やして同じ修正を試します。",
                    "Early rounds have no read grants. Later rounds add delegation and test the same repair.",
                  )}
            </p>
            {p.role === "attacker" && ["baseline", "retest"].includes(p.phase) && (
              <>
                <label>
                  {t("対象ノート", "Target document")}
                  <select
                    aria-label={t("対象ノート", "Target document")}
                    value={chosen}
                    onChange={(e) => setDocumentId(e.target.value)}
                  >
                    {p.documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title} · {d.tenant} · {d.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("自己申告の組織", "Claimed tenant")}
                  <select
                    aria-label={t("自己申告の組織", "Claimed tenant")}
                    value={claim}
                    onChange={(e) => setClaim(e.target.value)}
                  >
                    <option>blue</option>
                    <option>orange</option>
                  </select>
                </label>
                <p>
                  {t("残り試行券", "Attempts left")}: {p.tickets} / 4
                </p>
                <div className="td-buttons">
                  <button
                    disabled={!active || !p.tickets || p.attackFinished}
                    onClick={() =>
                      void send({
                        kind: "try",
                        documentId: chosen,
                        action: "read",
                        requestTenant: claim,
                      })
                    }
                  >
                    {t("読む", "Read")}
                  </button>
                  <button
                    disabled={!active || !p.tickets || p.attackFinished}
                    onClick={() =>
                      void send({
                        kind: "try",
                        documentId: chosen,
                        action: "edit",
                        requestTenant: claim,
                      })
                    }
                  >
                    {t("変更する", "Edit")}
                  </button>
                </div>
                <button
                  disabled={!active || !p.attempts || p.attackFinished}
                  onClick={() => void send({ kind: "finish" })}
                >
                  {p.phase === "baseline"
                    ? t("証拠を渡す", "Hand over evidence")
                    : t("攻撃の再試験を完了", "Finish attack retest")}
                </button>
              </>
            )}
            {p.phase === "patch" && p.role === "defender" && (
              <>
                <p>
                  {t(
                    "下のルールとログを読み、式を書き直します。「公開テスト」で結果を観察し、失敗した条件を修正してから適用してください。",
                    "Read the rules and logs below, then repair both expressions. Run Public tests, observe failed conditions and revise before deployment.",
                  )}
                </p>
                <label>
                  {t("認可式", "Authorization expression")}
                  <textarea
                    aria-label={t("認可式", "Authorization expression")}
                    value={authorize}
                    maxLength={1024}
                    onChange={(e) => setAuthorize(e.target.value)}
                    spellCheck={false}
                  />
                </label>
                <label>
                  {t("検知式", "Detection expression")}
                  <textarea
                    aria-label={t("検知式", "Detection expression")}
                    value={detect}
                    maxLength={1024}
                    onChange={(e) => setDetect(e.target.value)}
                    spellCheck={false}
                  />
                </label>
                <p>
                  {t("公開テスト回数", "Public tests used")}: {p.previews} / 8
                </p>
                <div className="td-buttons">
                  <button
                    disabled={!active || p.previews >= 8}
                    onClick={() => void send({ kind: "preview", authorize, detect })}
                  >
                    {t("公開テスト", "Public tests")}
                  </button>
                  <button
                    disabled={!active}
                    onClick={() => void send({ kind: "patch", authorize, detect })}
                  >
                    {t("修正を適用して再試験", "Deploy repair and retest")}
                  </button>
                </div>
                {p.preview && (
                  <ul aria-label={t("公開テスト結果", "Public test results")}>
                    {p.preview.map((c) => (
                      <li key={c.label}>
                        {c.passed ? "PASS" : "FAIL"} · {c.label}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {p.phase === "retest" && p.role === "defender" && (
              <>
                <p>
                  {t(
                    "相手が再試験する間に、未知の組織名・役割・停止済みの人・委任と自己申告の組合せで正規業務と境界を確認します。検知は過去の成功・拒否ログでも確認します。",
                    "While the attacker retests, check unseen tenants, roles, inactive actors, grants and client claims. Detection is also checked against historical successful and denied events.",
                  )}
                </p>
                <button
                  disabled={!active || p.checked}
                  onClick={() => void send({ kind: "check" })}
                >
                  {t("正規業務・境界・検知を再検証", "Recheck work, boundaries and detection")}
                </button>
              </>
            )}
            {p.checks && (
              <p role="status">
                {t("境界", "Safety")} {p.checks.safe}/{p.checks.safeTotal} · {t("正規業務", "Work")}{" "}
                {p.checks.work}/{p.checks.workTotal} · {t("検知", "Detection")} {p.checks.detect}/
                {p.checks.detectTotal} · {p.checks.failures.join("; ") || "PASS"}
              </p>
            )}
            {((p.phase === "baseline" && p.role === "defender") ||
              (p.phase === "patch" && p.role === "attacker") ||
              p.attackFinished) && (
              <p>
                {t(
                  "相手の操作を待っています。ログは自動更新されます。",
                  "Waiting for your partner. Logs update automatically.",
                )}
              </p>
            )}
          </section>
          <section>
            <h2>{t("ノートと操作ログ", "Documents and action log")}</h2>
            <p>
              {t("再試験の被害", "Retest damage")}: {p.damage} / 100
            </p>
            {p.documents.map((d) => (
              <p key={d.id}>
                {d.title} · tenant={d.tenant} · {t("読む", "reads")}={d.reads} ·{" "}
                {t("変更", "edits")}={d.edits} · grant={String(d.delegated)}
              </p>
            ))}
            <div className="td-log">
              {p.logs
                .filter((l) => l.round === p.round)
                .map((l, i) => (
                  <article key={i}>
                    <strong>
                      {l.action} · allowed={String(l.allowed)} ·{" "}
                      {l.damage ? `damage=+${l.damage}` : "damage=0"}
                    </strong>
                    <code>
                      actorTenant={l.actorTenant} → documentTenant={l.documentTenant};
                      requestTenant={l.requestTenant}; grantValid={String(l.grantValid)}; alert=
                      {String(l.alert)}
                    </code>
                  </article>
                ))}
            </div>
          </section>
        </div>
      )}
      <section>
        <h2>{t("開発するルールと式の文法", "Rules to implement and expression grammar")}</h2>
        <p>
          {t(
            "認可：停止していない人（actor.active）だけが操作できる。同じ組織では reader は読むだけ、editor は読む・変更する。別組織は読む操作に有効な閲覧委任（grant.valid）がある場合だけ許す。サーバーが本人・対象ノート・読む操作を固定し、このラウンド限定の委任を grant.valid で表す。自己申告 request.tenant は本人情報でもノートの所属でもない。",
            "Authorization: only active actors may act. Within a tenant, readers may read and editors may read or edit. Across tenants, permit only reading with a valid read grant. The server binds grants to this person, document and read action for this round, represented by grant.valid. request.tenant is a client claim, neither identity nor document ownership.",
          )}
        </p>
        <p>
          {t(
            "検知：過去のログで、許可された別組織への操作があり、有効な閲覧委任による読む操作ではないとき alert=true。拒否や正当な委任で警報を鳴らさない。",
            "Detection: alert when a historical event allowed cross-tenant access, unless it was reading with a valid grant. Denials and legitimate delegated reads must not alert.",
          )}
        </p>
        <p>
          {t(
            '式＝true（はい）か false（いいえ）を返す関数の中身。== は同じ、!= は違う、&& は両方、|| はどちらか、! は反対、括弧は先に判断。例：true && ("blue" == "blue") は true、true && false は false。&& は || より先に判断するので、括弧で意図を明示できます。',
            'An expression is a function body returning true or false. == means equal, != different, && both, || either, ! opposite, and parentheses group conditions. Example: true && ("blue" == "blue") is true; true && false is false. && binds before ||; use parentheses to express intent.',
          )}
        </p>
        <p>
          {t("認可の入力", "Authorization inputs")}:{" "}
          <code>
            actor.active, actor.tenant, actor.role, document.tenant, action, grant.valid,
            request.tenant
          </code>
          .{" "}
          {t(
            "role は reader / editor、action は read / edit。",
            "role is reader / editor; action is read / edit.",
          )}
        </p>
        <p>
          {t("検知の入力", "Detection inputs")}:{" "}
          <code>
            event.allowed, event.actorTenant, event.documentTenant, event.action, event.grantValid
          </code>
          .{" "}
          {t(
            "ループ・呼出し・代入はありません。文字列は二重引用符。最大1024文字、128語、括弧等の深さ16。",
            "No loops, calls or assignments. Strings use double quotes. Limits: 1024 characters, 128 tokens and nesting depth 16.",
          )}
        </p>
        <details>
          <summary>
            {t("無料の手がかり：仕組み → 例 → 手順", "Free clues: mechanism → example → procedure")}
          </summary>
          <ol>
            <li>
              {t(
                "本人確認は誰かを決める。認可はその人とノートの関係を調べる。自己申告を書き換えても本人の所属は変わらない。警報は過去に通った不正な越境を探す。",
                "Identity tells you who acts. Authorization checks their relationship to the document. Changing a claim does not change membership. Alerts find unauthorized cross-tenant successes in history.",
              )}
            </li>
            <li>
              {t(
                "blue の読者が orange を読む：組織の比較は false。有効な読む委任があれば別の経路で許す。停止中なら、どちらの経路も拒否。変更する操作に読む委任は使えない。",
                "A blue reader reading orange fails the same-tenant comparison. A valid read grant supplies another path; inactive actors must fail both paths. Read grants never permit editing.",
              )}
            </li>
            <li>
              {t(
                "認可式の actor.active と、document.tenant・actor.tenant の比較を組み合わせる。各許可経路を括弧で囲み、role と action を照合する。公開テストの FAIL を修正する。検知式は event.allowed と組織名の違いから始め、正当な委任の読む操作を除く。適用後は「再検証」を押し、正規業務が落ちていないか確認。",
                "Combine actor.active with the actor/document tenant comparison. Group each permission path and check role and action. Repair FAIL cases in Public tests. Start detection with event.allowed and different tenants, then exclude legitimate delegated reading. After deployment, recheck legitimate work.",
              )}
            </li>
          </ol>
        </details>
      </section>
      <section>
        <h2>{t("得点履歴と振り返り", "Score history and reflection")}</h2>
        <p>
          {t(
            "成功率＝成功した数÷確認した数。floor＝小数部分を捨てる。各段階180秒、4ラウンド。攻撃点は再試験で許可された不正な操作1種類につき25点、同じノートと操作は1回だけ、最大100。防衛点は floor(40×境界成功率 + 40×正規業務成功率 + 20×検知成功率) − 被害（最低0）。例：全検証成功で被害25なら75点。防衛点には対策前の試行・式の適用・相手の再試験完了・再検証がすべて必要。起動・待機・公開テストは0点。",
            "A rate is passes divided by cases; floor discards the fractional part. Each phase lasts 180 seconds across four rounds. Each unauthorized document/action pair allowed during retest earns 25 attack points, once only, up to 100. Defense points = floor(40×safety rate + 40×legitimate-work rate + 20×detection rate) − damage, minimum zero. Example: all checks pass with damage 25 → 75 points. Defense requires a baseline attempt, deployed expressions, completed attacker retest and explicit recheck. Startup, waiting and public tests award zero.",
          )}
        </p>
        {p.results.map((r) => (
          <article key={r.round}>
            <strong>
              R{r.round} · {p.names[r.defender]}: {r.defensePoints} / {p.names[r.attacker]}:{" "}
              {r.attackPoints}
            </strong>
            <p>
              {t("境界 / 正規業務 / 検知", "Safety / work / detection")}:{" "}
              {r.checks
                ? `${r.checks.safe}/${r.checks.safeTotal} · ${r.checks.work}/${r.checks.workTotal} · ${r.checks.detect}/${r.checks.detectTotal}`
                : t("未検証", "Unchecked")}{" "}
              · {r.completed ? "complete" : "incomplete"}
            </p>
            <code>{r.authorize}</code>
            <code>{r.detect}</code>
          </article>
        ))}
        {p.phase === "finished" && (
          <p>
            {t(
              "どのログが原因を示した？ 全拒否や自己申告だけの比較は何を壊した？ 読む委任が変更にも使えたら？ 次は保存・非同期処理・権限変更のどこで同じ関係を確認すべきか説明しよう。この模型のクリアは実組織の安全を保証しません。",
              "Which log identified the cause? What did deny-all or trusting client claims break? What if a read grant permitted edits? Explain where storage, asynchronous jobs and permission changes must enforce the same relationship. Clearing this model does not guarantee an organization's safety.",
            )}
          </p>
        )}
      </section>
    </main>
  );
}
export default function StatusPanel(props: PortalSlotProps) {
  if (!props.coordinationClient)
    return <p>{props.locale === "en" ? "Coordination unavailable" : "対戦機能が利用できません"}</p>;
  return <Game client={props.coordinationClient} locale={props.locale} />;
}
