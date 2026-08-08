import { describe, expect, it } from "bun:test";
import type { Server } from "node:http";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "challenges", "wix-exposure-audit");
const SERVER_ENTRY = join(ROOT, "local", "app", "server.mjs");

type ChallengeState = {
  FLAGS: Record<string, string>;
  SHARE_TOKEN: string;
  AGENCY_TOKEN: string;
  controls: {
    searchIndexing: boolean;
    inboxShareActive: boolean;
    agencyCollaboratorActive: boolean;
  };
  INBOX: Array<{ name: string; email: string; message: string }>;
};

type ServerModule = {
  createChallengeState: (seed: string) => ChallengeState;
  createChallengeServer: (state: ChallengeState) => Server;
  createVerifyServer: (state: ChallengeState) => Server;
};

async function listenEphemeral(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected an AddressInfo from an ephemeral listener");
  }
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function harness(seed: string) {
  const mod = (await import(SERVER_ENTRY)) as ServerModule;
  const state = mod.createChallengeState(seed);
  const challenge = mod.createChallengeServer(state);
  const verify = mod.createVerifyServer(state);
  const challengePort = await listenEphemeral(challenge);
  const verifyPort = await listenEphemeral(verify);
  const challengeBase = `http://127.0.0.1:${challengePort}`;
  const verifyBase = `http://127.0.0.1:${verifyPort}`;

  async function verifySubmit(checkpointId: string, submission: string) {
    const res = await fetch(`${verifyBase}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ checkpointId, submission }),
    });
    return (await res.json()) as { checkpointId: string; correct: boolean; message: string };
  }

  async function ownerAction(action: string) {
    const res = await fetch(`${challengeBase}/owner/settings/${action}`, { method: "POST" });
    expect(res.status).toBe(200);
    return res;
  }

  /**
   * Drives the real re-audit action a player would click on the owner
   * settings page. Never mutates state; either reveals nothing (plus which
   * settings remain open) or reveals the settings-remediation passphrase.
   */
  async function runReAudit(): Promise<{ flag: string | undefined; openLabels: string[] }> {
    const res = await ownerAction("re-audit");
    const html = await res.text();
    const flag = /再検証marker: <code>(TC\{[^}]+\})<\/code>/.exec(html)?.[1];
    const stillOpen = /まだ次の設定が開いたままです: ([^。]+)。/.exec(html)?.[1];
    return { flag, openLabels: stillOpen === undefined ? [] : stillOpen.split("、") };
  }

  async function scrapePreviewFlag(): Promise<string | undefined> {
    const res = await fetch(`${challengeBase}/preview/client-review`);
    if (res.status !== 200) return undefined;
    const html = await res.text();
    return /公開範囲監査marker: <code>(TC\{[^}]+\})<\/code>/.exec(html)?.[1];
  }

  async function scrapeInboxFlag(): Promise<string | undefined> {
    const homeHtml = await (await fetch(`${challengeBase}/`)).text();
    const shareToken = /\/admin\/inbox\?share=([\w-]+)/.exec(homeHtml)?.[1];
    if (shareToken === undefined) return undefined;
    const res = await fetch(`${challengeBase}/admin/inbox?share=${shareToken}`);
    if (res.status !== 200) return undefined;
    const html = await res.text();
    return /【監査】第三者に見えているなら共有範囲の設定ミスです: (TC\{[^}]+\})/.exec(html)?.[1];
  }

  async function scrapeAgencyFlag(): Promise<string | undefined> {
    const humansTxt = await (await fetch(`${challengeBase}/humans.txt`)).text();
    const token = /\/agency\/access\?token=([\w-]+)/.exec(humansTxt)?.[1];
    if (token === undefined) return undefined;
    const res = await fetch(`${challengeBase}/agency/access?token=${token}`);
    if (res.status !== 200) return undefined;
    const html = await res.text();
    return /権限棚卸しmarker: <code>(TC\{[^}]+\})<\/code>/.exec(html)?.[1];
  }

  async function close() {
    await closeServer(challenge);
    await closeServer(verify);
  }

  /**
   * Fetches from the challenge server with a caller-chosen Host header, so
   * tests can simulate the port this instance would actually be reassigned
   * to under local play (see the port-independence test below).
   */
  async function fetchChallenge(path: string, host: string): Promise<Response> {
    return fetch(`${challengeBase}${path}`, { headers: { host } });
  }

  return {
    state,
    verifySubmit,
    ownerAction,
    runReAudit,
    scrapePreviewFlag,
    scrapeInboxFlag,
    scrapeAgencyFlag,
    fetchChallenge,
    close,
  };
}

describe("wix-exposure-audit checkpoint gating", () => {
  it("should reveal nothing from the re-audit while any of the three settings is still open, and stay retryable", async () => {
    const h = await harness("test-seed-withhold");
    try {
      // Nothing has been touched yet: all three controls are still open.
      const allOpen = await h.runReAudit();
      expect(allOpen.flag).toBeUndefined();
      expect(allOpen.openLabels).toHaveLength(3);

      await h.ownerAction("disable-indexing");
      const oneClosed = await h.runReAudit();
      expect(oneClosed.flag).toBeUndefined();
      expect(oneClosed.openLabels).toHaveLength(2);

      await h.ownerAction("revoke-inbox-share");
      const twoClosed = await h.runReAudit();
      expect(twoClosed.flag).toBeUndefined();
      expect(twoClosed.openLabels).toHaveLength(1);

      // Running it repeatedly while still incomplete never mutates control
      // state (still exactly one control left open) and never leaks the
      // flag early.
      const twoClosedAgain = await h.runReAudit();
      expect(twoClosedAgain.flag).toBeUndefined();
      expect(twoClosedAgain.openLabels).toHaveLength(1);
      expect(h.state.controls.agencyCollaboratorActive).toBe(true);

      // The old fixed keyword from before this fix must now be rejected —
      // there is no "type a constant" path anymore.
      const oldLiteral = await h.verifySubmit("settings-remediation", "VERIFY");
      expect(oldLiteral.correct).toBe(false);
    } finally {
      await h.close();
    }
  });

  it("should reveal the settings-remediation passphrase only once all three settings are closed, and /verify accepts only that value", async () => {
    const h = await harness("test-seed-grant");
    try {
      await h.ownerAction("disable-indexing");
      await h.ownerAction("revoke-inbox-share");
      await h.ownerAction("remove-agency");

      const audited = await h.runReAudit();
      expect(audited.openLabels).toHaveLength(0);
      expect(audited.flag).toBe(h.state.FLAGS["settings-remediation"]);

      const oldLiteral = await h.verifySubmit("settings-remediation", "VERIFY");
      expect(oldLiteral.correct).toBe(false);

      const result = await h.verifySubmit("settings-remediation", audited.flag as string);
      expect(result).toEqual({
        checkpointId: "settings-remediation",
        correct: true,
        message: "Checkpoint cleared.",
      });
    } finally {
      await h.close();
    }
  });

  it("should recover from closing a setting before collecting its evidence, with no soft-lock", async () => {
    const h = await harness("test-seed-recover");
    try {
      // Play-test mistake: close every setting first, before harvesting any
      // of the three passphrases the checkpoints require.
      await h.ownerAction("disable-indexing");
      await h.ownerAction("revoke-inbox-share");
      await h.ownerAction("remove-agency");

      // Running the re-audit this early is harmless either way: the
      // settings genuinely are closed already, so it reveals the
      // settings-remediation passphrase — but the first three evidence
      // pages are now gone, exactly as intended...
      const prematureAudit = await h.runReAudit();
      expect(prematureAudit.flag).toBe(h.state.FLAGS["settings-remediation"]);
      expect(await h.scrapePreviewFlag()).toBeUndefined();
      expect(await h.scrapeInboxFlag()).toBeUndefined();
      expect(await h.scrapeAgencyFlag()).toBeUndefined();

      // ...and here is the fix under test: the player is not stuck. Each
      // setting can be reopened to regain access to its evidence.
      await h.ownerAction("enable-indexing");
      await h.ownerAction("restore-inbox-share");
      await h.ownerAction("restore-agency");

      const previewFlag = await h.scrapePreviewFlag();
      const inboxFlag = await h.scrapeInboxFlag();
      const agencyFlag = await h.scrapeAgencyFlag();
      expect(previewFlag).toBe(h.state.FLAGS["preview-indexing"]);
      expect(inboxFlag).toBe(h.state.FLAGS["shared-inbox"]);
      expect(agencyFlag).toBe(h.state.FLAGS["stale-collaborator"]);

      for (const [checkpointId, flag] of Object.entries({
        "preview-indexing": previewFlag,
        "shared-inbox": inboxFlag,
        "stale-collaborator": agencyFlag,
      })) {
        expect(flag).toBeDefined();
        const result = await h.verifySubmit(checkpointId, flag as string);
        expect(result.correct).toBe(true);
      }

      // Now close everything for real, re-audit again, and complete the run.
      await h.ownerAction("disable-indexing");
      await h.ownerAction("revoke-inbox-share");
      await h.ownerAction("remove-agency");
      const finalAudit = await h.runReAudit();
      expect(finalAudit.flag).toBe(h.state.FLAGS["settings-remediation"]);
      const finalVerify = await h.verifySubmit("settings-remediation", finalAudit.flag as string);
      expect(finalVerify.correct).toBe(true);
    } finally {
      await h.close();
    }
  });

  it("should never accept a wrong passphrase for any of the four checkpoints", async () => {
    const h = await harness("test-seed-wrong-answer");
    try {
      for (const checkpointId of [
        "preview-indexing",
        "shared-inbox",
        "stale-collaborator",
        "settings-remediation",
      ] as const) {
        const result = await h.verifySubmit(checkpointId, "TC{not_the_real_flag}");
        expect(result.correct).toBe(false);
      }
    } finally {
      await h.close();
    }
  });

  // Issue #399: local play reassigns the host port whenever 18080 is already
  // taken by another running problem. robots.txt / sitemap.xml must reflect
  // whatever port this instance actually answers on (from the request's own
  // Host header), not a hardcoded 18080 -- otherwise the sitemap link a
  // participant follows points at a different problem's container.
  it("should derive robots.txt/sitemap.xml URLs from the request Host, not a hardcoded port", async () => {
    const h = await harness("test-seed-port-independence");
    try {
      const reassignedHost = "127.0.0.1:54321";
      const robots = await (await h.fetchChallenge("/robots.txt", reassignedHost)).text();
      expect(robots).toContain(`Sitemap: http://${reassignedHost}/sitemap.xml`);
      expect(robots).not.toContain("18080");

      const sitemap = await (await h.fetchChallenge("/sitemap.xml", reassignedHost)).text();
      expect(sitemap).toContain(`<loc>http://${reassignedHost}/</loc>`);
      expect(sitemap).not.toContain("18080");
    } finally {
      await h.close();
    }
  });
});
