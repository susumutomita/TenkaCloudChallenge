import { createHmac } from "node:crypto";

/**
 * security-hype-lp — the per-run scenario.
 *
 * Every value a participant has to find (and the verifier has to judge) is derived
 * here from the injected FLAG_SEED, so no answer is committed and two deployments do
 * not share answers. All company, product, person and domain names are fictional and
 * every domain uses the reserved `.example` TLD.
 */

export const OFFICIAL_DOMAIN = "kageroshield.example";

const LOOKALIKE_DOMAINS = [
  "kager0shield.example",
  "kageroshie1d.example",
  "kageroshleld.example",
  "kagerosheild.example",
  "kagero-shield.example",
  "kageroshield-support.example",
];

const OTHER_HOLDERS = ["ナギサ物流株式会社", "ひばり製菓株式会社", "こだま運輸株式会社", "あおば精工株式会社"];

function assertSeed(seed) {
  if (typeof seed !== "string" || !/^[a-f0-9]{64}$/.test(seed)) {
    throw new Error("FLAG_SEED must be an injected 64-character hexadecimal secret.");
  }
}

/** Deterministic integer in [min, max] for one labelled draw. */
function draw(seed, label, min, max) {
  const digest = createHmac("sha256", seed).update(`security-hype-lp:${label}`).digest();
  return min + (digest.readUInt32BE(0) % (max - min + 1));
}

const pad = (value, width) => String(value).padStart(width, "0");

export function scenarioFor(seed) {
  assertSeed(seed);
  const badgeNumbers = [0, 1, 2].map((i) => `FS-${pad(draw(seed, `badge-${i}`, 10000, 99999), 5)}`);
  // Keep the three numbers distinct so "which one" always has one answer.
  if (new Set(badgeNumbers).size !== 3) badgeNumbers[2] = `FS-${pad(((Number(badgeNumbers[0].slice(3)) + 4321) % 90000) + 10000, 5)}`;
  const stockId = draw(seed, "stock-id", 1000, 9999);
  const otherStockId = stockId === 9999 ? 1000 : stockId + 1 + draw(seed, "stock-gap", 0, 9999 - stockId - 1);
  const officialPhone = `03-${pad(draw(seed, "phone-official-a", 1000, 9999), 4)}-${pad(draw(seed, "phone-official-b", 0, 9999), 4)}`;
  const supportPhone = `050-${pad(draw(seed, "phone-fake-a", 1000, 9999), 4)}-${pad(draw(seed, "phone-fake-b", 0, 9999), 4)}`;
  return Object.freeze({
    countdownMinutes: draw(seed, "countdown", 12, 57),
    claimedCustomers: 12000,
    paidCustomers: draw(seed, "paid-customers", 17, 96),
    badgeNumbers: Object.freeze(badgeNumbers),
    fakeBadgeIndex: draw(seed, "fake-badge", 0, 2),
    fakeBadgeHolder: OTHER_HOLDERS[draw(seed, "fake-holder", 0, OTHER_HOLDERS.length - 1)],
    stockId,
    otherStockId,
    officialPhone,
    supportPhone,
    lookalikeDomain: LOOKALIKE_DOMAINS[draw(seed, "lookalike", 0, LOOKALIKE_DOMAINS.length - 1)],
  });
}

/** checkpointId → the value this run expects, in its normalized comparison form. */
export function expectedAnswers(scenario) {
  return Object.freeze({
    "campaign-timer": String(scenario.countdownMinutes),
    "customer-count": String(scenario.paidCustomers),
    "cert-badges": scenario.badgeNumbers[scenario.fakeBadgeIndex].replace(/[^A-Z0-9]/g, ""),
    "customer-voices": String(scenario.stockId),
    "support-line": scenario.supportPhone.replace(/\D/g, ""),
    "mail-sender": scenario.lookalikeDomain,
  });
}
