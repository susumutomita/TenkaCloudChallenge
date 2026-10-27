import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { OFFICIAL_DOMAIN, scenarioFor } from "./scenario.mjs";

/**
 * security-hype-lp — the participant surface (:8080).
 *
 * A fictional security vendor's landing page plus the material a colleague forwarded.
 * It is an analysis target, not an exploit: nothing here is vulnerable on purpose and
 * nothing collects data. The "free diagnosis" form posts only to this container, whose
 * handler drains and discards the body without logging or storing it. Every page carries
 * a training banner. All names and domains are fictional (`.example`).
 */

const TRAINING_BANNER = `<div class="training" role="note">訓練用の架空サイトです (TenkaCloud)。実在する ID・パスワード・個人情報は入力しないでください。<br>Training site with fictional content. Never enter real credentials or personal data.</div>`;

const STYLE = `<style>
body{font-family:system-ui,sans-serif;margin:0;background:#fff;color:#1b1b1f;line-height:1.6}
.training{background:#fff3b0;color:#3d3200;padding:.4rem 1rem;font-size:.85rem;text-align:center;border-bottom:1px solid #e0c200}
main,header,footer{max-width:60rem;margin:0 auto;padding:1rem}
.hero{background:linear-gradient(135deg,#0b1f4b,#3a0b4b);color:#fff;padding:2.5rem 1rem;text-align:center}
.hero h1{font-size:2rem;margin:.2rem 0}.stat{font-size:2.6rem;font-weight:800}
.ticker{display:inline-block;background:#ff2d55;color:#fff;font-weight:700;padding:.2rem .8rem;border-radius:1rem}
.logos,.badges,.voices{display:flex;flex-wrap:wrap;gap:1rem;justify-content:center}
.logo{border:1px solid #ccd;padding:.6rem 1rem;border-radius:.4rem;color:#556;font-weight:700}
.badge{border:2px solid #c9a227;border-radius:50%;width:9rem;height:9rem;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-size:.8rem}
.voice{border:1px solid #dde;border-radius:.6rem;padding:1rem;width:16rem}.voice img{width:64px;height:64px;border-radius:50%}
.timer{font-size:1.8rem;font-family:ui-monospace,monospace;color:#d70022;font-weight:800}
form{border:1px solid #ccd;border-radius:.6rem;padding:1rem;max-width:30rem;margin:0 auto}
label{display:block;margin:.5rem 0}input{width:100%;padding:.4rem;box-sizing:border-box}
.chat{position:fixed;right:1rem;bottom:1rem;width:18rem;background:#fff;border:1px solid #889;border-radius:.6rem;box-shadow:0 4px 16px #0003;font-size:.85rem}
.chat h3{margin:0;padding:.5rem;background:#0b1f4b;color:#fff;border-radius:.6rem .6rem 0 0;font-size:.9rem}.chat p{margin:.5rem}
.fineprint{font-size:9px;color:#f2f2f2;line-height:1.2}
table{border-collapse:collapse}td,th{border:1px solid #ccd;padding:.3rem .6rem}
</style>`;

function page(title, body) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>${STYLE}</head>
<body>${TRAINING_BANNER}${body}</body></html>`;
}

const BADGES = [
  ["セキュア運用", "GOLD"],
  ["AI 安全性", "適合"],
  ["クラウド防御", "LEVEL 3"],
];

export function renderLanding(s) {
  const badges = BADGES.map(
    ([name, grade], i) =>
      `<div class="badge"><strong>${name}</strong><span>${grade}</span><small>架空セキュリティ認証機構</small><small>登録番号 ${s.badgeNumbers[i]}</small></div>`,
  ).join("");
  const voices = [
    ["あおば精工株式会社 情報システム部長 佐藤 様", s.stockId, "導入した翌日から攻撃がゼロになりました。もう他の製品には戻れません。"],
    ["こだま運輸株式会社 CISO 田中 様", s.otherStockId, "AI が全部やってくれるので、担当者の残業がなくなりました。"],
    ["ひばり製菓株式会社 代表取締役 鈴木 様", s.stockId, "監査対応も AI が自動化。取引先からの信頼が一気に上がりました。"],
  ]
    .map(
      ([who, id, quote]) =>
        `<figure class="voice"><img src="/assets/stock/${id}.svg" alt="${who}"><blockquote>「${quote}」</blockquote><figcaption>${who}</figcaption></figure>`,
    )
    .join("");
  return page(
    "カゲロウシールド | AI が攻撃を 99.9% 遮断",
    `<header><strong>KAGERO SHIELD</strong> カゲロウシールド株式会社</header>
