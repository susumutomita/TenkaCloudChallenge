import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
const root = fileURLToPath(new URL("../../../", import.meta.url));
async function port() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
test("long Defend still runs its HTTP drill, relationship policy, legitimate publishes, hold and reset", async (t) => {
  const dir = await mkdtemp(resolve(tmpdir(), "defend-regression-"));
  const appPort = await port(),
    verifyPort = await port();
  const child = spawn(
    process.execPath,
    [resolve(root, "runtimes/stackstack/app/server.mjs")],
    {
      cwd: dir,
      env: {
        TZ: "UTC",
        SCENARIO: "defend",
        FLAG_SEED: "regression-only",
        CHALLENGE_PORT: String(appPort),
        VERIFY_PORT: String(verifyPort),
        APP_CONFIG: resolve(
          root,
          "challenges/stackstack-defend/local/config/app.json",
        ),
        ACCESS_POLICY: resolve(
          root,
          "challenges/stackstack-defend/local/policy/access.json",
        ),
        APP_OVERRIDE_DIR: dir,
        DEFEND_INTERVAL_MS: "10",
        DEFEND_WINDOW_ROUNDS: "3",
        DEFEND_HOLD_MS: "100",
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${appPort}`;
  async function get(path) {
    return (await fetch(base + path)).json();
  }
  async function waitFor(predicate) {
    for (let i = 0; i < 200; i++) {
      try {
        const value = await predicate();
        if (value) return value;
      } catch {}
      if (child.exitCode !== null) throw Error(stderr);
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error("condition timed out: " + stderr);
  }
  await waitFor(() => get("/api/drill"));
  const token = createHash("sha256")
    .update("defend:actor:u-guest:regression-only")
    .digest("hex")
    .slice(0, 24);
  const listing = await (
    await fetch(base + "/api/drafts", {
      headers: { authorization: `Bearer ${token}` },
    })
  ).json();
  assert.ok(listing.drafts.length >= 4);
  const other = listing.drafts.find((d) => d.ownerId === "u-cto");
  assert.ok(other);
  async function read() {
    return fetch(base + `/api/draft?id=${other.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  }
  assert.equal((await read()).status, 200);
  const rule = (actor, resource, actions = ["read"]) => ({
    effect: "allow",
    actions,
    actor,
    resource,
  });
  const settings = {
    enabled: true,
    readsPerRound: 200,
    rules: [
      rule("*", { ownerIs: "actor" }),
      rule({ role: "moderator" }, "*"),
      rule({ role: "moderator" }, { ownerIsNot: "actor" }, ["publish"]),
    ],
  };
  async function patch(body) {
    assert.equal(
      (
        await fetch(base + "/api/settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      ).status,
      200,
    );
  }
  await patch(settings);
  assert.equal((await read()).status, 403);
  const good = await waitFor(async () => {
    const p = await get("/posture");
    return p.ready && p;
  });
  assert.equal(good.gates.service_intact, true);
  assert.equal(good.gates.held_under_load, true);
  await patch({ ...settings, rules: [] });
  await waitFor(async () => {
    const p = await get("/posture");
    return !p.gates.service_intact && !p.ready;
  });
  await fetch(base + "/api/settings", { method: "DELETE" });
  assert.equal((await read()).status, 200);
});
