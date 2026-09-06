import { rsaHuntKey, pruneRetiredRsaHunts, huntKey } from "./hunt-key.ts";
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMatch, submitOp, type MatchHost } from "../../dev/host.ts";
import { huntOptions, HuntWorkspace } from "../../portal/HuntPanel.tsx";
import RsaMaterials from "../../portal/RsaMaterials.tsx";
import { CipherScoring, tacticAvailability, rotateVoidCount } from "../../portal/FastMovePanel.tsx";
import { isCryptoBattleProjection } from "../../portal/coordination.ts";
import { disclosurePreview } from "../../portal/OrderFocus.tsx";
import { deriveRsaKey } from "./fixtures.ts";
import { pow } from "./field.ts";
import { decodeLedger, encodeLedger } from "./ledger-codec.ts";
import { DEFAULT_CONFIG, migrateState, projectForTeam, tick, validateOp } from "./reducer.ts";
import { isSmallPrime, rsaEncrypt, rsaFactorsFit, type RsaTask } from "./rsa.ts";
import { buildFheOp } from "./playtest.ts";
import { scoreReasons } from "./score-reasons.ts";
import type { ContractProjection, CryptoBattleOp, CryptoBattleState } from "./types.ts";

const MINUTE = 60_000, NOW = 61 * MINUTE;
const checkpoint = (state: CryptoBattleState): CryptoBattleState => JSON.parse(JSON.stringify(state));
function match(): MatchHost {
  const host = createMatch({ eventId: "local-dev-644", teamIds: ["alpha", "bravo"], matchSecret: "rsa-max-110" });
  host.state = tick(host.state, NOW);
  return host;
}
function rsaOrder(host: MatchHost, team = "alpha"): ContractProjection & { task: RsaTask } {
  const order = projectForTeam(host.state, team).myContracts.find(c => c.status === "open" && c.task.kind === "rsa-encrypt");
  if (!order || order.task.kind !== "rsa-encrypt") throw new Error("fixture needs a normal RSA Order");
  return { ...order, task: order.task };
}
function withScores(host: MatchHost) {
  host.state = { ...host.state, teams: Object.fromEntries(Object.entries(host.state.teams).map(([id, team]) => [id, { ...team, score: 100 }])) };
  return host;
}
function cipher(id: string, value: string): CryptoBattleOp { return { kind: "cipher", contractId: id, answer: [value] }; }
const hunt: CryptoBattleOp = { kind: "hunt-rsa", targetTeamId: "bravo", generation: 1, p: "7", q: "11" };

function screenAnswer(task: RsaTask) {
  // Independent participant worksheet: repeated integer multiplication, no server helper.
  let remainder = 1;
  for (let i = 0; i < task.e; i++) { const value = remainder * task.plaintext; remainder = value - Math.floor(value / task.n) * task.n; }
  return String(remainder);
}

