/**
 * The Browser Workbench (Issue 390).
 *
 * ## Forms, not fetch
 *
 * Every action here is an ordinary HTML form posting to the same gateway the MCP path
 * uses. No inline script at all — which is deliberate twice over. It means the problem
 * works with scripting off, and it means this file cannot reproduce the defect class
 * that took out the StackStack API console: a `\n` written inside an inline script
 * inside an outer template literal is eaten by the outer literal and the delivered
 * script dies of a syntax error (Issue 395). No script, no hazard.
 *
 * ## Nothing here reveals `protected`
 *
 * The preview names what a change would touch and what depends on it. It does not
 * label anything "protected" — working that out from the evidence and the dependency
 * graph is the exercise. A screen that printed the answer would leave the participant
 * clicking rather than deciding.
 *
 * ## Relative links only
 *
 * Local play reassigns the published port when the default is taken, so a link with the
 * default port baked into it sends the participant into a different problem (Issue 399).
 */

import { posture } from "./scoring.mjs";
import { resolveSelector } from "./proposals.mjs";
import { listTools } from "./gateway.mjs";

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

/**
 * `color-scheme: light dark` plus explicit colours on both sides.
 *
 * Declaring only the light background is how a page ends up black-on-black for anyone
 * whose browser is in dark mode — the author never sees it (Issue 396).
 */
const STYLE = `
:root { color-scheme: light dark; }
body { font-family: system-ui, sans-serif; max-width: 62rem; margin: 2rem auto; padding: 0 1rem;
       line-height: 1.65; background: Canvas; color: CanvasText; }
nav a { margin-right: 1rem; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
th, td { border: 1px solid GrayText; padding: .4rem .6rem; text-align: left; vertical-align: top; }
code, pre { background: color-mix(in srgb, CanvasText 8%, Canvas); padding: .1rem .3rem; border-radius: .25rem; }
pre { padding: .8rem; overflow-x: auto; }
fieldset { margin: 1rem 0; border: 1px solid GrayText; border-radius: .4rem; }
label { display: block; margin-top: .6rem; }
input, textarea, select { box-sizing: border-box; width: 100%; padding: .45rem; font: inherit;
       background: Canvas; color: CanvasText; border: 1px solid GrayText; border-radius: .25rem; }
button { margin-top: .8rem; padding: .5rem 1rem; font: inherit; }
.warn { border-left: .3rem solid #d97706; padding-left: .8rem; }
.gate-true::before { content: "OK "; }
.gate-false::before { content: "-- "; }
`;

function page(title, body) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style></head>
<body>
<nav><a href="./">インシデント</a><a href="./resources">リソース</a><a href="./plan">計画</a><a href="./proposals">提案と承認</a></nav>
<h1>${escapeHtml(title)}</h1>
${body}
</body></html>`;
}

const phaseSummary = (session) => {
  const { phase, tools } = listTools(session.gateway);
  const explain = {
    1: "AI tool は 1 つも渡していません。まず自分で読み、仮説を出します。",
    2: "read-only tool だけを渡しています。調査はできますが、何も変えられません。",
    3: "write tool を渡しています。ただし propose → preview → approve → execute の順にしか通りません。",
  };
  return `<p class="warn"><strong>フェーズ ${phase}</strong> — ${escapeHtml(explain[phase])}</p>
<p>いま呼べる tool: ${tools.length === 0 ? "<em>なし</em>" : tools.map((t) => `<code>${escapeHtml(t)}</code>`).join(" ")}</p>`;
};

export function incidentPage(session) {
  const live = posture(session.world, session.store, session.gateway, session.seed);
  const gates = Object.entries(live.gates)
    .map(
      ([name, value]) =>
        `<li class="${value ? "gate-true" : "gate-false"}">${escapeHtml(name)}</li>`,
    )
    .join("");
  const evidence = session.world.evidence
    .map(
      (entry) =>
        `<tr><td><code>${escapeHtml(entry.id)}</code></td><td>${escapeHtml(entry.severity)}</td><td><code>${escapeHtml(entry.resourceId)}</code></td><td>${escapeHtml(entry.summary)}</td></tr>`,
    )
    .join("");
  const penalties = live.penalties
    .map(
      (entry) =>
        `<li>${escapeHtml(entry.reason)} <strong>${entry.points}</strong> — ${escapeHtml(entry.detail)}</li>`,
    )
    .join("");
  return page(
    "注文 API のインシデント",
    `${phaseSummary(session)}
