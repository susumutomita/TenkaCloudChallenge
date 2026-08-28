/**
 * The Browser Workbench (Issue 470).
 *
 * Same discipline as `agent-approval-gameday`'s workbench: plain HTML forms posting to
 * ordinary routes, no inline `<script>` anywhere. That sidesteps the exact defect class
 * that took out the StackStack API console (a `\n` inside an inline script inside an
 * outer template literal getting eaten by the outer literal — Issue 395) by having no
 * inline script to carry the hazard, and it means every action here works the same way
 * an MCP-less participant would use it: read the page, fill a form, submit.
 *
 * All links are relative — local play reassigns the published port when the default is
 * taken (Issue 399), so nothing here is allowed to hardcode 18080/18081.
 */

import { CHECKPOINTS, POINTS, posture } from "./scoring.mjs";
import { renderPrometheus, businessHealth } from "./metrics.mjs";
import { queryLogs, renderLogLine } from "./logs.mjs";
import { currentPhase, impactBudgetRemaining, POOL_SIZE } from "./world.mjs";
import { MECHANISMS } from "./incident.mjs";

const DEPENDENCY_CHOICES = ["payment-gateway", "billing-service", "card-processor", "settlement-api"];
const MECHANISM_DECOYS = ["database-lock-contention", "memory-leak", "dns-resolution-failure"];

export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

const STYLE = `
:root { color-scheme: light dark; }
body { font-family: system-ui, sans-serif; max-width: 68rem; margin: 2rem auto; padding: 0 1rem;
       line-height: 1.65; background: Canvas; color: CanvasText; }
nav a { margin-right: 1rem; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
th, td { border: 1px solid GrayText; padding: .4rem .6rem; text-align: left; vertical-align: top; }
code, pre { background: color-mix(in srgb, CanvasText 8%, Canvas); padding: .1rem .3rem; border-radius: .25rem; }
pre { padding: .8rem; overflow-x: auto; white-space: pre-wrap; }
fieldset { margin: 1rem 0; border: 1px solid GrayText; border-radius: .4rem; }
label { display: block; margin-top: .6rem; }
input, textarea, select { box-sizing: border-box; width: 100%; padding: .45rem; font: inherit;
       background: Canvas; color: CanvasText; border: 1px solid GrayText; border-radius: .25rem; }
button { margin-top: .8rem; padding: .5rem 1rem; font: inherit; }
.warn { border-left: .3rem solid #d97706; padding-left: .8rem; }
.ok { border-left: .3rem solid #16a34a; padding-left: .8rem; }
.gate-true::before { content: "OK "; }
.gate-false::before { content: "-- "; }
.checkbox-row { display: flex; align-items: center; gap: .5rem; }
.checkbox-row input { width: auto; }
`;

function page(title, body) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style></head>
<body>
<nav>
<a href="./">概要</a><a href="./build">Build</a><a href="./alerts">アラート</a>
<a href="./telemetry">テレメトリ</a><a href="./logs">ログ</a><a href="./evidence">証跡</a>
<a href="./incident">Incident Room</a><a href="./scoreboard">スコア</a>
</nav>
<h1>${escapeHtml(title)}</h1>
${body}
</body></html>`;
}

function phaseBanner(world) {
  const phase = currentPhase(world);
  const label = { build: "Build", calibrate: "Calibrate", incident: "Incident", stabilize: "Stabilize" }[phase];
  const explain = {
    build: "サービスは正常稼働中です。監視・耐障害性を実装してください。",
    calibrate: "ベニンイベント (無害な揺れ) を流します。誤検知するアラートをここで調整してください。",
    incident: "インシデントが発生している可能性があります。異常に気づけますか。",
    stabilize: "収束を確認する時間です。SLO が本当に戻ったか確認してから resolve してください。",
  }[phase];
  return `<p class="warn"><strong>Phase: ${label}</strong> (tick ${world.tick}) — ${escapeHtml(explain)}</p>`;
}

export function dashboardPage(world, notice = "") {
  const p = posture(world);
  const body = `
