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
 * The owner settings page is an authorized remediation surface. The final
 * checkpoint asks the participant to disable all three settings and lets the
 * verifier inspect server state. Both listeners are exposed only on loopback by
 * docker-compose.
 */

const FLAG_SEED = process.env.FLAG_SEED ?? "local-dev-seed";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const flagFor = (checkpointId, prefix) =>
  `TC{${prefix}_${sha256(`flag:${checkpointId}:${FLAG_SEED}`).slice(0, 20)}}`;

const FLAGS = {
  "preview-indexing": flagFor("preview-indexing", "wixpreview"),
  "shared-inbox": flagFor("shared-inbox", "wixinbox"),
  "stale-collaborator": flagFor("stale-collaborator", "wixagency"),
};
const SHARE_TOKEN = `share-${sha256(`share:${FLAG_SEED}`).slice(0, 16)}`;
const AGENCY_TOKEN = `agency-${sha256(`agency:${FLAG_SEED}`).slice(0, 16)}`;

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

function sitePage() {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Aoi Design Studio</title>
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
  お問い合わせ受信箱: /admin/inbox?share=${SHARE_TOKEN}
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

function previewPage() {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Client Review — Aoi Design Studio</title></head>
<body style="font-family:system-ui;max-width:48rem;margin:2rem auto;line-height:1.7">
<h1>制作会社との公開前レビュー</h1>
<p>このページは検索対象外のつもりでしたが、公開sitemapに残っています。</p>
<ul><li>新料金表: 未公開</li><li>秋キャンペーン: 顧客確認中</li></ul>
<p>公開範囲監査marker: <code>${FLAGS["preview-indexing"]}</code></p>
</body></html>`;
}

function inboxPage() {
  const rows = INBOX.map(
    (entry) =>
      `<tr><td>${entry.name}</td><td>${entry.email}</td><td>${entry.message}</td></tr>`,
  ).join("");
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>お問い合わせ受信箱</title>
<style>body{font-family:system-ui;max-width:56rem;margin:2rem auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:.5rem;text-align:left;vertical-align:top}.warn{background:#fff7ed;padding:.8rem}</style>
</head><body><h1>お問い合わせ受信箱</h1>
<p class="warn">この共有リンクを知る人は、認証なしで以下の個人情報を閲覧できます。</p>
<table><tr><th>お名前</th><th>メール</th><th>ご相談内容</th></tr>${rows}</table>
</body></html>`;
}

function agencyPage() {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Collaborator Access</title></head>
<body style="font-family:system-ui;max-width:48rem;margin:2rem auto;line-height:1.7">
<h1>共同編集者アクセス</h1>
<p>契約終了済みの制作会社accountが、公開後もSite manager権限を保持しています。</p>
<table border="1" cellpadding="8"><tr><th>主体</th><th>権限</th><th>状態</th></tr>
<tr><td>kanade-agency@example.test</td><td>Site manager / form submissions</td><td>active</td></tr></table>
<p>権限棚卸しmarker: <code>${FLAGS["stale-collaborator"]}</code></p>
</body></html>`;
}

function ownerSettingsPage() {
  const row = (label, enabled, action, button) =>
    `<tr><td>${label}</td><td>${enabled ? "有効" : "無効"}</td><td>${
      enabled
        ? `<form method="post" action="${action}"><button>${button}</button></form>`
        : "対応済み"
    }</td></tr>`;
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Owner Settings</title></head>
<body style="font-family:system-ui;max-width:50rem;margin:2rem auto;line-height:1.7">
<h1>サイト所有者の設定</h1>
<p>ここは所有者として利用できる正規の設定画面です。証跡を先に集め、最後に設定を是正してください。</p>
<table border="1" cellpadding="8"><tr><th>設定</th><th>現在</th><th>操作</th></tr>
${row("preview pageの検索公開", controls.searchIndexing, "/owner/settings/disable-indexing", "検索公開を停止")}
${row("問い合わせ受信箱の共有link", controls.inboxShareActive, "/owner/settings/revoke-inbox-share", "共有linkを失効")}
${row("制作会社の共同編集権限", controls.agencyCollaboratorActive, "/owner/settings/remove-agency", "制作会社を削除")}
</table>
<p>3項目の対応後、Portalの「設定の是正確認」に <code>VERIFY</code> と入力します。</p>
</body></html>`;
}

const challenge = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const { method } = request;

  if (method === "GET" && url.pathname === "/healthz") {
    return sendJson(response, 200, { status: "ok" });
  }
  if (method === "GET" && url.pathname === "/") {
    return send(response, 200, "text/html; charset=utf-8", sitePage());
  }
  if (method === "GET" && url.pathname === "/robots.txt") {
    return send(response, 200, "text/plain; charset=utf-8", "Sitemap: http://127.0.0.1:18080/sitemap.xml\n");
  }
  if (method === "GET" && url.pathname === "/sitemap.xml") {
    const preview = controls.searchIndexing
      ? "<url><loc>http://127.0.0.1:18080/preview/client-review</loc></url>"
      : "";
    return send(
      response,
      200,
      "application/xml; charset=utf-8",
      `<?xml version="1.0"?><urlset><url><loc>http://127.0.0.1:18080/</loc></url>${preview}</urlset>`,
    );
  }
  if (method === "GET" && url.pathname === "/preview/client-review") {
    if (!controls.searchIndexing) return sendJson(response, 404, { error: "not_found" });
    return send(response, 200, "text/html; charset=utf-8", previewPage());
  }
  if (method === "GET" && url.pathname === "/humans.txt") {
    const access = controls.agencyCollaboratorActive
      ? `Agency handoff: /agency/access?token=${AGENCY_TOKEN}\n`
      : "";
    return send(response, 200, "text/plain; charset=utf-8", `Site owner: Aoi Design Studio\n${access}`);
  }
  if (method === "POST" && url.pathname === "/api/contact") {
    return send(response, 200, "text/html; charset=utf-8", "<p>送信しました。</p>");
  }
  if (method === "GET" && url.pathname === "/admin/inbox") {
    if (!controls.inboxShareActive || url.searchParams.get("share") !== SHARE_TOKEN) {
      return send(response, 403, "text/html; charset=utf-8", "<p>この共有linkは無効です。</p>");
    }
    return send(response, 200, "text/html; charset=utf-8", inboxPage());
  }
  if (method === "GET" && url.pathname === "/agency/access") {
    if (
      !controls.agencyCollaboratorActive ||
      url.searchParams.get("token") !== AGENCY_TOKEN
    ) {
      return send(response, 403, "text/html; charset=utf-8", "<p>access denied</p>");
    }
    return send(response, 200, "text/html; charset=utf-8", agencyPage());
  }
  if (method === "GET" && url.pathname === "/owner/settings") {
    return send(response, 200, "text/html; charset=utf-8", ownerSettingsPage());
  }
  if (method === "POST" && url.pathname === "/owner/settings/disable-indexing") {
    controls.searchIndexing = false;
    return send(response, 200, "text/html; charset=utf-8", ownerSettingsPage());
  }
  if (method === "POST" && url.pathname === "/owner/settings/revoke-inbox-share") {
    controls.inboxShareActive = false;
    return send(response, 200, "text/html; charset=utf-8", ownerSettingsPage());
  }
  if (method === "POST" && url.pathname === "/owner/settings/remove-agency") {
    controls.agencyCollaboratorActive = false;
    return send(response, 200, "text/html; charset=utf-8", ownerSettingsPage());
  }
  return sendJson(response, 404, { error: "not_found" });
});

