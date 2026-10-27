import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { OFFICIAL_DOMAIN, scenarioFor } from "../app/scenario.mjs";
import { siteServer } from "../app/site.mjs";
import { judge, verifierServer } from "../app/verifier.mjs";

const SEED = "a".repeat(64);

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function withServers(seed, fn) {
  const site = siteServer(seed);
  const verifier = verifierServer(seed);
  const web = await listen(site);
  const judgeUrl = await listen(verifier);
  try {
    await fn(web, judgeUrl);
  } finally {
    site.close();
    verifier.close();
  }
}

const get = async (url) => {
  const response = await fetch(url);
  assert.equal(response.status, 200, url);
  return response.text();
};

async function verify(base, checkpointId, submission) {
  const response = await fetch(`${base}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ checkpointId, submission, context: {} }),
  });
  return { status: response.status, body: await response.json() };
}

/** Solve every checkpoint using only what a participant can open from the landing page. */
async function solveFromVisibleSurfaces(web) {
  const landing = await get(`${web}/`);
  for (const link of ["/company", "/ir", "/evidence/"]) assert.ok(landing.includes(`href="${link}"`), link);
  const evidence = await get(`${web}/evidence/`);
  for (const file of ["mail.eml", "chat-log.txt", "registry.html", "whois.txt"]) assert.ok(evidence.includes(`/evidence/${file}`));

  const minutes = /data-window-minutes="(\d+)"/.exec(landing)[1];

  const ir = await get(`${web}/ir`);
  const paid = /有償でご契約いただいている法人数は (\d+) 社/.exec(ir)[1];

  const registry = await get(`${web}/evidence/registry.html`);
  const badges = [...landing.matchAll(/登録番号 (FS-\d{5})/g)].map((m) => m[1]);
  assert.equal(badges.length, 3);
  const fake = badges.filter((number) => !new RegExp(`<td>${number}</td><td>カゲロウシールド株式会社</td>`).test(registry));
  assert.equal(fake.length, 1);

  const portraits = [...landing.matchAll(/\/assets\/stock\/(\d{4})\.svg/g)].map((m) => m[1]);
  const reused = portraits.find((id, i) => portraits.indexOf(id) !== i);
  assert.ok(reused);
  const svg = await get(`${web}/assets/stock/${reused}.svg`);
  assert.ok(svg.includes(`item #${reused}`));

  const company = await get(`${web}/company`);
  const official = /代表電話<\/th><td>([\d-]+)/.exec(company)[1];
  const chat = await get(`${web}/evidence/chat-log.txt`);
  const phones = [...new Set([...landing.matchAll(/直通 <strong>([\d-]+)/g), ...chat.matchAll(/直通 ([\d-]+)/g)].map((m) => m[1]))];
  assert.equal(phones.length, 1);
  assert.notEqual(phones[0], official);
  assert.ok(ir.includes(official));

  const mail = await get(`${web}/evidence/mail.eml`);
  const sender = /^From: .*<[^@]+@([^>]+)>$/m.exec(mail)[1];
  assert.notEqual(sender, OFFICIAL_DOMAIN);
  assert.ok(ir.includes(`<code>${OFFICIAL_DOMAIN}</code>`));
  assert.ok(landing.includes(`portal.${sender}/intake`), "the form's hidden relay points at the same lookalike domain");
  assert.ok((await get(`${web}/evidence/whois.txt`)).includes(`Domain Name: ${sender}\nRegistrant Organization: REDACTED FOR PRIVACY\nCreation Date: 2026-10-23`));

  return {
    "campaign-timer": minutes,
    "customer-count": paid,
    "cert-badges": fake[0],
    "customer-voices": reused,
    "support-line": phones[0],
    "mail-sender": sender,
  };
}

test("seed is required and every value is derived from it", () => {
  for (const bad of [undefined, "", "local-dev-seed", "A".repeat(64), "a".repeat(63)]) {
    assert.throws(() => scenarioFor(bad), /FLAG_SEED/);
  }
  assert.deepEqual(scenarioFor(SEED), scenarioFor(SEED));
  const values = new Set(Array.from({ length: 20 }, () => JSON.stringify(scenarioFor(randomBytes(32).toString("hex")))));
  assert.ok(values.size > 15);
});

test("scenario invariants hold across many seeds", () => {
  for (let i = 0; i < 500; i++) {
    const s = scenarioFor(randomBytes(32).toString("hex"));
    assert.equal(new Set(s.badgeNumbers).size, 3);
    assert.notEqual(s.stockId, s.otherStockId);
    assert.notEqual(s.supportPhone, s.officialPhone);
    assert.notEqual(s.lookalikeDomain, OFFICIAL_DOMAIN);
    assert.ok(s.lookalikeDomain.endsWith(".example"));
    assert.ok(s.countdownMinutes >= 12 && s.countdownMinutes <= 57);
  }
});

test("each checkpoint is solvable from visible surfaces and judged correct", async () => {
  for (const seed of [SEED, randomBytes(32).toString("hex"), randomBytes(32).toString("hex")]) {
    await withServers(seed, async (web, judgeUrl) => {
      const answers = await solveFromVisibleSurfaces(web);
      for (const [checkpointId, answer] of Object.entries(answers)) {
        const { status, body } = await verify(judgeUrl, checkpointId, answer);
        assert.equal(status, 200);
        assert.deepEqual(body, { checkpointId, correct: true, message: "Checkpoint cleared." }, checkpointId);
      }
    });
  }
});

test("reasonable answer spellings are accepted", () => {
  const s = scenarioFor(SEED);
  const m = s.countdownMinutes;
  for (const v of [`${m}`, `${m}分`, ` ${m} minutes `, `00:${m}:00`, `${m}:00`, `00:${m}`]) assert.ok(judge(s, "campaign-timer", v), v);
  for (const v of [`${s.paidCustomers}`, `${s.paidCustomers}社`, `${s.paidCustomers} 社`]) assert.ok(judge(s, "customer-count", v), v);
  const badge = s.badgeNumbers[s.fakeBadgeIndex];
  for (const v of [badge, badge.toLowerCase(), badge.replace("-", "")]) assert.ok(judge(s, "cert-badges", v), v);
  for (const v of [`${s.stockId}`, `#${s.stockId}`, `/assets/stock/${s.stockId}.svg`]) assert.ok(judge(s, "customer-voices", v), v);
  for (const v of [s.supportPhone, s.supportPhone.replace(/-/g, ""), `０５０${s.supportPhone.slice(3)}`]) assert.ok(judge(s, "support-line", v), v);
  for (const v of [s.lookalikeDomain, `portal.${s.lookalikeDomain}`, `https://portal.${s.lookalikeDomain}/diagnosis`, `shindan@${s.lookalikeDomain}`, s.lookalikeDomain.toUpperCase()]) {
    assert.ok(judge(s, "mail-sender", v), v);
  }
});

test("the decoys a hurried reader would submit are rejected without leaking the answer", async () => {
  const s = scenarioFor(SEED);
  const decoys = {
    "campaign-timer": ["15", String(s.countdownMinutes + 1), "3", ""],
    "customer-count": ["12000", "12,000", "200", String(s.paidCustomers + 1)],
    "cert-badges": s.badgeNumbers.filter((_, i) => i !== s.fakeBadgeIndex),
    "customer-voices": [String(s.otherStockId)],
    "support-line": [s.officialPhone],
    "mail-sender": [OFFICIAL_DOMAIN, `www.${OFFICIAL_DOMAIN}`, "hinata-foods.example", `evil${s.lookalikeDomain}`],
  };
  await withServers(SEED, async (_web, judgeUrl) => {
    for (const [checkpointId, values] of Object.entries(decoys)) {
      for (const value of values) {
        const { status, body } = await verify(judgeUrl, checkpointId, value);
        if (value === "") {
          assert.equal(status, 400);
          continue;
        }
        assert.equal(status, 200);
        assert.equal(body.checkpointId, checkpointId);
        assert.equal(body.correct, false, `${checkpointId}=${value}`);
        assert.equal(body.message, "That is not the answer for this checkpoint.");
      }
    }
    assert.equal((await verify(judgeUrl, "not-a-checkpoint", "x")).status, 400);
    const malformed = await fetch(`${judgeUrl}/verify`, { method: "POST", body: "{" });
    assert.equal(malformed.status, 400);
  });
  // Another run's answers do not carry over.
  const other = scenarioFor("b".repeat(64));
  assert.equal(judge(other, "support-line", s.supportPhone), s.supportPhone === other.supportPhone);
});

test("the diagnosis form posts locally, stores and echoes nothing, and the page exposes no verifier", async () => {
  await withServers(SEED, async (web) => {
    const landing = await get(`${web}/`);
    assert.match(landing, /<form method="post" action="\/diagnosis"/);
    assert.ok(landing.includes("訓練用の架空サイトです"));
    const marker = `canary-${randomBytes(6).toString("hex")}`;
    const response = await fetch(`${web}/diagnosis`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ company: marker, admin_password: marker, otp: "123456" }),
    });
    assert.equal(response.status, 200);
    const receipt = await response.text();
    assert.ok(receipt.includes("保存も転送もしていません"));
    assert.ok(!receipt.includes(marker));
    for (const path of ["/verify", "/healthz/../verify", "/assets/stock/0000.svg", "/evidence/../app/verifier.mjs", "/scenario.mjs"]) {
      assert.notEqual((await fetch(`${web}${path}`)).status, 200, path);
    }
    assert.equal((await fetch(`${web}/`, { method: "DELETE" })).status, 405);
  });
});

test("only fictional .example domains appear on the surface", async () => {
  await withServers(SEED, async (web) => {
    const pages = await Promise.all(
      ["/", "/company", "/ir", "/evidence/", "/evidence/mail.eml", "/evidence/chat-log.txt", "/evidence/registry.html", "/evidence/whois.txt"].map((p) => get(`${web}${p}`)),
    );
    let hosts = 0;
    for (const text of pages) {
      // Hosts in URLs, mail addresses and mail/registry headers.
      for (const [, host] of text.matchAll(/(?:https?:\/\/|@|Domain Name: |by |from |<code>)([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
        if (host === "www.w3.org") continue; // the SVG namespace URI, not a link
        hosts++;
        assert.ok(host.toLowerCase().endsWith(".example"), host);
      }
    }
    assert.ok(hosts >= 10);
  });
});