${notice}
${phaseBanner(world)}
<p>現在のスコア: <strong>${p.score} / ${p.maxScore}</strong>。checkpoint の受領証は「スコア」ページにあります。</p>
<p>顧客影響バジェット残り: <strong>${impactBudgetRemaining(world).toFixed(1)} / 1000</strong>（発火後に減り続け、回復しません）。</p>
<p>正常な注文を試すには <code>POST /orders</code> を、状態確認用の読み取りには <code>GET /order-status</code> を叩いてください。どちらも実際のトラフィックとして記録されます。</p>
<ul>
<li><a href="./build">Build</a> — resilience / observability の設定</li>
<li><a href="./alerts">アラート</a> — ルールの作成・一覧</li>
<li><a href="./telemetry">テレメトリ</a> — 現在の /metrics と business health</li>
<li><a href="./logs">ログ</a> — 直近のログ行</li>
<li><a href="./evidence">証跡</a> — capability が捕まえた証跡</li>
<li><a href="./incident">Incident Room</a> — declare / assign / fact / hypothesis / action / update / resolve</li>
<li><a href="./scoreboard">スコア</a> — checkpoint ごとの受領証</li>
</ul>
<form method="post" action="./reset"><button type="submit">reset (新しい試行を始める)</button></form>
`;
  return page("見えるものしか守れない — 概要", body);
}

export function buildPage(world, notice = "") {
  const r = world.config.resilience;
  const o = world.config.observability;
  const checkbox = (checked) => (checked ? "checked" : "");
  const body = `
${notice}
${phaseBanner(world)}
<h2>Resilience — payment-gateway 呼び出しの制御</h2>
<p>この値は実際の挙動を変えます。長い timeout と多い retry は、依存先が詰まったときに共有 pool を使い果たします。</p>
<form method="post" action="./build/resilience">
<label>timeoutMs (200-60000)<input type="number" name="timeoutMs" value="${r.timeoutMs}" min="200" max="60000"></label>
<label>maxRetries (0-20)<input type="number" name="maxRetries" value="${r.maxRetries}" min="0" max="20"></label>
<div class="checkbox-row"><input type="checkbox" name="cbEnabled" id="cbEnabled" ${checkbox(r.circuitBreaker.enabled)}><label for="cbEnabled">circuit breaker を有効化</label></div>
<label>failureThreshold (連続失敗数, 1-50)<input type="number" name="cbFailureThreshold" value="${r.circuitBreaker.failureThreshold}" min="1" max="50"></label>
<label>cooldownMs (1000-120000)<input type="number" name="cbCooldownMs" value="${r.circuitBreaker.cooldownMs}" min="1000" max="120000"></label>
<button type="submit">保存</button>
</form>

<h2>Observability — 何を見えるようにするか</h2>
<p>ここは「見せる／見せない」の切り替えです。数値そのものは常に本物で、後から偽ることはできません。ただし on にした瞬間より前の事実は、後から遡って見えるようにはなりません。</p>
<form method="post" action="./build/observability">
<div class="checkbox-row"><input type="checkbox" name="byRoute" id="byRoute" ${checkbox(o.redMetrics.byRoute)}><label for="byRoute">route 別のメトリクスを出す (checkout / order-status)</label></div>
<div class="checkbox-row"><input type="checkbox" name="byStatus" id="byStatus" ${checkbox(o.redMetrics.byStatus)}><label for="byStatus">status 別 (成功 / 失敗) のメトリクスを出す</label></div>
<div class="checkbox-row"><input type="checkbox" name="dependencyMetrics" id="dependencyMetrics" ${checkbox(o.dependencyMetrics)}><label for="dependencyMetrics">依存先 (payment) 呼び出しのメトリクスと証跡を出す</label></div>
<div class="checkbox-row"><input type="checkbox" name="poolGauge" id="poolGauge" ${checkbox(o.saturation.poolGauge)}><label for="poolGauge">共有 pool の使用率を出す</label></div>
<label>Health check の中身
<select name="healthMode">
<option value="liveness" ${o.healthCheck.mode === "liveness" ? "selected" : ""}>liveness だけ (プロセスが生きているか)</option>
<option value="synthetic" ${o.healthCheck.mode === "synthetic" ? "selected" : ""}>synthetic (実際の注文が通っているか)</option>
</select>
</label>
<div class="checkbox-row"><input type="checkbox" name="logsStructured" id="logsStructured" ${checkbox(o.logs.structured)}><label for="logsStructured">構造化ログを出す</label></div>
<div class="checkbox-row"><input type="checkbox" name="logsRequestId" id="logsRequestId" ${checkbox(o.logs.includeRequestId)}><label for="logsRequestId">request_id をログに含める (構造化ログが前提)</label></div>
<div class="checkbox-row"><input type="checkbox" name="logsAuthHeader" id="logsAuthHeader" ${checkbox(o.logs.includeAuthHeader)}><label for="logsAuthHeader">Authorization ヘッダをログに含める (デバッグに便利そうに見えますが…)</label></div>
<button type="submit">保存</button>
</form>
`;
  return page("Build — 平時の準備", body);
}

function ruleRow(rule, state) {
  const status = state?.firing ? "firing" : "quiet";
  const noisy = state?.noisy ? " (noisy — Build/Calibrate 中に発火済み)" : "";
  return `<tr><td><code>${escapeHtml(rule.id)}</code></td><td>${escapeHtml(rule.metric)}</td><td>${escapeHtml(rule.route ?? "-")}</td>