<p>AI で構築された注文 API で不審な操作が検知されました。名前もタグも似たリソースが並んでいます。
証拠を保存したまま、侵害された対象<strong>だけ</strong>を隔離し、本番 API を止めないでください。</p>
<h2>証跡</h2>
<table><tr><th>証跡 ID</th><th>重大度</th><th>リソース</th><th>内容</th></tr>${evidence}</table>
<h2>いまの状態</h2>
<ul>${gates}</ul>
<p>得点 <strong>${live.score}</strong></p>
${penalties.length > 0 ? `<h2>減点</h2><ul>${penalties}</ul>` : ""}
<h2>インシデントを閉じる</h2>
<p>対応が終わったら、一時的に渡した write 権限を失効させます。閉じ忘れは、変更の窓が閉じたのに資格情報が残っている状態です。</p>
<form method="post" action="./close"><button type="submit">operator capability を失効させる</button></form>`,
  );
}

export function resourcesPage(session) {
  const rows = session.world.resources
    .map(
      (resource) =>
        `<tr><td><code>${escapeHtml(resource.id)}</code></td><td>${escapeHtml(resource.name)}</td><td>${escapeHtml(resource.kind)}</td><td>${escapeHtml(
          Object.entries(resource.tags)
            .map(([key, value]) => `${key}=${value}`)
            .join(" ") || "-",
        )}</td><td>${escapeHtml(resource.state)}</td><td>${escapeHtml(resource.dependsOn.join(", ") || "-")}</td></tr>`,
    )
    .join("");
  return page(
    "リソース",
    `${phaseSummary(session)}
<table><tr><th>ID</th><th>名前</th><th>種別</th><th>タグ</th><th>状態</th><th>依存先</th></tr>${rows}</table>
<p><code>suspicious=true</code> は、以前の別件の調査で付いたまま残っているタグです。いまのインシデントの判定ではありません。</p>`,
  );
}

export function plannerPage(session, result) {
  const options = session.world.resources
    .map(
      (resource) =>
        `<option value="${escapeHtml(resource.id)}">${escapeHtml(resource.name)} (${escapeHtml(resource.id)})</option>`,
    )
    .join("");
  const evidenceOptions = session.world.evidence
    .map(
      (entry) =>
        `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.id)} — ${escapeHtml(entry.summary.slice(0, 40))}</option>`,
    )
    .join("");
  const verdict =
    result === undefined
      ? ""
      : result
        ? `<p class="warn"><strong>受理されました。</strong></p>`
        : `<p class="warn"><strong>受理されませんでした。</strong> 対象・証跡・守るべきものの少なくとも 1 つが合っていません。</p>`;
  return page(
    "仮説と計画",
    `${phaseSummary(session)}
${verdict}
<h2>フェーズ 1 — 構造化した仮説</h2>
<p>自由記述は採点しません。どのリソースが対象で、どの証跡を根拠にし、何を守るのかを指定してください。</p>
<form method="post" action="./plan/hypothesis">
<label>侵害されたリソース<select name="affectedResourceId">${options}</select></label>
<label>根拠にする証跡 (複数選択)<select name="evidenceIds" multiple size="4">${evidenceOptions}</select></label>
<label>守るべきリソース (複数選択)<select name="protectedResourceIds" multiple size="6">${options}</select></label>
<button type="submit">提出する</button>
</form>`,
  );
}

/**
 * The proposal surface.
 *
 * The vague request is offered as a one-click proposal on purpose. "suspicious なものを
 * すべて停止して、不要なものを削除して安全な状態にしてください" is what a hurried
 * instruction actually looks like, and the participant needs to meet it as a concrete
 * proposal they can preview — not as a warning in a README.
 */
export function proposalPage(session, notice) {
  const options = session.world.resources
    .map(
      (resource) =>
        `<option value="${escapeHtml(resource.id)}">${escapeHtml(resource.name)} (${escapeHtml(resource.id)})</option>`,
    )
    .join("");
  const rows = session.store.proposals
    .map((proposal) => {
      const reach = resolveSelector(session.world, proposal.selector).length;
      const previewed = session.store.previews.has(proposal.id);
      const executed = session.store.executions.some((entry) => entry.proposalId === proposal.id);
      return `<tr><td><code>${escapeHtml(proposal.id)}</code></td><td>${escapeHtml(proposal.action)}</td><td>${escapeHtml(
        proposal.selector.kind,
      )}</td><td>${reach}</td><td>${previewed ? "済" : "-"}</td><td>${executed ? "済" : "-"}</td>
<td><form method="post" action="./proposals/preview"><input type="hidden" name="proposalId" value="${escapeHtml(proposal.id)}"><button type="submit">preview</button></form></td></tr>`;
    })
    .join("");

  return page(
    "提案と承認",
    `${phaseSummary(session)}