<section class="hero">
  <p><span class="ticker">メディア掲載多数 / 株価も 3 日連続ストップ高!</span></p>
  <h1>次世代 AI が、あらゆるサイバー攻撃を 99.9% 遮断<sup>※2</sup></h1>
  <p>独自の量子インスパイア型 AI エンジン「AURORA SENTINEL」搭載<sup>※3</sup></p>
  <p>導入企業 <span class="stat">${s.claimedCustomers.toLocaleString("ja-JP")}</span> 社突破<sup>※1</sup></p>
</section>
<main>
  <h2>多くの企業様に選ばれています<sup>※4</sup></h2>
  <div class="logos"><span class="logo">AOBA SEIKO</span><span class="logo">KODAMA LOGISTICS</span><span class="logo">HIBARI FOODS</span><span class="logo">NAGISA</span><span class="logo">MINATO WORKS</span><span class="logo">SORA BANK (架空)</span></div>
  <h2>第三者認証を取得</h2>
  <div class="badges">${badges}</div>
  <h2>お客様の声<sup>※5</sup></h2>
  <div class="voices">${voices}</div>
  <h2 id="campaign">無料セキュリティ診断キャンペーン</h2>
  <p>先着 <strong>残り 3 社</strong>。キャンペーン終了まで</p>
  <p class="timer" id="timer" data-window-minutes="${s.countdownMinutes}">--:--:--</p>
  <form method="post" action="/diagnosis" autocomplete="off">
    <p>今すぐ無料診断 (所要 1 分)。管理者アカウントで当社 AI が貴社環境を直接スキャンします。</p>
    <input type="hidden" name="relay" value="https://portal.${s.lookalikeDomain}/intake">
    <label>会社名 <input name="company" placeholder="(訓練) 架空の値を入れてください"></label>
    <label>業務メールアドレス <input name="email" placeholder="(訓練) 架空の値を入れてください"></label>
    <label>社内メール管理者アカウント ID <input name="admin_id" placeholder="(訓練) 架空の値を入れてください"></label>
    <label>管理者パスワード <input name="admin_password" type="password" placeholder="(訓練) 架空の値を入れてください"></label>
    <label>認証アプリのワンタイムコード (6 桁) <input name="otp" inputmode="numeric" placeholder="(訓練) 架空の値を入れてください"></label>
    <button type="submit">無料で診断する</button>
  </form>
</main>
<aside class="chat" aria-label="サポートチャット">
  <h3>公式サポート (AI オペレーター)</h3>
  <p>こんにちは! ただいま貴社向けの<strong>優先診断枠</strong>をご用意しています。</p>
  <p>枠の確保は本日中のみです。お急ぎの方は診断デスク直通 <strong>${s.supportPhone}</strong> までお電話ください。担当者がお電話で管理者設定をお手伝いします。</p>
</aside>
<footer>
  <p><a href="/company">会社概要</a> ・ <a href="/ir">IR 情報</a> ・ <a href="/evidence/">(訓練) 同僚から転送された資料</a></p>
  <p class="fineprint">※1 導入企業数は、無料診断・資料請求でご登録いただいたアカウント数の累計です。有償でご契約中の法人数は、IR 情報「当社製品に関する一部報道について」をご参照ください。※2 遮断率は、当社検証環境において既知の検体 200 件を用いて測定した値であり、未知の攻撃に対する効果を保証するものではありません。※3 「AI」は一部機能におけるルールベース判定を含む総称です。※4 掲載ロゴには導入をご検討中の企業様を含みます。※5 お客様の声はイメージです。個人の感想であり、効果を保証するものではありません。</p>