<td>${escapeHtml(rule.op)} ${rule.threshold}</td><td>${rule.forTicks}</td><td>${status}${noisy}</td>
<td><form method="post" action="./alerts/remove"><input type="hidden" name="id" value="${escapeHtml(rule.id)}"><button type="submit">削除</button></form></td></tr>`;
}

export function alertsPage(world, notice = "") {
  const rules = world.config.alerts.rules;
  const rows = rules.map((rule) => ruleRow(rule, world.alerts.states[rule.id])).join("\n");
  const body = `
${notice}
${phaseBanner(world)}
<p>ルールは実際のメトリクスに対して評価されます。Build / Calibrate 中に一度でも発火すると "noisy" 扱いになり、readiness の得点対象から外れます。</p>
<table><thead><tr><th>id</th><th>metric</th><th>route</th><th>条件</th><th>forTicks</th><th>状態</th><th></th></tr></thead>
<tbody>${rows || '<tr><td colspan="7">ルールはまだありません</td></tr>'}</tbody></table>
<h2>ルールを追加</h2>
<form method="post" action="./alerts/add">
<label>id (kebab-case)<input name="id" placeholder="checkout-error-ratio"></label>
<label>metric
<select name="metric">
<option value="http_error_ratio">http_error_ratio</option>
<option value="http_latency_p99_seconds">http_latency_p99_seconds</option>
<option value="http_latency_p50_seconds">http_latency_p50_seconds</option>
<option value="dependency_error_ratio">dependency_error_ratio</option>
<option value="dependency_latency_p99_seconds">dependency_latency_p99_seconds</option>
<option value="worker_pool_saturation">worker_pool_saturation</option>
<option value="circuit_breaker_state">circuit_breaker_state (0=closed, 1=half-open, 2=open)</option>
</select></label>
<label>route (http_error_ratio のみ有効。他は無視されます)
<select name="route"><option value="">(指定しない)</option><option value="checkout">checkout</option><option value="order-status">order-status</option></select>
</label>
<label>演算子<select name="op"><option value=">">&gt;</option><option value=">=">&gt;=</option></select></label>
<label>しきい値<input type="number" step="0.0001" name="threshold" value="0.2"></label>
<label>forTicks (継続秒数, 1-300)<input type="number" name="forTicks" value="20" min="1" max="300"></label>
<button type="submit">追加</button>
</form>
`;
  return page("アラート", body);
}

export function telemetryPage(world) {
  const raw = renderPrometheus(world);
  const health = businessHealth(world);
  const body = `
${phaseBanner(world)}
<p>business_health (/metrics 内): <strong>${health === 1 ? "1 (healthy)" : "0 (unhealthy)"}</strong> — healthCheck.mode = ${escapeHtml(world.config.observability.healthCheck.mode)}</p>
<p>pool: ${world.pool.length} / ${POOL_SIZE} 使用中</p>
<h2>/metrics (現在の出力)</h2>
<pre>${escapeHtml(raw)}</pre>
`;
  return page("テレメトリ", body);
}

export function logsPage(world) {
  const entries = queryLogs(world, { limit: 200 });
  const lines = entries.map((entry) => escapeHtml(renderLogLine(entry))).join("\n");
  const body = `