describe("small textbook RSA, with public encryption and a separate recovery key", () => {
  test("every generated key works for every residue, including multiples of a factor", () => {
    const pairs = new Set<string>();
    for (let generation = 1; generation <= 80; generation++) {
      const key = deriveRsaKey("parameter-sweep", "alpha", generation);
      expect(isSmallPrime(key.p) && isSmallPrime(key.q)).toBe(true);
      expect(key.p).not.toBe(key.q);
      expect(key.p * key.q).toBe(key.n); expect(key.n).toBeLessThanOrEqual(77);
      const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
      const lambda = (key.p - 1) * (key.q - 1) / gcd(key.p - 1, key.q - 1);
      expect(gcd(key.e, lambda)).toBe(1);
      for (let m = 0; m < key.n; m++) {
        const c = rsaEncrypt(m, key);
        expect(Number(pow(BigInt(c), BigInt(key.d), BigInt(key.n)))).toBe(m);
        expect(c).toBe(Number(BigInt(m) ** BigInt(key.e) % BigInt(key.n)));
      }
      pairs.add(`${key.n}/${key.e}`);
    }
    expect(pairs).toEqual(new Set(["33/3", "55/3", "65/5", "77/7"]));
    expect(rsaEncrypt(4, { n: 33, e: 3 })).toBe(31);
    for (const d of [7, 17, 27]) expect(Number(pow(31n, BigInt(d), 33n))).toBe(4); // no canonical d requirement
  });

  test("the scheduled endgame boundary replaces only normal cipher slots; rush and earlier Orders keep their task", () => {
    const host = createMatch({ eventId: "local-dev-644", teamIds: ["alpha", "bravo"], matchSecret: "rsa-max-110" });
    host.state = tick(host.state, 56 * MINUTE);
    const prior = host.state.contracts.find(c => c.teamId === "alpha" && c.task.kind === "caesar-shift" && c.status === "open")!;
    expect(prior.task).toMatchObject({ rung: "vigenere" });
    const boundary = tick(checkpoint(host.state), 60 * MINUTE);
    expect(boundary.contracts.find(c => c.id === prior.id)?.task).toEqual(prior.task);
    expect(projectForTeam(tick(host.state, 60 * MINUTE - 1), "alpha").publicRsaKeys).toEqual([]);
    expect(projectForTeam(boundary, "alpha").publicRsaKeys).toHaveLength(2);
    const onTime = tick(checkpoint(boundary), NOW), late = tick(checkpoint(boundary), NOW + 120_000);
    const current = onTime.contracts.find(c => c.teamId === "alpha" && c.task.kind === "rsa-encrypt" && c.status === "open")!;
    expect(current).toMatchObject({ kind: "standard", points: 30, expiresAtMs: NOW + 300_000 });
    expect(late.contracts.find(c => c.id === current.id)).toEqual(current);
    let rushSeen = false;
    for (let minute = 61; minute < 86; minute += 5) {
      host.state = tick(host.state, minute * MINUTE);
      const open = host.state.contracts.filter(c => c.status === "open");
      for (const c of open) {
        if (c.task.kind === "rsa-encrypt") expect(c.kind).toBe("standard");
        if (c.task.kind === "caesar-shift") { expect(c).toMatchObject({ kind: "rush", points: 45, task: { rung: "vigenere" } }); expect(c.expiresAtMs - c.issuedAtMs).toBe(150_000); rushSeen = true; }
      }
      for (const id of ["alpha", "bravo"]) expect(open.filter(c => c.teamId === id)).toHaveLength(6);
    }
    expect(rushSeen).toBe(true);
    expect(projectForTeam(checkpoint(late), "alpha")).toEqual(projectForTeam(late, "alpha"));
  });

  test("the independently read maximum packet submits 37 and [7,11] through the real reducer within five minutes", () => {
    for (const locale of ["ja", "en"] as const) {
      const host = withScores(match()), order = rsaOrder(host);
      expect(host.state.config).toEqual(DEFAULT_CONFIG);
      expect(order.task).toEqual({ kind: "rsa-encrypt", n: 77, e: 7, plaintext: 9 });
      expect(order.remainingMs).toBe(300_000); expect(screenAnswer(order.task)).toBe("37");
      expect(order.hints.every(h => h.text === undefined)).toBe(true);
      for (const seconds of [5, 10, 15]) expect(submitOp(host, "alpha", { kind: "reveal-hint", contractId: order.id }, NOW + seconds * 1000).kind).toBe("ok");
      const hints = rsaOrder(host).hints.map(h => h.text![locale]);
      expect(hints[0]).toContain(locale === "ja" ? "公開鍵" : "public key"); expect(hints[1]).toContain("r4×r2×m");
      expect(hints[2]).toContain("m=9、n=77、e=7".replaceAll("、", locale === "ja" ? "、" : ", "));
      const before = checkpoint(host.state);
      expect(submitOp(host, "alpha", cipher(order.id, "37"), NOW + 24_000).kind).toBe("ok");
      expect(host.state.teams.alpha!.score - before.teams.alpha!.score).toBe(30);
      expect(host.state.publicLedger).toEqual(before.publicLedger);
      expect(scoreReasons(before, host.state, { kind: "op", teamId: "alpha", op: cipher(order.id, "37") })).toEqual({ alpha: "cipher" });
      expect(submitOp(host, "alpha", cipher(order.id, "37"), NOW + 25_000).kind).toBe("rejected");
      const beforeHunt = checkpoint(host.state);
      expect(submitOp(host, "alpha", hunt, NOW + 26_000).kind).toBe("ok");
      expect(host.state.teams.alpha!.score - beforeHunt.teams.alpha!.score).toBe(25);
      expect(host.state.teams.bravo!.score - beforeHunt.teams.bravo!.score).toBe(-12);
      expect(scoreReasons(beforeHunt, host.state, { kind: "op", teamId: "alpha", op: hunt })).toEqual({ alpha: "hunt", bravo: "hunted" });
      expect(huntOptions(projectForTeam(host.state, "alpha")).find(o => o.mode === "rsa" && o.teamId === "bravo")?.status).toBe("completed");
    }
  });

  test("only own plaintext and every current public n/e project; no factors, recovery exponent or opponent answer", () => {
    const host = match(), own = projectForTeam(host.state, "alpha"), other = projectForTeam(host.state, "bravo");
    for (const key of own.publicRsaKeys!) expect(Object.keys(key).sort()).toEqual(["e", "generation", "n", "teamId"]);
    expect(own.publicRsaKeys).toEqual(other.publicRsaKeys);
    expect(own.myContracts.every(c => !c.id.startsWith("bravo-"))).toBe(true);
    expect(Object.keys(rsaOrder(host).task).sort()).toEqual(["e", "kind", "n", "plaintext"]);
    expect(JSON.stringify(own)).not.toContain(host.state.seed);
    expect(own.publicLedger.some(a => a.kind === "rsa-pair")).toBe(false);
    expect(isCryptoBattleProjection(JSON.parse(JSON.stringify(own)))).toBe(true);
  });

  test("LEAK publishes the real m/c and public key without any factor, and compact checkpoints preserve it", () => {
    const host = withScores(match()), order = rsaOrder(host), before = checkpoint(host.state);
    expect(submitOp(host, "alpha", { kind: "leak", contractId: order.id }, NOW).kind).toBe("ok");
    expect(host.state.teams.alpha!.score - before.teams.alpha!.score).toBe(10);
    const pair = projectForTeam(host.state, "bravo").publicLedger.find(a => a.kind === "rsa-pair")!;
    expect(pair).toEqual({ id: `${order.id}-pair`, kind: "rsa-pair", teamId: "alpha", generation: 1, method: "leak", contractId: order.id, n: 77, e: 7, plaintext: 9, ciphertext: 37, postedAtMs: NOW });
    expect(encodeLedger(decodeLedger(host.state.publicLedger))).toEqual([...host.state.publicLedger]);
    expect(projectForTeam(checkpoint(host.state), "bravo").publicLedger).toEqual(projectForTeam(host.state, "bravo").publicLedger);
    expect(disclosurePreview(projectForTeam(host.state, "alpha"), order, "ja")).toContain("元の数 m と暗号の答え c");
  });

  test("well-formed wrong CIPHER charges the existing six points and permanently forfeits the reward, including lightning", () => {
    const host = withScores(match()), order = rsaOrder(host);
    expect(submitOp(host, "alpha", { kind: "declare-lightning", contractId: order.id }, NOW).kind).toBe("ok");
    expect(submitOp(host, "alpha", cipher(order.id, "38"), NOW + 1).kind).toBe("ok");
    expect(host.state.teams.alpha!.score).toBe(94);
    expect(rsaOrder(host)).toMatchObject({ cipherFailed: true, points: 0, lightningEligible: false });
    expect(projectForTeam(host.state, "alpha").lightning).toMatchObject({ status: "armed", points: 0 });
    host.state = checkpoint(host.state);
    expect(submitOp(host, "alpha", cipher(order.id, "37"), NOW + 2).kind).toBe("ok");
    expect(host.state.teams.alpha!.score).toBe(94);
    expect(projectForTeam(host.state, "alpha").lightning).toMatchObject({ status: "spent", outcome: "hit", points: 0 });
    expect(submitOp(host, "alpha", cipher(order.id, "37"), NOW + 3).kind).toBe("rejected");
  });

  test("clean declared RSA doubles the existing 30 exactly once", () => {
    const host = withScores(match()), order = rsaOrder(host);
    expect(submitOp(host, "alpha", { kind: "declare-lightning", contractId: order.id }, NOW).kind).toBe("ok");
    expect(rsaOrder(host).points).toBe(60);
    expect(submitOp(host, "alpha", cipher(order.id, "37"), NOW + 1).kind).toBe("ok");
    expect(host.state.teams.alpha!.score).toBe(160);
    expect(projectForTeam(host.state, "alpha").lastCipher).toMatchObject({ outcome: "hit", points: 60 });
  });

  for (const ending of ["leak", "rotate", "deadline"] as const) test(`wrong-answer state survives ${ending}, never revives its 30 point reward`, () => {
    const host = withScores(match()), order = rsaOrder(host);
    expect(submitOp(host, "alpha", cipher(order.id, "38"), NOW).kind).toBe("ok");
    if (ending === "deadline") host.state = tick(host.state, NOW + 300_000);
    else expect(submitOp(host, "alpha", ending === "leak" ? { kind: "leak", contractId: order.id } : { kind: "rotate" }, NOW + 1).kind).toBe("ok");
    host.state = checkpoint(host.state);
    expect(host.state.contracts.find(c => c.id === order.id)?.cipherFailed).toBe(true);
    expect(submitOp(host, "alpha", cipher(order.id, "37"), host.state.nowMs!).kind).toBe("rejected");
  });

  test("malformed/out-of-range answers have no charge, attempt history or lost declaration eligibility", () => {
    for (const answer of [[], [""], ["77"], ["-1"], ["1e1"], ["03"], [3], ["1", "2"], ["9".repeat(10000)], null]) {
      const host = withScores(match()), order = rsaOrder(host), before = checkpoint(host.state);
      expect(submitOp(host, "alpha", { kind: "cipher", contractId: order.id, answer } as CryptoBattleOp, NOW).kind).toBe("rejected");
      expect(host.state).toEqual(before); expect(rsaOrder(host).lightningEligible).toBe(true);
    }
  });

  test("factor HUNT is unordered, public-key-only, bounded and isolated by team/generation/phase", () => {
    const host = withScores(match());
    expect(host.state.publicLedger).toEqual([]);
    expect(rsaFactorsFit(77, "11", "7")).toBe(true);
    for (const patch of [{ p: "1", q: "77" }, { p: "7", q: "7" }, { p: "2", q: "35" }, { p: "7.0" }, { p: "07" }, { p: 7 }, { p: "9".repeat(10000) }, { generation: 0 }, { generation: 2 }, { generation: undefined }, { targetTeamId: "alpha" }, { targetTeamId: "__proto__", generation: undefined }, { targetTeamId: "absent" }]) {
      const before = checkpoint(host.state);
      expect(validateOp(host.state, "alpha", { ...hunt, ...patch } as CryptoBattleOp).ok).toBe(false);
      expect(host.state).toEqual(before);
    }
    expect(validateOp({ ...host.state, phase: "pressure" }, "alpha", hunt).ok).toBe(false);
    expect(validateOp(tick(host.state, 90 * MINUTE), "alpha", hunt).ok).toBe(false);
    expect(submitOp(host, "alpha", { ...hunt, p: "11", q: "7" } as CryptoBattleOp, NOW).kind).toBe("ok");
    expect(host.state.successfulHunts).toContain('r1:1');
    expect(rsaHuntKey({ teams: Object.fromEntries(Object.entries(host.state.teams).reverse()) }, "alpha", "bravo", 1)).toBe('r1:1');
    host.state = checkpoint(host.state);
    expect(submitOp(host, "alpha", hunt, NOW + 1).kind).toBe("rejected");
    expect(submitOp(host, "bravo", { kind: "rotate" }, NOW + 2).kind).toBe("ok");
    expect(validateOp(host.state, "alpha", hunt).ok).toBe(false);
    expect(host.state.successfulHunts).not.toContain('r1:1');
    const key = projectForTeam(host.state, "alpha").publicRsaKeys!.find(k => k.teamId === "bravo")!;
    const p = [2, 3, 5, 7, 11, 13].find(p => key.n % p === 0)!;
    expect(submitOp(host, "alpha", { kind: "hunt-rsa", targetTeamId: "bravo", generation: 2, p: String(p), q: String(key.n / p) }, NOW + 3).kind).toBe("ok");
    expect(host.state.teams.bravo!.cipherHuntedGenerations.rsa).toEqual([1, 2]);
    const legacySuccess = huntKey("rsa", "bravo", 1);
    const historical = { ...host.state, successfulHunts: [...host.state.successfulHunts, legacySuccess, '["sudoku","alpha","bravo",1]', '["cipher","caesar","alpha","bravo",1]'] };
    expect(pruneRetiredRsaHunts(historical).successfulHunts).toEqual(historical.successfulHunts);
  });

  test("v9 migration retains an armed lightning card, compact attempts, public ledger and failed Vigenère before issuing RSA", () => {
    const host = createMatch({ eventId: "migration", teamIds: ["alpha", "bravo"], matchSecret: "migration" });
    host.state = tick(host.state, 56 * MINUTE);
    const oldOrder = host.state.contracts.find(c => c.teamId === "alpha" && c.task.kind === "caesar-shift")!;
    if (oldOrder.task.kind !== "caesar-shift") throw new Error("expected old Vigenere");
    expect(submitOp(host, "alpha", { kind: "cipher", contractId: oldOrder.id, answer: ["0"] }, 56 * MINUTE).kind).toBe("ok");
    // One may equal zero. Ensure a well-formed failure on this real Order.
    if (!host.state.contracts.find(c => c.id === oldOrder.id)?.cipherFailed) throw new Error("migration fixture must have a real wrong answer");
    expect(submitOp(host, "alpha", { kind: "leak", contractId: oldOrder.id }, 56 * MINUTE + 1).kind).toBe("ok");
    const bravoTask = projectForTeam(host.state, "bravo").myContracts.find(c => c.status === "open" && c.allowedMethods.includes("fhe"))!;
    expect(submitOp(host, "bravo", buildFheOp(bravoTask, "97")!, 56 * MINUTE + 2).kind).toBe("ok");
    host.state = tick(host.state, 60 * MINUTE);
    const target = projectForTeam(host.state, "alpha").myContracts.find(c => c.status === "open" && c.allowedMethods.includes("fhe"))!;
    expect(submitOp(host, "alpha", { kind: "declare-lightning", contractId: target.id }, 60 * MINUTE).kind).toBe("ok");
    host.state = { ...host.state, huntAttempts: { "[0,1,1]": 1, '["sudoku",0,1,1]': 2 } };
    const source = checkpoint(host.state), migrated = migrateState(checkpoint(source), 9);
    expect(migrated).toEqual(source);
    expect(migrated.publicLedger.some(a => a.k === "cipher-pair")).toBe(true);
    expect(migrated.contracts.some(c => c.task.kind === "rsa-encrypt")).toBe(false);
    expect(migrated.contracts.find(c => c.id === oldOrder.id)?.cipherFailed).toBe(true);
    host.state = migrated;
    const before = host.state.teams.alpha!.score;
    expect(submitOp(host, "alpha", buildFheOp(target, "97")!, 60 * MINUTE + 1).kind).toBe("ok");
    expect(host.state.teams.alpha!.score - before).toBe(60);
    expect(projectForTeam(tick(host.state, NOW), "alpha").publicRsaKeys).toHaveLength(2);
  });

  test("Portal gates malformed and mixed-version RSA data and displays only a calculation worksheet", () => {
    const host = match(), view = projectForTeam(host.state, "alpha"), order = rsaOrder(host);
    for (const publicRsaKeys of [null, {}, [{}], [{ teamId: "bravo", generation: 1, n: 1e100, e: 7 }], [{ teamId: "other", generation: 1, n: 77, e: 7 }], [{ teamId: "bravo", generation: 2, n: 77, e: 7 }]]) expect(isCryptoBattleProjection({ ...view, publicRsaKeys })).toBe(false);
    expect(isCryptoBattleProjection({ ...view, publicRsaKeys: undefined })).toBe(true);
    expect(huntOptions({ ...view, publicRsaKeys: undefined }).find(o => o.mode === "rsa")?.status).toBe("unknown");
    const option = huntOptions(view).find(o => o.mode === "rsa" && o.teamId === "bravo")!;
    expect(option.status).toBe("ready");
    expect(tacticAvailability(view).rotate).toBe(true);
    expect(rotateVoidCount(view)).toBe(5); // the sixth Order is a continuing DUEL
    const openBefore = host.state.contracts.filter(c => c.status === "open" && c.teamId === "alpha");
    expect(openBefore).toHaveLength(6);
    for (const locale of ["ja", "en"] as const) {
      const material = renderToStaticMarkup(createElement(RsaMaterials, { task: order.task, locale }));
      expect(material).toContain("m^e mod n"); expect(material).toContain("3×3=9"); expect(material).not.toContain("m=9、n=77、e=7");
      expect(material).not.toContain("r4×r2"); // own-value guided decomposition stays in purchased hints
      const form = renderToStaticMarkup(createElement(HuntWorkspace, { target: option, projection: view, locale, submitting: false, onSubmit: async () => {} }));
      expect(form).toContain(locale === "ja" ? "素数 p" : "Prime factor p"); expect(form).toContain(locale === "ja" ? "素数 q" : "Prime factor q");
      expect(form).toContain(locale === "ja" ? "元に戻す鍵" : "recovery key"); expect(form).toContain("d=27"); expect(form).not.toContain('value="7"');
      const warning = renderToStaticMarkup(createElement(CipherScoring, { order: { ...order, cipherFailed: true, points: 0 }, wrongCost: 6, locale }));
      expect(warning).toContain(locale === "ja" ? "0点で再挑戦" : "Retry for 0 points");
    }
  });
});

