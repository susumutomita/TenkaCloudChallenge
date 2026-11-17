// One disposable process per session. No inherited host environment or user code.
import http from "node:http";
import { randomBytes } from "node:crypto";
import {
  decide,
  validatePolicy,
} from "../../../runtimes/stackstack/app/access-policy.mjs";

const secret = randomBytes(32).toString("hex");
const actors = [
  { id: "a", role: "member" },
  { id: "b", role: "member" },
];
const makeRecord = (ownerId) => ({
  id: randomBytes(16).toString("hex"),
  ownerId,
  name: ownerId === "a" ? "架空 太郎" : "架空 花子",
  address: "架空県サンプル市1-2-3（実在しません）",
  contact: `${ownerId}@example.invalid`,
});
const records = actors.map((a) => makeRecord(a.id));
let scope = "all";
let policy = policyFor(scope);
let sawOwn = false,
  sawLeak = false,
  passed = false;
export function policyFor(scope, ids = []) {
  return {
    enabled: scope !== "off",
    readsPerRound: scope === "throttle" ? 1 : 200,
    rules:
      scope === "deny"
        ? []
        : (scope === "observed"
            ? ids.map((id) => ({ id }))
            : [scope === "owner" ? { ownerIs: "actor" } : "*"]
          ).map((resource) => ({
            effect: "allow",
            actions: ["read"],
            actor: "*",
            resource,
          })),
  };
}
const target = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (
    req.method !== "GET" ||
    url.pathname !== "/profile" ||
    req.headers.authorization !== `Bearer ${secret}`
  ) {
    res.writeHead(404).end();
    return;
  }
  const actor = actors.find((a) => a.id === req.headers["x-actor"]);
  const record = records.find((r) => r.id === url.searchParams.get("id"));
  let status = !actor
    ? 401
    : !record
      ? 404
      : !policy.enabled
        ? 503
        : policy.readsPerRound < 2
          ? 429
          : decide(policy, actor, "read", record)
            ? 200
            : 403;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(
    JSON.stringify(
      status === 200
        ? record
        : {
            error:
              status === 403
                ? "この利用者には閲覧権限がありません"
                : "閲覧できません",
          },
    ),
  );
});
await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${target.address().port}`;
async function read(actor, record) {
  const res = await fetch(`${base}/profile?id=${record.id}`, {
    headers: { authorization: `Bearer ${secret}`, "x-actor": actor.id },
    signal: AbortSignal.timeout(1200),
  });
  return { status: res.status, body: await res.json() };
}
process.on("message", async ({ id, op, body }) => {
  try {
    let result;
    if (op === "state")
      result = {
        sawOwn,
        sawLeak,
        passed,
        scope,
        ids: records.slice(0, 2).map((r) => r.id),
      };
    else if (op === "read") {
      const index = body.target === "self" ? 0 : 1;
      result = await read(actors[0], records[index]);
      result.request = `GET /profile?id=${records[index].id}`;
      if (result.status === 200) {
        if (index === 0) sawOwn = true;
        else sawLeak = true;
      }
    } else if (op === "policy") {
      if (
        !["all", "owner", "deny", "off", "throttle", "observed"].includes(
          body.scope,
        )
      )
        throw Error("invalid policy");
      const next = policyFor(
        body.scope,
        records.slice(0, 2).map((r) => r.id),
      );
      const checked = validatePolicy(next);
      if (checked.errors.length) throw Error("invalid policy");
      policy = checked.value;
      scope = body.scope;
      passed = false;
      result = { saved: true };
    } else if (op === "verify") {
      // Fresh unknown records, independent expected relationships, and exact bodies.
      // No hold-time claim: this is an immediate HTTP regression check, not load testing.
      const fresh = actors.map((a) => makeRecord(a.id));
      records.push(...fresh);
      try {
        const checks = [];
        for (const actor of actors)
          for (const record of [...records.slice(0, 2), ...fresh]) {
            const got = await read(actor, record);
            const own = actor.id === record.ownerId;
            checks.push({
              actor: actor.id,
              owner: record.ownerId,
              fresh: fresh.includes(record),
              status: got.status,
              ok: own
                ? got.status === 200 &&
                  JSON.stringify(got.body) === JSON.stringify(record)
                : got.status === 403,
            });
          }
        passed = sawOwn && sawLeak && checks.every((c) => c.ok);
        result = { passed, observed: sawOwn && sawLeak, checks };
      } finally {
        records.splice(2);
      }
    } else throw Error("invalid operation");
    process.send?.({ id, result });
  } catch {
    process.send?.({
      id,
      error: "検証できませんでした。もう一度試してください。",
    });
  }
});
process.send?.({ ready: true });
process.on("disconnect", () => process.exit(0));
