import { createHash } from "node:crypto";
import { createServer } from "node:http";

/**
 * wix-exposure-audit — a browser-completable teaching target for TenkaCloud local
 * play. It does NOT use real Wix; it is a small mock of a SaaS-built business site
 * that reproduces one very common operational-neglect scenario: a production agency
 * left a public "share link" to the contact-form inbox live after launch, so anyone
 * who finds the link can read every customer inquiry (names, emails, messages).
 *
 * The point is NOT a code vulnerability — it is a settings/operations mistake a
 * non-engineer owner is responsible for: revoke share links and departed-agency
 * access, and review where form submissions go. Never expose it off loopback; the
 * compose file binds it to 127.0.0.1 only.
 *
 * Two servers run in one process:
 *   :8080  the published business site the participant audits
 *   :8081  the loopback `/verify` endpoint the TenkaCloud scorer delegates to
 *
 * The flag and the stale share token are derived from FLAG_SEED at runtime, so
 * nothing secret is committed and each deploy is unique.
 */

const FLAG_SEED = process.env.FLAG_SEED ?? "local-dev-seed";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const FLAG = `TC{wixshare_${sha256(`flag:${FLAG_SEED}`).slice(0, 20)}}`;
// The share link the agency generated and never revoked. Unknowable → the intended
// path is to find it in the published site, not to guess it.
const SHARE_TOKEN = `share-${sha256(`share:${FLAG_SEED}`).slice(0, 16)}`;

// Customer contact-form submissions. The last one is an audit canary whose message
// IS the flag: if you can read this inbox from the outside, so can anyone.
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
    message: `【自動監査】この受信箱が第三者に見えているなら運用不備です。合言葉を控えてください: ${FLAG}`,
  },
];

function send(response, status, contentType, body) {
  response.writeHead(status, { "content-type": contentType });
  response.end(body);
}
function sendJson(response, status, payload) {
  send(response, status, "application/json", JSON.stringify(payload));
}

const SITE = `<!doctype html>
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
  お問い合わせの受信箱は共有リンクで確認できます ->
  /admin/inbox?share=${SHARE_TOKEN}
-->
<header>
  <h1>Aoi Design Studio</h1>
  <p>名刺・ロゴ・パンフレットのデザイン工房</p>
</header>
<main>
  <div class="card">
    <h2>私たちについて</h2>
    <p>小さなデザインスタジオです。中小事業者さまのブランドづくりをお手伝いしています。</p>
  </div>
  <div class="card">
    <h2>お問い合わせ</h2>
    <form method="post" action="/api/contact">
      <label>お名前 <input name="name" required></label>
      <label>メール <input name="email" type="email" required></label>
      <label>ご相談内容 <textarea name="message" rows="4" required></textarea></label>
      <button type="submit">送信する</button>
    </form>
  </div>
</main>
<footer>制作: Kanade Web制作所 &middot; プレビュー環境</footer>
</body></html>`;

function inboxPage() {
  const rows = INBOX.map(
    (m) => `<tr><td>${m.name}</td><td>${m.email}</td><td>${m.message}</td></tr>`,
  ).join("");
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>お問い合わせ受信箱 — Aoi Design Studio</title>
<style>
  body{font-family:system-ui;max-width:52rem;margin:2rem auto;padding:0 1rem;color:#1b2a3a}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #e2e8f0;padding:.5rem;text-align:left;vertical-align:top}
  th{background:#f1f5f9}
  .warn{background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:.8rem}
</style></head>
<body>
<h1>お問い合わせ受信箱</h1>
<p class="warn">この共有リンクを知っている人は誰でも、以下の個人情報を閲覧できます。</p>
<table>
  <tr><th>お名前</th><th>メール</th><th>ご相談内容</th></tr>
  ${rows}
</table>
</body></html>`;
}

const challenge = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const { method } = request;

  if (method === "GET" && url.pathname === "/healthz") {
    return sendJson(response, 200, { status: "ok" });
  }
  if (method === "GET" && url.pathname === "/") {
    return send(response, 200, "text/html; charset=utf-8", SITE);
  }
  // For realism: the public form accepts submissions. Not needed to solve.
  if (method === "POST" && url.pathname === "/api/contact") {
    return send(response, 200, "text/html; charset=utf-8", "<p>送信しました。ありがとうございます。</p>");
  }
  // The neglected surface: the agency's share link to the form inbox was never
  // revoked. Anyone holding the (findable) share token reads all customer PII.
  if (method === "GET" && url.pathname === "/admin/inbox") {
    if (url.searchParams.get("share") !== SHARE_TOKEN) {
      return send(response, 403, "text/html; charset=utf-8", "<p>この共有リンクは無効です。</p>");
    }
    return send(response, 200, "text/html; charset=utf-8", inboxPage());
  }
  return sendJson(response, 404, { error: "not_found" });
});

const verify = createServer(async (request, response) => {
  if (request.method !== "POST" || (request.url ?? "/") !== "/verify") {
    return sendJson(response, 404, { error: "not_found" });
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  let submission = "";
  try {
    submission = String(JSON.parse(Buffer.concat(chunks).toString("utf8")).submission ?? "");
  } catch {
    submission = "";
  }
  const correct = submission.trim() === FLAG;
  // The failure message must not leak the expected flag or scoring internals.
  sendJson(response, 200, {
    correct,
    message: correct ? "Flag accepted." : "That is not the flag for this challenge.",
  });
});

challenge.listen(8080, "0.0.0.0", () => console.log("challenge on :8080"));
verify.listen(8081, "0.0.0.0", () => console.log("verify on :8081"));