const verify = createServer(async (request, response) => {
  if (request.method === "GET" && (request.url ?? "/") === "/healthz") {
    return sendJson(response, 200, { status: "ok" });
  }
  if (request.method !== "POST" || (request.url ?? "/") !== "/verify") {
    return sendJson(response, 404, { error: "not_found" });
  }

  const body = await readJson(request);
  if (!body) return sendJson(response, 400, { error: "invalid_json" });
  const checkpointId = typeof body.checkpointId === "string" ? body.checkpointId : "";
  const known = [...Object.keys(FLAGS), "settings-remediation"];
  if (!known.includes(checkpointId)) {
    return sendJson(response, 400, { error: "unknown_checkpoint" });
  }
  const submission = typeof body.submission === "string" ? body.submission.trim() : "";
  if (submission.length < 1 || submission.length > 200) {
    return sendJson(response, 400, { checkpointId, error: "invalid_submission" });
  }

  const remediated =
    !controls.searchIndexing &&
    !controls.inboxShareActive &&
    !controls.agencyCollaboratorActive;
  const correct =
    checkpointId === "settings-remediation"
      ? submission.toUpperCase() === "VERIFY" && remediated
      : submission === FLAGS[checkpointId];
  return sendJson(response, 200, {
    checkpointId,
    correct,
    message: correct
      ? "Checkpoint cleared."
      : checkpointId === "settings-remediation"
        ? "The owner settings are not fully remediated yet."
        : "That is not the passphrase for this checkpoint.",
  });
});

challenge.listen(8080, "0.0.0.0", () => console.log("challenge on :8080"));
verify.listen(8081, "0.0.0.0", () => console.log("verify on :8081"));
