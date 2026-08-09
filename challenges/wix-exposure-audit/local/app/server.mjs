import { createHash } from "node:crypto";
import { createServer } from "node:http";

/**
 * A browser-completable mock of a SaaS-built business site. It deliberately
 * starts with three independent publishing/operations mistakes:
 *
 * 1. a client-review page is still discoverable through sitemap.xml;
 * 2. an "anyone with the link" inbox URL remains in the public HTML source;
 * 3. a production-agency collaborator still has a live access link.
 *
 * The owner settings page is an authorized remediation surface. Each of the
 * three controls is reversible (close, then reopen) so that closing a
 * setting before collecting its evidence is a recoverable mistake, not a
 * dead end: the participant can reopen it, gather the passphrase, and close
 * it again for real.
 *
 * The fourth checkpoint (`settings-remediation`) is a *discovered* flag like
 * the other three, not a fixed keyword: the owner-settings page offers a
 * re-audit action that inspects live control state. Running it while any
 * control is still open reveals nothing (just which ones remain open) and
 * changes no state, so it is always harmless to retry. Only once all three
 * are genuinely closed does the re-audit hand back the per-deploy
 * `settings-remediation` passphrase, which the participant then submits to
 * `/verify` exactly like the other three. Both listeners are exposed only on
 * loopback by docker-compose.
 */

/**
 * Parse a request target without letting a malformed one end the process.
 *
 * `GET //` is a protocol-relative reference with no host, and `new URL` rejects
 * it. This app serves its challenge surface and its `/verify` scorer from one
 * process, so an unguarded parse in the handler takes both down over a stray
 * slash. Leading slashes are collapsed (which is what the client meant) and
 * anything still unparseable becomes a target the router will not match, so a
 * malformed request is a 404 rather than a crash.
 */
