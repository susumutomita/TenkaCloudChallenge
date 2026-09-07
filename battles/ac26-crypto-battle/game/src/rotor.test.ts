import { artifactFields } from "./ledger-codec.ts";
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMatch, submitOp, type MatchHost } from "../../dev/host.ts";
import { buildScenario } from "../../dev/scenarios.ts";
import { huntOptions, HuntWorkspace } from "../../portal/HuntPanel.tsx";
import { huntFeedback, CipherScoring } from "../../portal/FastMovePanel.tsx";
import RotorMaterials from "../../portal/RotorMaterials.tsx";
import { isCryptoBattleProjection } from "../../portal/coordination.ts";
import { deriveContractPlan, deriveRotorPositions } from "./fixtures.ts";
import { decodeLedger } from "./ledger-codec.ts";
import {
  DEFAULT_CONFIG,
  projectForTeam,
  tick,
  validateOp,
  migrateState,
  STATE_SCHEMA_VERSION,
} from "./reducer.ts";
import { rotorEncrypt, type RotorTaskProjection } from "./rotor.ts";
import { buildReplay } from "./replay.ts";
import { scoreReasons } from "./score-reasons.ts";
import { expandHuntAttempts } from "./hunt-budget.ts";
import type {
  ContractProjection,
  CryptoBattleOp,
  CryptoBattleState,
} from "./types.ts";

const NOW = 36 * 60_000;
const copy = (s: CryptoBattleState): CryptoBattleState =>
  JSON.parse(JSON.stringify(s));
function fresh(): MatchHost {
  const host = createMatch({
    eventId: "local-dev-644",
    teamIds: ["alpha", "bravo"],
    matchSecret: "rotor-reader-5279136",
  });
  host.state = tick(host.state, NOW);
  return host;
}
function order(
  host: MatchHost,
  team = "alpha",
): ContractProjection & { readonly task: RotorTaskProjection } {
  const c = projectForTeam(host.state, team).myContracts.find(
    (c) => c.status === "open" && c.task.kind === "rotor-encrypt",
  );
  if (!c || c.task.kind !== "rotor-encrypt")
    throw new Error("fixture must issue Rotor");
  return { ...c, task: c.task };
}
function play(host: MatchHost, team: string, op: CryptoBattleOp, at = NOW) {
  expect(submitOp(host, team, op, at).kind).toBe("ok");
}
const attack: CryptoBattleOp = {
  kind: "hunt-rotor",
  targetTeamId: "bravo",
  generation: 1,
  a: 1,
  b: 2,
};