</footer>
<script>
// Counts down from a window that starts when this page is loaded.
(() => {
  const el = document.getElementById("timer");
  const deadline = Date.now() + Number(el.dataset.windowMinutes) * 60 * 1000;
  const two = (n) => String(n).padStart(2, "0");
  const tick = () => {
    const left = Math.max(0, deadline - Date.now());
    const sec = Math.floor(left / 1000);
    el.textContent = two(Math.floor(sec / 3600)) + ":" + two(Math.floor((sec % 3600) / 60)) + ":" + two(sec % 60);
  };
  tick();
  setInterval(tick, 1000);
})();
</script>`,
  );
}

export function renderCompany(s) {
  return page(
    "会社概要 | カゲロウシールド",
    `<main><h1>会社概要</h1>
<table>
<tr><th>商号</th><td>カゲロウシールド株式会社 (架空)</td></tr>
<tr><th>Web サイト</th><td>https://www.${OFFICIAL_DOMAIN}/</td></tr>
<tr><th>代表電話</th><td>${s.officialPhone} (平日 9:00〜18:00)</td></tr>
<tr><th>事業内容</th><td>セキュリティ製品の開発・販売</td></tr>
</table>
<p><a href="/">トップへ戻る</a></p></main>`,
  );
}

export function renderIr(s) {
  return page(
    "IR 情報 | カゲロウシールド",
    `<main><h1>IR 情報</h1>
<article><h2>当社製品に関する一部報道について</h2>
<p>一部報道および SNS において当社製品の導入状況に関する記載がございますが、当社が公表した数値ではございません。
2026 年 9 月末時点で、当社製品を<strong>有償でご契約いただいている法人数は ${s.paidCustomers} 社</strong>です。
Web サイトに記載の導入企業数は、無料診断・資料請求のアカウント登録数の累計であり、有償契約数ではありません。</p>
<p>当社株価の変動について、現時点で開示すべき決定事実・発生事実はございません。</p></article>
<article><h2>当社を名乗る不審な連絡にご注意ください</h2>
<p>当社が電子メールで使用するドメインは <code>${OFFICIAL_DOMAIN}</code> のみです。当社窓口の電話番号は代表 ${s.officialPhone} のみであり、
当社がメール・チャット・電話で<strong>パスワードやワンタイムコードを伺うことはありません</strong>。</p></article>
<p><a href="/">トップへ戻る</a></p></main>`,
  );
}

export function renderEvidenceIndex() {
  return page(
    "転送された資料",
    `<main><h1>同僚から転送された資料 (訓練用)</h1>
<p>経理部の同僚から「このメールの案内どおり無料診断を申し込んでいいか」と相談があった。添付された資料は次のとおり。</p>
<ul>
<li><a href="/evidence/mail.eml">mail.eml</a> — 経理部に届いた案内メール (原文)</li>
<li><a href="/evidence/chat-log.txt">chat-log.txt</a> — 同僚が LP のサポートチャットとやりとりした記録</li>
<li><a href="/evidence/registry.html">registry.html</a> — 架空セキュリティ認証機構の公開登録台帳 (写し)</li>
<li><a href="/evidence/whois.txt">whois.txt</a> — ドメイン登録情報の照会結果</li>
</ul>
<p><a href="/">LP へ</a></p></main>`,
  );
}

export function renderMail(s) {
  return `Return-Path: <bounce@mailer.${s.lookalikeDomain}>