${phaseBanner(world)}
<p>構造化ログが有効なら route / outcome / request_id で追跡できます。無効なら 1 行テキストだけが残ります。</p>
<pre>${lines || "(まだログはありません)"}</pre>
`;
  return page("ログ", body);
}

export function evidencePage(world) {
  const rows = world.evidence
    .slice(-100)
    .map(
      (entry) =>
        `<tr><td><code>${escapeHtml(entry.id)}</code></td><td>${entry.tick}</td><td>${escapeHtml(entry.kind)}</td><td>${escapeHtml(entry.dependency ?? "-")}</td><td>${escapeHtml(entry.message ?? "")}</td></tr>`,
    )
    .join("\n");
  const body = `
${phaseBanner(world)}
<p>証跡は、対応する capability が <strong>その時点で</strong> 有効だったときにだけ記録されます。後から有効にしても、有効にする前の証跡は増えません。</p>
<table><thead><tr><th>id</th><th>tick</th><th>kind</th><th>dependency</th><th>message</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5">証跡はまだありません</td></tr>'}</tbody></table>
`;
  return page("証跡", body);
}

function incidentSummary(world) {
  const inc = world.incident;
  const roles = Object.entries(inc.roles).map(([role, member]) => `${role}=${escapeHtml(member)}`).join(", ") || "(未割当)";
  const facts = inc.facts.map((f) => `<li>[t${f.tick}] ${escapeHtml(f.text)} (evidence: ${f.evidenceIds.map(escapeHtml).join(", ") || "-"})</li>`).join("");
  const hyps = inc.hypotheses
    .map((h) => `<li>[t${h.tick}] dependency=${escapeHtml(h.hypothesis?.dependency ?? "")} mechanism=${escapeHtml(h.hypothesis?.mechanism ?? "")} -> ${h.accepted ? "accepted" : `rejected (${escapeHtml(h.reason ?? "")})`}</li>`)
    .join("");
  const updates = inc.updates
    .map((u) => `<li>[t${u.tick}] impact=${escapeHtml(u.customerImpact)} / hypothesis=${escapeHtml(u.activeHypothesis)} / owner=${escapeHtml(u.owner)}</li>`)
    .join("");
  const withdrawals = inc.withdrawals
    .map((w) => `<li>[t${w.withdrawnAtTick}] tick ${w.declaredAtTick} の宣言 (severity ${escapeHtml(w.severity ?? "-")}) を取り下げ</li>`)
    .join("");
  return `
<p>状態: ${inc.declared ? `宣言済み (severity ${escapeHtml(inc.severity)}, tick ${inc.declaredAtTick})` : "未宣言"} / resolved: ${inc.resolved ? `済み (tick ${inc.resolvedAtTick})` : "未"}</p>
<p>役割: ${roles}</p>
<h3>Facts</h3><ul>${facts || "<li>(なし)</li>"}</ul>
<h3>Hypotheses</h3><ul>${hyps || "<li>(なし)</li>"}</ul>
<h3>Updates</h3><ul>${updates || "<li>(なし)</li>"}</ul>
${withdrawals ? `<h3>取り下げた宣言</h3><ul>${withdrawals}</ul>` : ""}
`;
}

export function incidentPage(world, notice = "") {
  const depOptions = DEPENDENCY_CHOICES.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
  const mechOptions = [...MECHANISMS, ...MECHANISM_DECOYS]
    .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
    .join("");
  const body = `
${notice}
${phaseBanner(world)}
${incidentSummary(world)}

<h2>宣言する</h2>
<p>宣言は「気づいた」ことを記録する操作です。まだ何も起きていない時点の宣言や、事象がすっかり収まったあとの宣言は検知として扱われません。</p>
<form method="post" action="./incident/declare">
<label>severity<select name="severity"><option value="SEV1">SEV1</option><option value="SEV2" selected>SEV2</option><option value="SEV3">SEV3</option><option value="SEV4">SEV4</option></select></label>
<button type="submit">declare</button>
</form>

<h2>宣言を取り下げる</h2>
<p>早すぎた宣言は取り下げて、あらためて declare し直せます。取り下げ自体に減点はありません。</p>
<form method="post" action="./incident/withdraw"><button type="submit">withdraw</button></form>