describe("Rotor: public wheels, evolving positions, private calculation", () => {
  test("fresh participant-only answers pass the real generator and reducer unchanged, before the existing deadline", () => {
    const host = fresh(),
      own = order(host),
      other = order(host, "bravo");
    expect(host.state.config).toEqual(DEFAULT_CONFIG);
    expect(own.task).toEqual({
      kind: "rotor-encrypt",
      generation: 1,
      plaintext: [3, 2, 3, 2],
      myInitial: { a: 3, b: 2 },
    });
    expect(other.task.plaintext).toEqual([0, 0, 1, 1]);
    expect(own.remainingMs).toBe(300_000);
    const ledger = host.state.publicLedger;
    play(
      host,
      "alpha",
      { kind: "cipher", contractId: own.id, answer: ["3", "2", "2", "3"] },
      NOW + 119_000,
    );
    expect(projectForTeam(host.state, "alpha").lastCipher).toMatchObject({
      outcome: "hit",
      points: 30,
    });
    expect(host.state.publicLedger).toEqual(ledger);
    play(host, "bravo", { kind: "leak", contractId: other.id }, NOW + 120_000);
    const pair = decodeLedger(host.state.publicLedger, host.state.teams).find(
      (a) => a.kind === "rotor-pair",
    )!;
    expect(pair).toMatchObject({
      kind: "rotor-pair",
      plaintext: [0, 0, 1, 1],
      ciphertext: [1, 1, 1, 3],
    });
    expect(pair).not.toHaveProperty("myInitial");
    const before = copy(host.state);
    play(host, "alpha", attack, NOW + 121_000);
    expect(projectForTeam(host.state, "alpha").lastHunt).toMatchObject({
      via: "rotor",
      outcome: "hit",
      points: 25,
    });
    expect(
      scoreReasons(before, host.state, {
        kind: "op",
        teamId: "alpha",
        op: attack,
      }),
    ).toEqual({ alpha: "hunt", bravo: "hunted" });
    expect(validateOp(host.state, "alpha", attack).ok).toBe(false);
    const replay = buildReplay(copy(host.state));
    expect(replay.filter((e) => e.kind === "hunt-success")).toHaveLength(1);
    expect(replay.find((e) => e.kind === "hunt-success")).toMatchObject({
      atMs: NOW + 121_000,
      detail: { via: "rotor", targetTeamId: "bravo", generation: 1 },
    });
  });

  test("scheduled normal pressure slots alternate only Vigenère/Rotor; rush and RSA keep their contracts", () => {
    for (const elapsedMs of [
      0,
      30 * 60_000 - 1,
      30 * 60_000,
      60 * 60_000 - 1,
      60 * 60_000,
    ])
      for (let i = 1; i < 90; i += 5) {
        const c = deriveContractPlan(
          "schedule",
          "alpha",
          i,
          { prime: 97n, shareCount: 5 },
          { elapsedMs, ...DEFAULT_CONFIG.phaseBoundaries },
        );
        if (elapsedMs < 30 * 60_000)
          expect(c).toMatchObject({ taskKind: "caesar-shift", rung: "caesar" });
        else if (c.kind === "rush")
          expect(c).toMatchObject({
            taskKind: "caesar-shift",
            rung: "vigenere",
          });
        else if (elapsedMs >= 60 * 60_000)
          expect(c.taskKind).toBe("rsa-encrypt");
        else
          expect(c.taskKind).toBe(
            Math.floor(i / 5) % 2 === 1 ? "rotor-encrypt" : "caesar-shift",
          );
      }
    const on = fresh(),
      late = createMatch(on.ctx);
    late.state = tick(late.state, NOW + 120_000);
    expect(late.state.contracts.find((c) => c.id === order(on).id)).toEqual(
      on.state.contracts.find((c) => c.id === order(on).id),
    );
    expect(projectForTeam(copy(on.state), "alpha")).toEqual(
      projectForTeam(on.state, "alpha"),
    );
  });

  test("well-formed wrong CIPHER charges six and never restores the reward; format errors cost nothing", () => {
    const host = fresh(),
      own = order(host);
    host.state = {
      ...host.state,
      teams: {
        ...host.state.teams,
        alpha: { ...host.state.teams.alpha!, score: 100 },
      },
    };
    for (const answer of [
      [],
      ["0", "1", "2"],
      ["0", "1", "2", "4"],
      ["0", "1", "2", "1.0"],
      ["0", "1", "2", ""],
    ]) {
      const before = JSON.stringify(host.state);
      expect(
        submitOp(
          host,
          "alpha",
          { kind: "cipher", contractId: own.id, answer },
          NOW,
        ).kind,
      ).toBe("rejected");
      expect(JSON.stringify(host.state)).toBe(before);
    }
    play(host, "alpha", {
      kind: "cipher",
      contractId: own.id,
      answer: ["0", "0", "0", "0"],
    });
    expect(projectForTeam(host.state, "alpha").lastCipher).toMatchObject({
      outcome: "miss",
      points: -6,
    });
    expect(host.state.contracts.find((c) => c.id === own.id)).toMatchObject({
      cipherFailed: true,
      status: "open",
    });
    host.state = copy(host.state);
    play(
      host,
      "alpha",
      { kind: "cipher", contractId: own.id, answer: ["3", "2", "2", "3"] },
      NOW + 1,
    );
    expect(host.state.teams.alpha!.score).toBe(94);
    expect(projectForTeam(host.state, "alpha").lastCipher).toMatchObject({
      outcome: "hit",
      points: 0,
    });
    expect(
      validateOp(host.state, "alpha", {
        kind: "cipher",
        contractId: own.id,
        answer: ["3", "2", "2", "3"],
      }).ok,
    ).toBe(false);
  });

  test("wrong answers share the existing HUNT budget, while invalid/missing/public-old evidence never spends it", () => {
    const host = fresh(),
      other = order(host, "bravo");
    expect(validateOp(host.state, "alpha", attack).ok).toBe(false);
    play(host, "bravo", { kind: "leak", contractId: other.id });
    host.state = {
      ...host.state,
      teams: {
        ...host.state.teams,
        alpha: { ...host.state.teams.alpha!, score: 100 },
        bravo: { ...host.state.teams.bravo!, score: 100 },
      },
    };
    for (const patch of [
      { a: 4 },
      { a: NaN },
      { b: "2" },
      { targetTeamId: "alpha" },
      { targetTeamId: "unknown" },
      { generation: 0 },
      { generation: 2 },
    ]) {
      expect(
        validateOp(host.state, "alpha", {
          ...attack,
          ...patch,
        } as CryptoBattleOp).ok,
      ).toBe(false);
    }
    const forged = {
      ...host.state,
      publicLedger: host.state.publicLedger.map(artifactFields).filter((a) => a.k !== "rotor-pair"),
    };
    expect(validateOp(forged, "alpha", attack).ok).toBe(false);
    const wrong = { ...attack, a: 0 } as CryptoBattleOp;
    play(host, "alpha", wrong);
    expect(projectForTeam(host.state, "alpha").lastHunt).toMatchObject({
      outcome: "miss",
      via: "rotor",
      points: -8,
    });
    const share: CryptoBattleOp = {
      kind: "hunt",
      targetTeamId: "bravo",
      generation: 1,
      recoveredSecret: String(
        (BigInt(host.state.teams.bravo!.secret) + 1n) % 97n,
      ),
    };
    play(host, "alpha", share);
    play(host, "alpha", wrong);
    expect(
      projectForTeam(host.state, "alpha").huntAttempts.bravo,
    ).toMatchObject({ spent: 3, max: 3 });
    expect(validateOp(host.state, "alpha", attack).ok).toBe(false);
    expect(validateOp(host.state, "alpha", share).ok).toBe(false);
    expect(
      projectForTeam(host.state, "alpha").sudokuHuntAttempts.bravo?.spent,
    ).toBe(0);
    const history = copy(host.state).publicLedger;
    play(host, "bravo", { kind: "rotate" });
    expect(host.state.publicLedger).toEqual(history);
    expect(validateOp(host.state, "alpha", attack).ok).toBe(false);
    expect(
      validateOp(host.state, "alpha", {
        ...attack,
        generation: 2,
      } as CryptoBattleOp).ok,
    ).toBe(false);
    expect(projectForTeam(host.state, "alpha").huntAttempts.bravo?.spent).toBe(
      0,
    );
  });

  test("an ambiguous single pair opens the worksheet without leaking candidate counts or granting a hidden uniqueness verdict", () => {
    const host = fresh(),
      other = order(host, "bravo");
    // A valid public row with two compatible states; the court still compares the true initial state.
    host.state = {
      ...host.state,
      contracts: host.state.contracts.map((c) =>
        c.id === other.id
          ? {
              ...c,
              task: { kind: "rotor-encrypt" as const, generation: 1, plaintext: [0, 0, 1, 0] },
            }
          : c,
      ),
    };
    play(host, "bravo", { kind: "leak", contractId: other.id });
    expect(validateOp(host.state, "alpha", attack)).toEqual({ ok: true });
    const view = projectForTeam(host.state, "alpha"),
      target = huntOptions(view).find((o) => o.mode === "rotor")!;
    expect(target.status).toBe("ready");
    for (const locale of ["ja", "en"] as const) {
      const html = renderToStaticMarkup(
        createElement(HuntWorkspace, {
          target,
          projection: view,
          locale,
          submitting: false,
          onSubmit: async () => {},
        }),
      );
      expect(html).toContain("rotor-hunt-a");
      expect(html).toContain("rotor-hunt-b");
      expect(html).toContain(locale === "ja" ? "誤答−8" : "Miss −8");
      expect(html).toContain(
        locale === "ja"
          ? "候補を1つに決められない"
          : "cannot determine one candidate",
      );
      expect(html).not.toContain("recoverableSolutions");
    }
    play(host, "alpha", attack);
    expect(
      huntOptions(projectForTeam(host.state, "alpha")).find(
        (o) => o.mode === "rotor",
      )?.status,
    ).toBe("completed");
    expect(
      huntFeedback(projectForTeam(host.state, "alpha"), "bravo", "ja", "rotor"),
    ).toMatchObject({ kind: "hunt", reward: 25 });
  });

  test("real Portal materials keep formulas free and show only opened, own staged hints", () => {
    const host = fresh(),
      own = order(host),
      baseline = projectForTeam(host.state, "bravo");
    for (const locale of ["ja", "en"] as const) {
      const html = renderToStaticMarkup(
        createElement(RotorMaterials, { task: own.task, locale }),
      );
      expect(html).toContain("P[(m+a) mod 4]");
      expect(html).toContain("Q[(u+b) mod 4]");
      expect(html).toContain("<table");
      expect(html).not.toContain("svg");
      expect(html).not.toContain("rotor-key:");
      const scoring = renderToStaticMarkup(
        createElement(CipherScoring, { order: own, wrongCost: 6, locale }),
      );
      expect(scoring).toContain("30");
      expect(scoring).toContain("6");
    }
    expect(own.hints.every((h) => h.text === undefined)).toBe(true);
    for (let i = 0; i < 3; i++)
      play(host, "alpha", { kind: "reveal-hint", contractId: own.id }, NOW + i);
    const open = order(host);
    expect(open.hints.filter((h) => h.text !== undefined)).toHaveLength(3);
    expect(open.hints[2]?.text?.ja).toContain("a=3, b=2");
    expect(open.hints[2]?.text?.ja).not.toContain("3 2 2 3");
    expect(
      projectForTeam(host.state, "bravo").myContracts.map((c) => c.hints),
    ).toEqual(baseline.myContracts.map((c) => c.hints));
    for (const task of [
      { ...own.task, plaintext: [0, 1, 2, 9] },
      { ...own.task, myInitial: { a: 4, b: 0 } },
      { ...own.task, myInitial: null },
    ])
      expect(
        isCryptoBattleProjection({
          ...projectForTeam(host.state, "alpha"),
          myContracts: [{ ...own, task }],
        }),
      ).toBe(false);
    expect(isCryptoBattleProjection(projectForTeam(host.state, "alpha"))).toBe(
      true,
    );
  });
});