Received: from mailer.${s.lookalikeDomain} (unknown [192.0.2.44])
\tby mx.hinata-foods.example with ESMTP; Mon, 26 Oct 2026 09:12:03 +0900
Authentication-Results: mx.hinata-foods.example; spf=pass smtp.mailfrom=mailer.${s.lookalikeDomain}; dkim=none; dmarc=none header.from=${s.lookalikeDomain}
From: "カゲロウシールド 診断センター" <shindan@${s.lookalikeDomain}>
Reply-To: support@${s.lookalikeDomain}
To: keiri@hinata-foods.example
Subject: 【至急】貴社アカウントへの不審なログインについて (無料セキュリティ診断のご案内)
Date: Mon, 26 Oct 2026 09:12:00 +0900
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 8bit

ひなた食品株式会社 経理部 ご担当者様

いつもお世話になっております。カゲロウシールド 診断センターでございます。
貴社 情報システム部 ご担当者様よりご紹介をいただき、ご連絡しております。

当社 AI が、貴社ドメインに対する不審なログインの試みを検知いたしました。
被害拡大を防ぐため、本日 18:00 までに下記より無料セキュリティ診断をお申し込みください。
期限を過ぎますと、優先対応枠が他社様へ移ります。

  無料診断のお申し込み: https://portal.${s.lookalikeDomain}/diagnosis

診断には管理者アカウントでの確認が必要です。フォームが開けない場合は、
診断デスク直通 ${s.supportPhone} までお電話ください。担当者が設定をご案内します。

※本メールは情報システム部様には共有済みです。お手数ですが返信は不要です。

カゲロウシールド 診断センター
`;
}

export function renderChatLog(s) {
  return `[2026-10-26 09:31] 訪問者: メールで診断の案内をもらったのですが、本当に御社からのものですか?
[2026-10-26 09:31] 公式サポート (AI): はい、当社からのご案内です。ご安心ください。
[2026-10-26 09:32] 公式サポート (AI): 本日中のお申し込みで優先診断枠を確保できます。残りわずかです。
[2026-10-26 09:32] 訪問者: フォームで管理者パスワードまで聞かれるのが不安で…
[2026-10-26 09:33] 公式サポート (AI): ご不安でしたら、診断デスク直通 ${s.supportPhone} にお電話ください。担当者が口頭で管理者パスワードとワンタイムコードを確認し、設定を代行いたします。
[2026-10-26 09:33] 公式サポート (AI): なお、代表電話は混み合っておりますので、必ずこちらの直通番号へおかけください。
`;
}

export function renderRegistry(s) {
  const rows = [
    ...s.badgeNumbers.map((number, i) =>
      i === s.fakeBadgeIndex
        ? [number, s.fakeBadgeHolder, "個人情報管理 基本", "有効"]
        : [number, "カゲロウシールド株式会社", `${BADGES[i][0]} ${BADGES[i][1]}`, "有効"],
    ),
    [`FS-${String((Number(s.badgeNumbers[0].slice(3)) + 137) % 90000 + 10000)}`, "みなと工業株式会社", "セキュア運用 SILVER", "有効"],
    [`FS-${String((Number(s.badgeNumbers[1].slice(3)) + 911) % 90000 + 10000)}`, "そら情報サービス株式会社", "クラウド防御 LEVEL 2", "失効"],
  ]
    // A decoy row never reuses one of the landing page's numbers.
    .filter((row, index, all) => all.findIndex((other) => other[0] === row[0]) === index)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("\n");
  return page(
    "公開登録台帳 | 架空セキュリティ認証機構",
    `<main><h1>架空セキュリティ認証機構 公開登録台帳 (写し)</h1>
<p>認証マークの登録番号から、認証を受けた事業者と認証の種類を確認できます。認証マークは、台帳に記載された事業者・認証の種類に限り表示できます。</p>
<table><tr><th>登録番号</th><th>事業者名</th><th>認証の種類</th><th>状態</th></tr>
${body}</table>
<p><a href="/evidence/">資料一覧へ</a></p></main>`,
  );
}

export function renderWhois(s) {
  return `% 架空レジストリ照会結果 (訓練用)