function requestUrl(target, base) {
  try {
    return new URL(String(target ?? "/").replace(/^\/+/, "/"), base);
  } catch {
    return new URL("/__malformed_request__", base);
  }
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/**
 * Builds one fresh, isolated instance of the challenge's mutable state
 * (flags, capability tokens, and owner-control toggles) from a per-deploy
 * seed. Kept separate from server construction so tests can spin up
 * independent instances on ephemeral ports without sharing global state.
 */
function createChallengeState(flagSeed) {
  const flagFor = (checkpointId, prefix) =>
    `TC{${prefix}_${sha256(`flag:${checkpointId}:${flagSeed}`).slice(0, 20)}}`;

  const FLAGS = {
    "preview-indexing": flagFor("preview-indexing", "wixpreview"),
    "shared-inbox": flagFor("shared-inbox", "wixinbox"),
    "stale-collaborator": flagFor("stale-collaborator", "wixagency"),
    "settings-remediation": flagFor("settings-remediation", "wixremediation"),
  };
  const SHARE_TOKEN = `share-${sha256(`share:${flagSeed}`).slice(0, 16)}`;
  const AGENCY_TOKEN = `agency-${sha256(`agency:${flagSeed}`).slice(0, 16)}`;

  const controls = {
    searchIndexing: true,
    inboxShareActive: true,
    agencyCollaboratorActive: true,
  };

  const INBOX = [
    {
      name: "Ishikawa Yuna",
      email: "yuna.ishikawa@example.com",
      message: "ロゴのリニューアルを相談したいです。予算は30万円ほどを考えています。",
    },
    {
      name: "Morita Kenji",
      email: "kenji.morita@example.com",
      message: "先日の名刺の増刷をお願いできますか。前回と同じデータで大丈夫です。",
    },
    {
      name: "システム監査 (自動)",
      email: "audit@tenkacloud.example",
      message: `【監査】第三者に見えているなら共有範囲の設定ミスです: ${FLAGS["shared-inbox"]}`,
    },
  ];

  return { FLAGS, SHARE_TOKEN, AGENCY_TOKEN, controls, INBOX };
}

/**
 * この板が自分自身を指すときの絶対 URL。
 *
 * ポートを焼き込んではいけない。local play は空いているポートへ再割り当てするので、
 * 別の問題を起動したままこの問題を起動すると 18080 は他問題のものになる。この問題は
 * robots.txt から sitemap.xml へ、そこから preview page へ辿る導線そのものが主題なので、
 * 焼き込んだ URL は**参加者を別の問題へ飛ばす** (Issue 399)。
 *
 * `Host` は参加者のブラウザが実際に打ったホストとポートなので、それを使えば割り当てが
 * どこであっても正しい先を指す。`Host` の無い HTTP/1.0 クライアントだけ既定へ落とす。
 */
function siteBase(request) {
  const host = request.headers.host;
  return host ? `http://${host}` : "http://127.0.0.1:8080";
}

function send(response, status, contentType, body) {
  response.writeHead(status, {
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function sendJson(response, status, payload) {
  send(response, status, "application/json; charset=utf-8", JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

function sitePage(state) {
  return `<!doctype html>
<html lang="ja"><head><meta name="color-scheme" content="light dark"><meta charset="utf-8"><title>Aoi Design Studio</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{font-family:system-ui;margin:0;color:#1b2a3a;line-height:1.7}
  header{background:#0d3b66;color:#fff;padding:3rem 1.5rem;text-align:center}
  main{max-width:44rem;margin:0 auto;padding:2rem 1.5rem}
  h1{margin:.2rem 0;font-size:2rem}
  .card{border:1px solid #e2e8f0;border-radius:12px;padding:1.2rem;margin:1rem 0}
  label{display:block;margin:.6rem 0 .2rem}
  input,textarea{width:100%;padding:.5rem;box-sizing:border-box}
  button{margin-top:.8rem;padding:.5rem 1rem;background:#0d3b66;color:#fff;border:0;border-radius:8px}
  footer{color:#64748b;font-size:.85rem;text-align:center;padding:2rem}
</style></head>
<body>
<!--
  Kanade Web制作所 内部メモ (公開前に必ず消すこと):
  お問い合わせ受信箱: /admin/inbox?share=${state.SHARE_TOKEN}
-->
<header><h1>Aoi Design Studio</h1><p>名刺・ロゴ・パンフレットのデザイン工房</p></header>
<main>
  <div class="card"><h2>私たちについて</h2>
    <p>小さなデザインスタジオです。中小事業者さまのブランドづくりをお手伝いしています。</p>
  </div>
  <div class="card"><h2>お問い合わせ</h2>
    <form method="post" action="/api/contact">
      <label>お名前 <input name="name" required></label>
      <label>メール <input name="email" type="email" required></label>
      <label>ご相談内容 <textarea name="message" rows="4" required></textarea></label>
      <button type="submit">送信する</button>
    </form>
  </div>
</main>
<footer>制作: Kanade Web制作所</footer>
</body></html>`;
}

function previewPage(state) {
  return `<!doctype html>
<html lang="ja"><head><meta name="color-scheme" content="light dark"><meta charset="utf-8"><title>Client Review — Aoi Design Studio</title></head>
<body style="font-family:system-ui;max-width:48rem;margin:2rem auto;line-height:1.7">
<h1>制作会社との公開前レビュー</h1>
<p>このページは検索対象外のつもりでしたが、公開sitemapに残っています。</p>
<ul><li>新料金表: 未公開</li><li>秋キャンペーン: 顧客確認中</li></ul>
<p>公開範囲監査marker: <code>${state.FLAGS["preview-indexing"]}</code></p>
</body></html>`;
}

function inboxPage(state) {
  const rows = state.INBOX.map(
    (entry) =>
      `<tr><td>${entry.name}</td><td>${entry.email}</td><td>${entry.message}</td></tr>`,
  ).join("");
  return `<!doctype html>
<html lang="ja"><head><meta name="color-scheme" content="light dark"><meta charset="utf-8"><title>お問い合わせ受信箱</title>
<style>body{font-family:system-ui;max-width:56rem;margin:2rem auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:.5rem;text-align:left;vertical-align:top}.warn{background:#fff7ed;color:#1f2937;padding:.8rem}</style>
</head><body><h1>お問い合わせ受信箱</h1>
<p class="warn">この共有リンクを知る人は、認証なしで以下の個人情報を閲覧できます。</p>
<table><tr><th>お名前</th><th>メール</th><th>ご相談内容</th></tr>${rows}</table>
</body></html>`;
}

function agencyPage(state) {
  return `<!doctype html>
<html lang="ja"><head><meta name="color-scheme" content="light dark"><meta charset="utf-8"><title>Collaborator Access</title></head>
<body style="font-family:system-ui;max-width:48rem;margin:2rem auto;line-height:1.7">
<h1>共同編集者アクセス</h1>
<p>契約終了済みの制作会社accountが、公開後もSite manager権限を保持しています。</p>
<table border="1" cellpadding="8"><tr><th>主体</th><th>権限</th><th>状態</th></tr>
<tr><td>kanade-agency@example.test</td><td>Site manager / form submissions</td><td>active</td></tr></table>
<p>権限棚卸しmarker: <code>${state.FLAGS["stale-collaborator"]}</code></p>
</body></html>`;
}

/**
 * Live snapshot of which of the three controls are still open. Read-only —
 * never mutates `state.controls` — so running the re-audit is always safe
 * to retry, whatever order the participant did things in.
 */
function reAuditResult(state) {
  const { controls } = state;
  const openLabels = [];
  if (controls.searchIndexing) openLabels.push("previewページの検索公開");
  if (controls.inboxShareActive) openLabels.push("問い合わせ受信箱の共有link");
  if (controls.agencyCollaboratorActive) openLabels.push("制作会社の共同編集権限");
  return { remediated: openLabels.length === 0, openLabels };
}

function reAuditPage(state) {
  const { remediated, openLabels } = reAuditResult(state);
  return `<!doctype html>
<html lang="ja"><head><meta name="color-scheme" content="light dark"><meta charset="utf-8"><title>設定の再検証</title></head>
<body style="font-family:system-ui;max-width:50rem;margin:2rem auto;line-height:1.7">
<h1>設定の再検証</h1>
${
  remediated
    ? `<p>3つの設定がすべて是正されていることを確認しました。</p><p>再検証marker: <code>${state.FLAGS["settings-remediation"]}</code></p>`
    : `<p>まだ次の設定が開いたままです: ${openLabels.join("、")}。</p><p>すべて「無効(対応済み)」にしてから、この再検証をもう一度実行してください。</p>`
}
<p><a href="/owner/settings">設定画面に戻る</a></p>
</body></html>`;
}

function ownerSettingsPage(state) {
  const { controls } = state;
  const row = (label, enabled, closeAction, closeLabel, reopenAction, reopenLabel) =>
    `<tr><td>${label}</td><td>${enabled ? "有効(要対応)" : "無効(対応済み)"}</td><td>${
      enabled
        ? `<form method="post" action="${closeAction}"><button>${closeLabel}</button></form>`
        : `<form method="post" action="${reopenAction}"><button>${reopenLabel}</button></form>`
    }</td></tr>`;
  return `<!doctype html>
<html lang="ja"><head><meta name="color-scheme" content="light dark"><meta charset="utf-8"><title>Owner Settings</title></head>
<body style="font-family:system-ui;max-width:50rem;margin:2rem auto;line-height:1.7">
<h1>サイト所有者の設定</h1>
<p>ここは所有者として利用できる正規の設定画面です。証跡を先に集め、最後に設定を是正してください。誤って先に閉じてしまった設定は「元に戻す」で再度有効化でき、証跡を集め直してから改めて閉じられます。</p>
<table border="1" cellpadding="8"><tr><th>設定</th><th>現在</th><th>操作</th></tr>
${row(
  "preview pageの検索公開",
  controls.searchIndexing,
  "/owner/settings/disable-indexing",
  "検索公開を停止",
  "/owner/settings/enable-indexing",
  "元に戻す(検索公開を再開)",
)}
${row(
  "問い合わせ受信箱の共有link",
  controls.inboxShareActive,
  "/owner/settings/revoke-inbox-share",
  "共有linkを失効",
  "/owner/settings/restore-inbox-share",
  "元に戻す(共有linkを再発行)",
)}
${row(
  "制作会社の共同編集権限",
  controls.agencyCollaboratorActive,
  "/owner/settings/remove-agency",
  "制作会社を削除",
  "/owner/settings/restore-agency",
  "元に戻す(制作会社を復元)",
)}
</table>
<form method="post" action="/owner/settings/re-audit"><button>再検証を実行</button></form>
<p>3項目すべてを「無効(対応済み)」にした状態でこの再検証を実行すると合言葉が得られます。まだ開いている設定がある場合は、どれが残っているかだけを知らせ、状態は変更しません。何度でもやり直せます。得られた合言葉をPortalの「設定の是正確認」へ提出します。</p>
</body></html>`;
}

/**
 * The published business site: the three exposure surfaces plus the
 * authorized owner-settings remediation page. All three controls are
 * independently toggleable in both directions, so closing one before its
 * evidence is collected is recoverable rather than terminal.
 */
function createChallengeServer(state) {
  return createServer(async (request, response) => {
    const url = requestUrl(request.url, "http://127.0.0.1");
    const { method } = request;
    const { controls } = state;

    if (method === "GET" && url.pathname === "/healthz") {
      return sendJson(response, 200, { status: "ok" });
    }
    if (method === "GET" && url.pathname === "/") {
      return send(response, 200, "text/html; charset=utf-8", sitePage(state));
    }
    if (method === "GET" && url.pathname === "/robots.txt") {
      return send(
        response,
        200,
        "text/plain; charset=utf-8",
        `Sitemap: ${siteBase(request)}/sitemap.xml\n`,
      );
    }
    if (method === "GET" && url.pathname === "/sitemap.xml") {
      const base = siteBase(request);
      const preview = controls.searchIndexing
        ? `<url><loc>${base}/preview/client-review</loc></url>`
        : "";
      return send(
        response,
        200,
        "application/xml; charset=utf-8",
        `<?xml version="1.0"?><urlset><url><loc>${base}/</loc></url>${preview}</urlset>`,
      );
    }
    if (method === "GET" && url.pathname === "/preview/client-review") {
      if (!controls.searchIndexing) return sendJson(response, 404, { error: "not_found" });
      return send(response, 200, "text/html; charset=utf-8", previewPage(state));
    }
    if (method === "GET" && url.pathname === "/humans.txt") {
      const access = controls.agencyCollaboratorActive
        ? `Agency handoff: /agency/access?token=${state.AGENCY_TOKEN}\n`
        : "";
      return send(response, 200, "text/plain; charset=utf-8", `Site owner: Aoi Design Studio\n${access}`);
    }
    if (method === "POST" && url.pathname === "/api/contact") {
      return send(response, 200, "text/html; charset=utf-8", "<p>送信しました。</p>");
    }
    if (method === "GET" && url.pathname === "/admin/inbox") {
      if (!controls.inboxShareActive || url.searchParams.get("share") !== state.SHARE_TOKEN) {
        return send(response, 403, "text/html; charset=utf-8", "<p>この共有linkは無効です。</p>");
      }
      return send(response, 200, "text/html; charset=utf-8", inboxPage(state));
    }
    if (method === "GET" && url.pathname === "/agency/access") {
      if (
        !controls.agencyCollaboratorActive ||
        url.searchParams.get("token") !== state.AGENCY_TOKEN
      ) {
        return send(response, 403, "text/html; charset=utf-8", "<p>access denied</p>");
      }
      return send(response, 200, "text/html; charset=utf-8", agencyPage(state));
    }
    if (method === "GET" && url.pathname === "/owner/settings") {
      return send(response, 200, "text/html; charset=utf-8", ownerSettingsPage(state));
    }
    if (method === "POST" && url.pathname === "/owner/settings/re-audit") {
      // Read-only: never mutates controls, so an early or repeated run is
      // always harmless. Only reveals the passphrase once all three
      // controls are genuinely closed.
      return send(response, 200, "text/html; charset=utf-8", reAuditPage(state));
    }
    if (method === "POST" && url.pathname === "/owner/settings/disable-indexing") {
      controls.searchIndexing = false;
      return send(response, 200, "text/html; charset=utf-8", ownerSettingsPage(state));
    }
    if (method === "POST" && url.pathname === "/owner/settings/enable-indexing") {
      controls.searchIndexing = true;
      return send(response, 200, "text/html; charset=utf-8", ownerSettingsPage(state));
    }
    if (method === "POST" && url.pathname === "/owner/settings/revoke-inbox-share") {
      controls.inboxShareActive = false;
      return send(response, 200, "text/html; charset=utf-8", ownerSettingsPage(state));
    }
    if (method === "POST" && url.pathname === "/owner/settings/restore-inbox-share") {
      controls.inboxShareActive = true;
      return send(response, 200, "text/html; charset=utf-8", ownerSettingsPage(state));
    }
    if (method === "POST" && url.pathname === "/owner/settings/remove-agency") {
      controls.agencyCollaboratorActive = false;
      return send(response, 200, "text/html; charset=utf-8", ownerSettingsPage(state));
    }
    if (method === "POST" && url.pathname === "/owner/settings/restore-agency") {
      controls.agencyCollaboratorActive = true;
      return send(response, 200, "text/html; charset=utf-8", ownerSettingsPage(state));
    }
    return sendJson(response, 404, { error: "not_found" });
  });
}

/**
 * The loopback-only verifier. All four checkpoints — including
 * `settings-remediation` — are graded the same way: exact match against a
 * per-deploy `TC{...}` passphrase. There is no separate "fixed keyword"
 * path; `settings-remediation`'s passphrase only ever becomes knowable by
 * running the owner-settings re-audit while all three controls are
 * genuinely closed (see `reAuditPage`), so a correct submission here is
 * proof the participant did exactly that.
 */
function createVerifyServer(state) {
  return createServer(async (request, response) => {
    if (request.method === "GET" && (request.url ?? "/") === "/healthz") {
      return sendJson(response, 200, { status: "ok" });
    }
    if (request.method !== "POST" || (request.url ?? "/") !== "/verify") {
      return sendJson(response, 404, { error: "not_found" });
    }

    const body = await readJson(request);
    if (!body) return sendJson(response, 400, { error: "invalid_json" });
    const checkpointId = typeof body.checkpointId === "string" ? body.checkpointId : "";
    if (!Object.keys(state.FLAGS).includes(checkpointId)) {
      return sendJson(response, 400, { error: "unknown_checkpoint" });
    }
    const submission = typeof body.submission === "string" ? body.submission.trim() : "";
    if (submission.length < 1 || submission.length > 200) {
      return sendJson(response, 400, { checkpointId, error: "invalid_submission" });
    }

    const correct = submission === state.FLAGS[checkpointId];
    return sendJson(response, 200, {
      checkpointId,
      correct,
      message: correct ? "Checkpoint cleared." : "That is not the passphrase for this checkpoint.",
    });
  });
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const state = createChallengeState(process.env.FLAG_SEED ?? "local-dev-seed");
  const challenge = createChallengeServer(state);
  const verify = createVerifyServer(state);
  challenge.listen(8080, "0.0.0.0", () => console.log("challenge on :8080"));
  verify.listen(8081, "0.0.0.0", () => console.log("verify on :8081"));
}

export { createChallengeState, createChallengeServer, createVerifyServer };