test("schema10 real RSA history, failed CIPHER and packed reservations survive schema11", () => {
  const host = buildScenario("rsa").host,
    now = host.state.nowMs!;
  play(
    host,
    "alpha",
    { kind: "hunt-rsa", targetTeamId: "bravo", generation: 1, p: "7", q: "11" },
    now,
  );
  const rsa = projectForTeam(host.state, "alpha").myContracts.find(
    (c) => c.task.kind === "rsa-encrypt",
  )!;
  play(
    host,
    "alpha",
    { kind: "cipher", contractId: rsa.id, answer: ["0"] },
    now,
  );
  const legacy = {
      ...copy(host.state),
      huntAttempts: { "[0,1,1]": 1, '["sudoku",0,1,1]': 2 },
    },
    before = JSON.stringify(legacy);
  const lifted = migrateState(JSON.parse(before), 10);
  expect(STATE_SCHEMA_VERSION).toBe(18);
  expect(expandHuntAttempts(lifted)).toEqual(legacy.huntAttempts);
  expect(lifted.huntLog).toEqual(legacy.huntLog);
  expect(buildReplay(lifted)).toEqual(buildReplay(legacy));
  for (const team of ["alpha", "bravo"])
    expect(projectForTeam(lifted, team)).toEqual(projectForTeam(legacy, team));
  expect(JSON.stringify(legacy)).toBe(before);
  host.state = copy(lifted);
  play(
    host,
    "alpha",
    { kind: "cipher", contractId: rsa.id, answer: ["37"] },
    now + 1,
  );
  expect(projectForTeam(host.state, "alpha").lastCipher).toMatchObject({
    outcome: "hit",
    points: 0,
  });
});