Domain Name: ${OFFICIAL_DOMAIN}
Registrant Organization: カゲロウシールド株式会社
Creation Date: 2009-04-01T00:00:00Z
Updated Date: 2026-03-31T00:00:00Z

Domain Name: ${s.lookalikeDomain}
Registrant Organization: REDACTED FOR PRIVACY
Creation Date: 2026-10-23T02:41:00Z
Updated Date: 2026-10-23T02:41:00Z
`;
}

/** Same illustrated "stock portrait" for an ID; the description names the stock library item. */
export function renderPortrait(id) {
  const hue = (id * 47) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<title>stock portrait #${id}</title>
<desc>Fictional stock photo library, item #${id} (business person, smiling). Licensed for illustrative use only.</desc>
<rect width="64" height="64" fill="hsl(${hue},55%,85%)"/>
<circle cx="32" cy="25" r="12" fill="hsl(${hue},30%,45%)"/>
<path d="M10 64c2-14 12-20 22-20s20 6 22 20z" fill="hsl(${hue},30%,35%)"/>
</svg>`;
}

const TRAINING_RECEIPT = page(
  "(訓練) 送信を受け付けませんでした",
  `<main><h1>ここで止まって正解です (訓練)</h1>
<p>このフォームは訓練用で、入力内容は保存も転送もしていません。</p>
<p>本物の「無料診断」が管理者パスワードやワンタイムコードを求めることはありません。送ってしまった場合は、すぐにパスワードを変更し、情報システム部門へ報告してください。</p>
<p><a href="/">LP へ戻る</a></p></main>`,
);

function requestPath(target) {
  try {
    return new URL(String(target ?? "/").replace(/^\/+/, "/"), "http://127.0.0.1").pathname;
  } catch {
    return "/__malformed_request__";
  }
}

function send(response, status, contentType, body) {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(body);
}

/** Read and throw away a request body, bounded, so nothing submitted is ever kept. */
function discardBody(request) {
  return new Promise((resolve) => {
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 16 * 1024) request.destroy();
    });
    request.on("end", resolve);
    request.on("close", resolve);
    request.on("error", resolve);
  });
}

export function siteServer(seed) {
  const s = scenarioFor(seed);
  const html = "text/html; charset=utf-8";
  const text = "text/plain; charset=utf-8";
  const routes = new Map([
    ["/", () => [html, renderLanding(s)]],
    ["/company", () => [html, renderCompany(s)]],
    ["/ir", () => [html, renderIr(s)]],
    ["/evidence/", () => [html, renderEvidenceIndex()]],
    ["/evidence/mail.eml", () => [text, renderMail(s)]],
    ["/evidence/chat-log.txt", () => [text, renderChatLog(s)]],
    ["/evidence/registry.html", () => [html, renderRegistry(s)]],
    ["/evidence/whois.txt", () => [text, renderWhois(s)]],
  ]);
  const portraits = new Set([s.stockId, s.otherStockId]);
  const server = createServer(async (request, response) => {
    const path = requestPath(request.url);
    if (request.method === "POST" && path === "/diagnosis") {
      await discardBody(request);
      return send(response, 200, html, TRAINING_RECEIPT);
    }
    if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405, text, "method not allowed");
    if (path === "/healthz") return send(response, 200, "application/json", JSON.stringify({ status: "ok" }));
    const portrait = /^\/assets\/stock\/(\d{4})\.svg$/.exec(path);
    if (portrait && portraits.has(Number(portrait[1]))) {
      return send(response, 200, "image/svg+xml", renderPortrait(Number(portrait[1])));
    }
    const route = routes.get(path === "/evidence" ? "/evidence/" : path);
    if (!route) return send(response, 404, text, "not found");
    const [type, body] = route();
    return send(response, 200, type, body);
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = siteServer(process.env.FLAG_SEED);
  delete process.env.FLAG_SEED;
  server.listen(8080, "0.0.0.0", () => console.log("site on :8080"));
}
