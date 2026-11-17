import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("app.js", import.meta.url), "utf8");
const flush = () => new Promise((r) => setImmediate(r));
async function ui() {
  const nodes = new Map();
  const calls = [];
  let nextVerify = null;
  let expiry = Date.now() + 60_000;
  let tick;
  const node = (id) => {
    if (!nodes.has(id))
      nodes.set(id, {
        hidden: false,
        disabled: false,
        textContent: "",
        value: "all",
        children: [],
        replaceChildren() {
          this.children = [];
        },
        append(child) {
          this.children.push(child);
        },
      });
    return nodes.get(id);
  };
  node("learning").hidden = true;
  const context = vm.createContext({
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    document: { getElementById: node, createElement: () => ({}) },
    setInterval: (fn) => {
      tick = fn;
    },
    fetch: async (path, options = {}) => {
      calls.push(path);
      let status = 200,
        body = { expires: expiry };
      if (path === "/api/state")
        body = { ...body, scope: "all", sawOwn: true, sawLeak: true };
      if (path === "/api/verify") {
        if (nextVerify) {
          const handler = nextVerify;
          nextVerify = null;
          return handler(options.signal);
        }
        body = {
          ...body,
          passed: true,
          observed: true,
          checks: [{ ok: true, actor: "a", owner: "a", status: 200 }],
        };
      }
      return { ok: status === 200, status, json: async () => body };
    },
  });
  vm.runInContext(source, context);
  await flush();
  return {
    node,
    calls,
    tick: () => tick(),
    expiry: (value) => {
      expiry = value;
    },
    verify: (handler) => {
      nextVerify = handler;
    },
  };
}
test("UI discards previous success on verifier errors and allows retry", async () => {
  const f = await ui();
  await f.node("verify").onclick();
  assert.equal(f.node("learning").hidden, false);
  f.verify(async () => ({
    ok: false,
    status: 502,
    json: async () => ({ error: "検証未確認。再試行してください。" }),
  }));
  await f.node("verify").onclick();
  assert.equal(f.node("learning").hidden, true);
  assert.equal(f.node("checks").children.length, 0);
  assert.match(f.node("message").textContent, /未確認/);
  await f.node("verify").onclick();
  assert.equal(f.node("learning").hidden, false);
});
test("UI serializes repeated clicks and aborts pending verification on stop", async () => {
  const f = await ui();
  f.verify(
    (signal) =>
      new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(Error("aborted")), {
          once: true,
        }),
      ),
  );
  const first = f.node("verify").onclick();
  await f.node("verify").onclick();
  assert.equal(f.calls.filter((p) => p === "/api/verify").length, 1);
  await f.node("stop").onclick();
  await first;
  assert.equal(f.node("exercise").hidden, true);
  assert.equal(f.node("start").hidden, false);
  assert.equal(f.node("learning").hidden, true);
  assert.equal(f.node("clock").textContent, "");
  assert.match(f.node("message").textContent, /終了しました/);
  await f.node("start").onclick();
  assert.equal(f.node("exercise").hidden, false);
});
test("UI expiry returns to start and does not claim completion", async () => {
  const f = await ui();
  f.expiry(Date.now() - 100);
  await f.node("start").onclick();
  f.tick();
  assert.equal(f.node("start").hidden, false);
  assert.equal(f.node("exercise").hidden, true);
  assert.match(f.node("message").textContent, /期限切れ/);
});