test("a pressure Rotor Order retains its five-minute deadline into endgame and uses the existing lightning multiplier", () => {
  for (const failFirst of [false, true]) {
    const host = createMatch({
      eventId: "local-dev-644",
      teamIds: ["alpha", "bravo"],
      matchSecret: "rsa-max-110",
    });
    host.state = tick(host.state, 56 * 60_000);
    const target = order(host);
    host.state = tick(host.state, 60 * 60_000);
    const eligible = projectForTeam(host.state, "alpha").myContracts.find(
      (c) => c.id === target.id,
    )!;
    expect(eligible.lightningEligible).toBe(true);
    expect(eligible.remainingMs).toBe(60_000);
    play(
      host,
      "alpha",
      { kind: "declare-lightning", contractId: target.id },
      60 * 60_000,
    );
    const answer = rotorEncrypt(
      target.task.plaintext,
      target.task.myInitial,
    ).map(String);
    if (failFirst)
      play(
        host,
        "alpha",
        {
          kind: "cipher",
          contractId: target.id,
          answer: answer.map((v, i) =>
            i === 0 ? String((Number(v) + 1) % 4) : v,
          ),
        },
        60 * 60_000 + 1,
      );
    host.state = copy(host.state);
    play(
      host,
      "alpha",
      { kind: "cipher", contractId: target.id, answer },
      60 * 60_000 + 2,
    );
    expect(projectForTeam(host.state, "alpha").lastCipher?.points).toBe(
      failFirst ? 0 : 60,
    );
    expect(projectForTeam(host.state, "alpha").lightning).toMatchObject({
      status: "spent",
      outcome: "hit",
      points: failFirst ? 0 : 60,
    });
  }
});

