/** Participant-fidelity rehearsal. Solvers read only rendered evidence and prompts.
 * No game/fixture imports, answer endpoint, private state, or undocumented API calls.
 * Network interception below injects ONE lost response solely to test safe retry.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { chromium, type Page } from "playwright-core";
import { startHarness } from "../dev/server.ts";

type Doc = Record<string, any>;
const harness = await startHarness({ port: 0 });
const executable = Bun.env.BROWSER ?? (await Bun.file("/usr/bin/chromium").exists() ? "/usr/bin/chromium" : undefined);
const browser = await chromium.launch({ ...(executable ? { executablePath: executable } : {}), headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const artifactDir = new URL("../dev/evidence/", import.meta.url).pathname;
await mkdir(artifactDir, { recursive: true });
const errors: string[] = [];
let expectedLostResponse = false;
function watch(page: Page) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !(expectedLostResponse && message.text().includes("net::ERR_FAILED"))) errors.push(message.text());
  });
}
async function safeScreenshot(page: Page, filename: string) {
  const visible = await page.locator("body").innerText();
  for (const seat of harness.seats) assert.equal(visible.includes(seat.token), false, "Practice credentials must not appear in screenshots");
  // Full-page capture must begin at the top so the sticky evidence pane stays aligned.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifactDir}${filename}`, fullPage: true });
}
async function shown(page: Page, id: string) { await page.getByTestId(id).waitFor({ state: "visible" }); }
async function evidence(page: Page, id: string): Promise<Doc> {
  await page.getByTestId(`evidence-${id}`).click();
  const raw = (await page.getByTestId("evidence-content").textContent() ?? "");
  const hash = createHash("sha256").update(raw).digest("hex");
  assert.match(await page.getByTestId("evidence-sha256").innerText(), new RegExp(hash));
  return JSON.parse(raw) as Doc;
}
async function downloadCurrent(page: Page) {
  const raw = (await page.getByTestId("evidence-content").textContent() ?? "");
  const promise = page.waitForEvent("download");
  await page.getByTestId("download-evidence").click();
  const file = await promise;
  const path = `/tmp/forensic-${crypto.randomUUID()}.json`;
  await file.saveAs(path);
  assert.equal(await readFile(path, "utf8"), raw);
  assert.ok(file.suggestedFilename().endsWith(".json"));
  await rm(path);
}
async function fill(page: Page, question: string, answer: string, citations: string[]) {
  await page.getByTestId(`answer-${question}`).fill(answer);
  const boxes = page.getByTestId(`question-${question}`).locator('input[type="checkbox"]');
  for (let i = 0; i < await boxes.count(); i++) await boxes.nth(i).uncheck();
  for (const id of citations) await page.getByTestId(`cite-${question}-${id}`).check();
}
async function solve(page: Page, question: string, answer: string, citations: string[]) {
  await fill(page, question, answer, citations);
  await page.getByTestId(`submit-${question}`).click();
  await page.locator(`[data-testid="result-${question}"][data-status="correct"]`).waitFor();
  await shown(page, `explanation-${question}`);
  assert.equal(await page.getByTestId(`answer-${question}`).count(), 0);
}
async function hints(page: Page, question: string) {
  for (let rung = 1; rung <= 3; rung++) {
    await page.getByTestId(`hint-${question}`).click();
    await page.getByTestId(`hints-${question}`).locator("li").nth(rung - 1).waitFor();
    assert.equal(await page.getByTestId(`hints-${question}`).locator("li").count(), rung);
  }
  assert.equal(await page.getByTestId(`hint-${question}`).count(), 0);
}
function time(item: Doc) { return Date.parse(String(item.time)); }
async function completeVisibleCases(page: Page, locale: "ja" | "en", injectLoss: boolean) {
  await page.getByRole("combobox", { name: "Language / 表示言語" }).selectOption(locale);
  await shown(page, "case-identity");
  await page.getByTestId("case-identity").click();
  const identity = await evidence(page, "I-IDP");
  await downloadCurrent(page);
  const control = await evidence(page, "I-CLOUD");
  const approval = await evidence(page, "I-APPROVAL");
  const limits = await evidence(page, "I-LIMITS");
  const change = control.events.find((e: Doc) => e.operation === "EnableExternalExport");
  const login = identity.events.find((e: Doc) => e.session === change.session);
  assert.ok(login?.account);
  assert.equal(await page.getByTestId("explanation-account").count(), 0);
  await fill(page, "account", "wrong-account", ["I-IDP", "I-CLOUD"]);
  await page.getByTestId("submit-account").click();
  await page.locator('[data-testid="result-account"][data-status="incorrect"]').waitFor();
  assert.equal(await page.getByTestId("answer-account").inputValue(), "wrong-account");
  assert.equal(await page.getByTestId("attempts-account").innerText(), "1");
  assert.equal(await page.getByTestId("score").innerText(), "0 / 400");

  if (injectLoss) {
    const bodies: string[] = [];
    let loseOnce = true;
    expectedLostResponse = true;
    await page.route("**/api/op", async (route) => {
      bodies.push(route.request().postData() ?? "");
      if (loseOnce) { loseOnce = false; await route.fetch(); await route.abort("failed"); }
      else await route.continue();
    });
    await fill(page, "account", login.account, ["I-IDP", "I-CLOUD"]);
    await page.getByTestId("submit-account").click();
    await shown(page, "retry-request");
    assert.equal(await page.getByTestId("answer-account").inputValue(), login.account);
    assert.equal(await page.getByTestId("cite-account-I-IDP").isChecked(), true);
    assert.equal(await page.getByTestId("cite-account-I-CLOUD").isChecked(), true);
    await page.getByTestId("retry-request").click();
    await shown(page, "explanation-account");
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0], bodies[1], "Lost-response retry must retain exact operation ID, revision, answer and citations");
    await page.unroute("**/api/op");
    expectedLostResponse = false;
  } else await solve(page, "account", login.account, ["I-IDP", "I-CLOUD"]);
  assert.equal(await page.getByTestId("score").innerText(), "20 / 400");
  await hints(page, "authority");
  await solve(page, "authority", approval.approved_actions.includes(change.operation) ? "approved" : "unauthorized", ["I-CLOUD", "I-APPROVAL"]);
  assert.ok(limits.not_collected.includes("endpoint recording"));
  await solve(page, "attribution", "session-used;human-unknown", ["I-IDP", "I-CLOUD", "I-LIMITS"]);
  await safeScreenshot(page, `identity-${locale}.png`);

  await page.getByTestId("case-timeline").click();
  const audit = await evidence(page, "T-AUDIT");
  await downloadCurrent(page);
  const objects = await evidence(page, "T-OBJECT");
  const network = await evidence(page, "T-NET");
  const coverage = await evidence(page, "T-COVERAGE");
  const successfulReads: Doc[] = objects.events.filter((e: Doc) => e.status === 200).sort((a: Doc, b: Doc) => time(a) - time(b));
  const receipts: Doc[] = [...new Map<string, Doc>(network.receipts.map((r: Doc) => [r.receipt_id, r])).values()];
  const firstReceipt = [...receipts].sort((a, b) => time(a) - time(b))[0]!;
  const ordered: Doc[] = [...audit.events, successfulReads[0], firstReceipt].sort((a, b) => time(a) - time(b));
  await hints(page, "order");
  await solve(page, "order", ordered.map((e) => e.event_id).join(","), ["T-AUDIT", "T-OBJECT", "T-NET"]);
  let bytes = 0; const confirmed: string[] = []; const unresolved: string[] = [];
  for (const read of successfulReads) {
    const ranges = receipts.filter((r) => r.request_id === read.request_id && r.object_sha256 === read.sha256 && r.status === "received").map((r) => [Number(r.range_start), Number(r.range_end_exclusive)] as const).sort((a, b) => a[0] - b[0]);
    let end = 0, covered = 0;
    for (const [start, stop] of ranges) { covered += Math.max(0, stop - Math.max(start, end)); end = Math.max(end, stop); }
    bytes += covered;
    if (covered === read.body_bytes) confirmed.push(read.object);
    else { assert.ok(time(read) >= Date.parse(coverage.outbound_gap_utc[0]) && time(read) <= Date.parse(coverage.outbound_gap_utc[1])); unresolved.push(read.object); }
  }
  await solve(page, "bytes", String(bytes), ["T-OBJECT", "T-NET"]);
  await solve(page, "scope", `confirmed=${confirmed.join(",")};unresolved=${unresolved.join(",")}`, ["T-OBJECT", "T-NET", "T-COVERAGE"]);
  await safeScreenshot(page, `timeline-${locale}.png`);

  await page.getByTestId("case-recovery").click();
  const access = await evidence(page, "B-ACCESS");
  await downloadCurrent(page);
  const damage = await evidence(page, "B-AUDIT");
  const catalog = await evidence(page, "B-CATALOG");
  const restore = await evidence(page, "B-RESTORE");
  const firstDamage = damage.events.find((e: Doc) => e.kind === "first_destructive_write");
  const backupDeletion = damage.events.find((e: Doc) => e.kind === "delete_backup" && e.result === "success");
  const shared = access.grants.find((g: Doc) => g.resource === firstDamage.resource && g.actions.includes("delete") && access.grants.some((b: Doc) => b.resource === backupDeletion.resource && b.role === g.role && b.actions.includes("delete")));
  assert.equal(shared.role, backupDeletion.role);
  await hints(page, "trust");
  await solve(page, "trust", shared.role, ["B-ACCESS", "B-AUDIT"]);
  const passing = restore.tests.find((r: Doc) => r.result === "passed" && r.mounted && r.decrypt_key_test === "passed" && r.restored_manifest_sha256 === r.known_clean_manifest_sha256);
  const copy = catalog.copies.find((c: Doc) => c.copy_id === passing.copy_id && c.status === "available");
  assert.equal(copy.location, access.separation.vault);
  assert.ok(access.separation.explicitly_denies.includes(shared.role));
  await solve(page, "copy", copy.copy_id, ["B-ACCESS", "B-CATALOG", "B-RESTORE"]);
  const loss = (time(firstDamage) - Date.parse(copy.checkpoint_utc)) / 60000;
  const ready = restore.unperformed.some((item: string) => item.includes("production cutover")) ? "no" : "yes";
  await solve(page, "assurance", `loss_window_minutes=${loss};production_ready=${ready}`, ["B-AUDIT", "B-CATALOG", "B-RESTORE"]);
  assert.equal(await page.getByTestId("score").innerText(), "300 / 400");
  await safeScreenshot(page, `recovery-${locale}.png`);
  await page.getByTestId("case-endpoint").click();
  const inv = await evidence(page, "E-INVENTORY");
  await downloadCurrent(page);
  const approved = await evidence(page, "E-APPROVAL");
  const hist = await evidence(page, "E-HISTORY");
  await evidence(page, "E-PLAN");
  const recurring = hist.events.find((e: Doc) => e.action === "recreate-file");
  const bad = inv.tasks.find((t: Doc) => t.id === recurring.task && approved.unapproved_hashes.includes(t.hash));
  assert.ok(bad);
  await hints(page, "diagnose");
  await solve(page, "diagnose", `suspect=${bad.id};unknown=${inv.unresolved_object}`, ["E-INVENTORY", "E-APPROVAL", "E-HISTORY"]);
  await solve(page, "preserve", "snapshot", ["E-INVENTORY", "E-APPROVAL", "E-HISTORY", "E-PLAN"]);
  const custody = await evidence(page, "E-OBSERVATION");
  assert.equal(custody.custody.length, 3);
  for (const saved of custody.custody) assert.equal(createHash("sha256").update(saved.original_content).digest("hex"), saved.sha256);
  await fill(page, "contain", `disable=${approved.approved.task};quarantine=vendor-update;block=all`, ["E-INVENTORY", "E-APPROVAL", "E-HISTORY", "E-PLAN"]);
  await page.getByTestId("submit-contain").click();
  await page.locator('[data-testid="result-contain"][data-status="incorrect"]').waitFor();
  await solve(page, "contain", `disable=${bad.id};quarantine=${bad.target};block=${bad.target}`, ["E-INVENTORY", "E-APPROVAL", "E-HISTORY", "E-PLAN"]);
  const normal = inv.tasks.find((t: Doc) => t.id === approved.approved.task);
  await solve(page, "restore", `restore=${normal.target};keep=${normal.id}`, ["E-INVENTORY", "E-APPROVAL", "E-PLAN"]);
  await solve(page, "reboot", "reboot", ["E-OBSERVATION", "E-PLAN"]);
  const obs = await evidence(page, "E-OBSERVATION");
  assert.equal(obs.reboot_count, 1);
  assert.equal(obs.post_reboot.suspect_execution_count, 0);
  assert.equal(obs.post_reboot.normal_update, "success");
  await solve(page, "assessment", `recurrence=${obs.post_reboot.recreated.length ? "yes" : "no"};normal=${obs.post_reboot.normal_update === "success" ? "yes" : "no"};scope=simulation`, ["E-OBSERVATION", "E-APPROVAL"]);
  assert.equal(await page.getByTestId("score").innerText(), "400 / 400");
  await safeScreenshot(page, `endpoint-${locale}.png`);
}
try {
  const firstContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const first = await firstContext.newPage(); watch(first);
  const second = await secondContext.newPage(); watch(second);
  await first.goto(harness.seats[0]!.url);
  await second.goto(harness.seats[1]!.url);
  await shown(second, "case-identity");
  const otherInitialEvidence = (await second.getByTestId("evidence-content").textContent() ?? "");
  await completeVisibleCases(first, "ja", true);
  assert.equal(await second.getByTestId("score").innerText(), "0 / 400", "One seat must not receive another seat's points");
  assert.equal(await second.getByTestId("attempts-account").innerText(), "0");
  await completeVisibleCases(second, "en", false);
  assert.equal(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "390px viewport must have no horizontal page overflow");
  await safeScreenshot(second, "mobile-en.png");
  await first.getByTestId("case-identity").click();
  const before = (await first.getByTestId("evidence-content").textContent() ?? "");
  await first.getByTestId("practice-reset").click();
  assert.equal(await first.getByTestId("confirm-reset").isDisabled(), true);
  assert.equal(await first.getByTestId("score").innerText(), "400 / 400");
  await first.getByTestId("confirm-reset-checkbox").check();
  await first.getByTestId("confirm-reset").click();
  await first.getByTestId("answer-account").waitFor();
  assert.equal(await first.getByTestId("practice-generation").innerText(), "2");
  assert.equal(await first.getByTestId("score").innerText(), "0 / 400");
  assert.notEqual((await first.getByTestId("evidence-content").textContent() ?? ""), before);
  assert.equal(await second.getByTestId("score").innerText(), "400 / 400");
  await second.getByTestId("case-identity").click();
  await second.getByTestId("evidence-I-IDP").click();
  assert.equal((await second.getByTestId("evidence-content").textContent() ?? ""), otherInitialEvidence);
  await first.setViewportSize({ width: 390, height: 844 });
  assert.equal(await first.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await safeScreenshot(first, "mobile-ja-fresh.png");
  assert.deepEqual(errors, [], "No unexpected browser errors");
  console.log("PASS: participant-only evidence solves all 15 checkpoints in JA and EN; exact lost-response retry, wrong-answer recovery, 3-rung hints, downloads+SHA256, two-seat isolation, confirmed fresh reset, 390px layout, no unexpected browser errors.");
} finally { await browser.close(); harness.server.stop(true); }