${notice ?? ""}
<h2>提案を作る</h2>
<form method="post" action="./proposals/create">
<label>操作<select name="action"><option value="isolate">isolate (隔離・元に戻せる)</option><option value="stop">stop (停止・元に戻せる)</option><option value="disable">disable (無効化・元に戻せる)</option><option value="delete">delete (削除・<strong>元に戻せない</strong>)</option></select></label>
<label>対象 (複数選択 = exact selector)<select name="resourceIds" multiple size="6">${options}</select></label>
<label>根拠にする証跡 ID (カンマ区切り)<input name="evidenceIds" placeholder="ev-xxxxxxxx"></label>
<label>期待する事後条件 (1 行に 1 つ)<textarea name="expectedPostConditions" rows="3"></textarea></label>
<label>元に戻す手順<input name="rollbackAction" placeholder="rollback_change でこの提案を戻す"></label>
<button type="submit">提案を作る</button>
</form>

<h2 class="warn">依頼どおりの提案を作る</h2>
<p>「suspicious なリソースをすべて停止して、不要なものを削除し、安全な状態にしてください」——
届いた依頼はこれでした。そのままの意味で提案にすると、こうなります。<strong>実行する前に preview で何に当たるかを見てください。</strong></p>
<form method="post" action="./proposals/create">
<input type="hidden" name="preset" value="broad-tag">
<button type="submit">この依頼をそのまま提案にする</button>
</form>

<h2>提案の一覧</h2>
<table><tr><th>ID</th><th>操作</th><th>selector</th><th>いま当たる数</th><th>preview</th><th>execute</th><th></th></tr>${rows || '<tr><td colspan="7">まだありません</td></tr>'}</table>`,
  );
}

/** The preview screen: the moment the whole problem is about. */
export function previewPage(session, preview) {
  const changes = preview.changes
    .map(
      (change) =>
        `<tr><td><code>${escapeHtml(change.resourceId)}</code></td><td>${escapeHtml(change.name)}</td><td>${escapeHtml(change.kind)}</td><td>${escapeHtml(change.from)}</td><td>${escapeHtml(change.to)}</td></tr>`,
    )
    .join("");
  const collateral = preview.collateral
    .map(
      (entry) =>
        `<li><code>${escapeHtml(entry.resourceId)}</code> ${escapeHtml(entry.name)} (${escapeHtml(entry.kind)})</li>`,
    )
    .join("");
  const dependents = preview.dependents
    .map(
      (entry) =>
        `<li><code>${escapeHtml(entry.resourceId)}</code> ${escapeHtml(entry.name)} (${escapeHtml(entry.kind)})</li>`,
    )
    .join("");
  return page(
    "この提案が実際に触るもの",
    `${phaseSummary(session)}
<p>提案 <code>${escapeHtml(preview.proposalId)}</code> / 操作 <code>${escapeHtml(preview.action)}</code>
${preview.broadSelector ? " / <strong>広い selector です</strong>" : ""}
${preview.reversible ? "" : " / <strong>この操作は元に戻せません</strong>"}</p>
<h2>変更</h2>
<table><tr><th>ID</th><th>名前</th><th>種別</th><th>現在</th><th>実行後</th></tr>${changes}</table>
${collateral ? `<h2 class="warn">侵害対象以外に当たるもの</h2><ul>${collateral}</ul>` : "<p>侵害対象以外には当たりません。</p>"}
${dependents ? `<h2 class="warn">これに依存していて巻き添えになるもの</h2><ul>${dependents}</ul>` : ""}
<h2>承認</h2>
<p>この内容に対する承認 digest です。提案の中身や世界が動くと digest は変わり、古い digest での実行は拒否されます。</p>
<pre>${escapeHtml(preview.approvalDigest)}</pre>
<form method="post" action="./proposals/execute">
<input type="hidden" name="proposalId" value="${escapeHtml(preview.proposalId)}">
<input type="hidden" name="approvalDigest" value="${escapeHtml(preview.approvalDigest)}">
<button type="submit">この内容で実行する</button>
</form>
<form method="post" action="./proposals/decline">
<input type="hidden" name="proposalId" value="${escapeHtml(preview.proposalId)}">
<button type="submit">実行しない (この提案を却下する)</button>
</form>
<form method="post" action="./proposals/rollback">
<input type="hidden" name="proposalId" value="${escapeHtml(preview.proposalId)}">
<button type="submit">実行済みなら元に戻す</button>
</form>`,
  );
}

export { escapeHtml };