test.each([
  "leak",
  "rotate",
  "deadline",
] as const)("wrong Rotor CIPHER stays forfeited after %s", (cause) => {
  const host = fresh(),
    target = order(host);
  play(host, "alpha", {
    kind: "cipher",
    contractId: target.id,
    answer: ["0", "0", "0", "0"],
  });
  if (cause === "deadline") host.state = tick(copy(host.state), NOW + 300_000);
  else
    play(
      host,
      "alpha",
      cause === "leak"
        ? { kind: "leak", contractId: target.id }
        : { kind: "rotate" },
      NOW + 1,
    );
  const ended = host.state.contracts.find((c) => c.id === target.id)!;
  expect(ended.cipherFailed).toBe(true);
  expect(ended.status).toBe(cause === "leak" ? "completed" : "expired");
  expect(
    validateOp(host.state, "alpha", {
      kind: "cipher",
      contractId: target.id,
      answer: ["3", "2", "2", "3"],
    }).ok,
  ).toBe(false);
});


test("retained Rotor projections preserve their issuance generation after ROTATE", () => {
  for (const complete of [false, true]) {
    const host = fresh();
    const original = order(host);
    if (complete) play(host, "alpha", { kind: "leak", contractId: original.id });
    play(host, "alpha", { kind: "rotate" });
    const reloaded = copy(host.state);
    const retained = projectForTeam(reloaded, "alpha").myContracts.find(c => c.id === original.id)!;
    expect(retained.task).toEqual(original.task);
    expect(retained.status).toBe(complete ? "completed" : "expired");
  }
});