<h2>役割を割り当てる</h2>
<form method="post" action="./incident/assign">
<label>role<select name="role"><option value="ic">Incident Commander</option><option value="ops">Operations Lead</option><option value="comms">Communications Lead</option><option value="scribe">Scribe / Timeline</option></select></label>
<label>担当者<input name="member" placeholder="例: alice (3人チームなら comms と scribe は兼任可)"></label>
<button type="submit">assign</button>
</form>

<h2>Fact を記録する</h2>
<form method="post" action="./incident/fact">
<label>fact<input name="text" placeholder="checkout の error_ratio が閾値を超えている"></label>
<label>evidence id (カンマ区切り)<input name="evidenceIds" placeholder="証跡ページからコピー"></label>
<button type="submit">記録</button>
</form>

<h2>Hypothesis を提出する</h2>
<p>dependency と mechanism を当てずっぽうに変えて出し直すと、外すたびに大きくなる減点が記録されます。証跡を読んでから提出してください。</p>
<form method="post" action="./incident/hypothesis">
<label>dependency<select name="dependency">${depOptions}</select></label>
<label>mechanism<select name="mechanism">${mechOptions}</select></label>
<label>evidence id (カンマ区切り、少なくとも1件)<input name="evidenceIds"></label>
<button type="submit">提出</button>
</form>

<h2>Action</h2>
<form method="post" action="./incident/action">
<label>type
<select name="type">
<option value="open-circuit-breaker">circuit breaker を強制 open</option>
<option value="close-circuit-breaker">circuit breaker の強制 override を解除</option>
<option value="restart-service">サービスを再起動する</option>
<option value="stop-service">サービスを全停止する</option>
<option value="start-service">サービスを再開する</option>
<option value="stop-load-generator">load generator を止める</option>
</select></label>
<button type="submit">実行</button>
</form>

<h2>Structured update</h2>
<form method="post" action="./incident/update">
<label>customerImpact<input name="customerImpact" placeholder="checkout の一部が失敗している"></label>
<label>confirmedFacts (1行1件)<textarea name="confirmedFacts" rows="3"></textarea></label>
<label>activeHypothesis<input name="activeHypothesis"></label>
<label>owner<input name="owner"></label>
<label>nextUpdateInTicks<input type="number" name="nextUpdateInTicks" value="60" min="1"></label>
<button type="submit">投稿</button>
</form>

<h2>Resolve</h2>
<p>宣言済み・override 解除済み・update 投稿済み・SLO が実際に戻っていることが条件です。</p>
<form method="post" action="./incident/resolve"><button type="submit">resolve</button></form>
`;
  return page("Incident Room", body);
}

export function scoreboardPage(world) {
  const p = posture(world);
  const rows = CHECKPOINTS.map((id) => {
    const gate = p.gates[id];
    return `<tr class="gate-${gate}"><td>${escapeHtml(id)}</td><td>${POINTS[id]}</td><td>${gate ? "true" : "false"}</td><td>${p.tokens[id] ? `<code>${escapeHtml(p.tokens[id])}</code>` : "-"}</td></tr>`;
  }).join("\n");
  const penalties = world.penalties.map((entry) => `<li>[t${entry.tick}] ${escapeHtml(entry.reason)}: ${entry.points}</li>`).join("");
  const timeline = world.incident.resolved
    ? `<h2>Ground truth vs. team timeline</h2>
<table><thead><tr><th></th><th>tick</th></tr></thead><tbody>
<tr><td>real onset (hidden until now)</td><td>${world.incidentPlan.startTick}</td></tr>
<tr><td>declared</td><td>${world.incident.declaredAtTick}</td></tr>
<tr><td>dependency naturally healed</td><td>${world.incidentPlan.healTick}</td></tr>
<tr><td>resolved</td><td>${world.incident.resolvedAtTick}</td></tr>
</tbody></table>`
    : `<p>resolve すると ground truth と自分たちのタイムラインの比較がここに出ます。</p>`;
  const body = `
${phaseBanner(world)}
<p>合計: <strong>${p.score} / ${p.maxScore}</strong></p>
<table><thead><tr><th>checkpoint</th><th>points</th><th>gate</th><th>receipt</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Penalties</h2><ul>${penalties || "<li>(なし)</li>"}</ul>
${timeline}
<p>各 checkpoint の受領証は、TenkaCloud の submission 欄に checkpointId と一緒にコピーしてください。</p>
`;
  return page("スコア", body);
}