test("every generated RSA parameter set has usable three-stage hints and a real private CIPHER", () => {
  const seen = new Set<number>();
  for (let sample = 0; sample < 100 && seen.size < 4; sample++) {
    const host = createMatch({ eventId: "all-rsa", teamIds: ["alpha", "bravo"], matchSecret: `rsa-${sample}` });
    host.state = tick(host.state, NOW);
    const found = projectForTeam(host.state, "alpha").myContracts.find(c => c.status === "open" && c.task.kind === "rsa-encrypt");
    if (!found || found.task.kind !== "rsa-encrypt" || seen.has(found.task.n)) continue;
    seen.add(found.task.n);
    for (const second of [1, 2, 3]) expect(submitOp(host, "alpha", { kind: "reveal-hint", contractId: found.id }, NOW + second * 1000).kind).toBe("ok");
    for (const locale of ["ja", "en"] as const) {
      const hints = rsaOrder(host).hints.map(h => h.text![locale]);
      expect(hints.every(text => text.length > 0)).toBe(true);
      expect(hints[2]).toContain(String(found.task.n));
    }
    const before = host.state.teams.alpha!.score;
    expect(submitOp(host, "alpha", cipher(found.id, screenAnswer(found.task)), NOW + 120_000).kind).toBe("ok");
    expect(host.state.teams.alpha!.score - before).toBe(30);
    expect(host.state.publicLedger).toEqual([]);
  }
  expect(seen).toEqual(new Set([33, 55, 65, 77]));
});

test("the actual participant bundle omits key generation, match fixture seed and locked RSA hints", async () => {
  const result = await Bun.build({ entrypoints: [new URL("../../portal/StatusPanel.tsx", import.meta.url).pathname], target: "browser", external: ["react", "react-dom"] });
  expect(result.success).toBe(true);
  const bundle = (await Promise.all(result.outputs.map(output => output.text()))).join("\n");
  for (const privateMarker of ["deriveRsaKey", "RSA_PARAMETERS", "rsa-max-110", "rsa-plaintext:", "rsa-key:", "Finish this one Order before moving on.", "自分の値：m="]) expect(bundle).not.toContain(privateMarker);
  expect(bundle).toContain("m^e mod n");
});
