import http from "node:http";
import { fork } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = new URL("./", import.meta.url);
const bounded = (value, fallback, max) => {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < 1 || n > max) throw Error("invalid limit");
  return n;
};
export function createIntro(options = {}) {
  const max = bounded(options.max, 4, 8),
    ttl = bounded(options.ttl, 300_000, 600_000);
  const origin = options.origin ?? "http://127.0.0.1:18090";
  const publicURL = new URL(origin);
  if (
    !["http:", "https:"].includes(publicURL.protocol) ||
    publicURL.origin !== origin
  )
    throw Error("PUBLIC_ORIGIN must be an exact http(s) origin");
  const secure = publicURL.protocol === "https:";
  const sessions = new Map(),
    workers = new Set();
  let active = 0,
    accepting = true,
    budget = 300,
    starts = 20;
  const rateTimer = setInterval(() => {
    budget = 300;
    starts = 20;
  }, 60_000);
  rateTimer.unref();
  const cookie = (token = "") =>
    `intro=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? Math.ceil(ttl / 1000) : 0}${secure ? "; Secure" : ""}`;
  const send = (res, status, data, headers = {}) => {
    if (!res.writableEnded) {
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        ...headers,
      });
      res.end(JSON.stringify(data));
    }
  };
  function retire(session) {
    sessions.delete(session.token);
    clearTimeout(session.timer);
    session.child.kill("SIGKILL");
    // Keep the capacity reservation until OS process exit is observed.
  }
  async function spawn() {
    const token = randomBytes(32).toString("base64url");
    const child = fork(fileURLToPath(new URL("worker.mjs", here)), [], {
      env: { TZ: "UTC" },
      execArgv: ["--max-old-space-size=64"],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      cwd: fileURLToPath(here),
    });
    const session = {
      token,
      child,
      expires: Date.now() + ttl,
      busy: false,
      pending: new Map(),
      sequence: 0,
    };
    workers.add(session);
    sessions.set(token, session);
    child.on("message", (msg) => {
      const p = session.pending.get(msg.id);
      if (p) {
        session.pending.delete(msg.id);
        clearTimeout(p.timer);
        msg.error ? p.reject(Error(msg.error)) : p.resolve(msg.result);
      }
    });
    child.on("exit", () => {
      workers.delete(session);
      sessions.delete(token);
      clearTimeout(session.timer);
      for (const p of session.pending.values()) {
        clearTimeout(p.timer);
        p.reject(Error("worker stopped"));
      }
      session.pending.clear();
    });
    child.on("error", () => {
      retire(session);
      // spawn failure has no OS process and emits no exit event.
      if (!child.pid) workers.delete(session);
    });
    session.timer = setTimeout(() => retire(session), ttl);
    session.timer.unref();
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(Error("startup timeout"));
        }, 3000);
        const ready = (msg) => {
          if (msg.ready) {
            cleanup();
            resolve();
          }
        };
        const exit = () => {
          cleanup();
          reject(Error("startup failed"));
        };
        function cleanup() {
          clearTimeout(timer);
          child.off("message", ready);
          child.off("exit", exit);
        }
        child.on("message", ready);
        child.once("exit", exit);
      });
    } catch (error) {
      retire(session);
      throw error;
    }
    return session;
  }
  function rpc(session, op, body = {}) {
    return new Promise((resolve, reject) => {
      const id = ++session.sequence;
      const timer = setTimeout(() => {
        session.pending.delete(id);
        retire(session);
        reject(Error("timeout"));
      }, 4000);
      session.pending.set(id, { resolve, reject, timer });
      session.child.send({ id, op, body }, (error) => {
        if (error) {
          clearTimeout(timer);
          session.pending.delete(id);
          retire(session);
          reject(error);
        }
      });
    });
  }
  async function json(req) {
    if (req.headers["content-type"] !== "application/json")
      throw Error("content type");
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1024) throw Error("body too large");
      chunks.push(chunk);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("object required");
    return value;
  }
  const server = http.createServer(
    { maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 },
    async (req, res) => {
      res.setHeader("cache-control", "no-store");
      res.setHeader("referrer-policy", "no-referrer");
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader(
        "content-security-policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
      if (++active > 32) {
        active--;
        send(res, 503, {
          error: "混雑しています。少し待って再試行してください。",
        });
        return;
      }
      res.once("close", () => active--);
      req.setTimeout(5000, () => req.destroy());
      res.setTimeout(6000, () => res.destroy());
      try {
        if (req.headers.host !== publicURL.host)
          return send(res, 400, { error: "接続先が違います。" });
        if (
          --budget < 0 &&
          !(req.method === "DELETE" && req.url === "/api/session")
        )
          return send(
            res,
            429,
            { error: "操作が多すぎます。1分待って再試行してください。" },
            { "retry-after": "60" },
          );
        const path = req.url;
        if (
          req.method === "GET" &&
          ["/", "/app.js", "/style.css"].includes(path)
        ) {
          const name = path === "/" ? "index.html" : path.slice(1);
          res.writeHead(200, {
            "content-type":
              path === "/"
                ? "text/html; charset=utf-8"
                : path.endsWith(".js")
                  ? "text/javascript; charset=utf-8"
                  : "text/css; charset=utf-8",
          });
          res.end(await readFile(new URL(name, here)));
          return;
        }
        if (req.method === "GET" && path === "/healthz")
          return send(res, accepting ? 200 : 503, { ok: accepting });
        const allowed = {
          "POST /api/start": "start",
          "GET /api/state": "state",
          "POST /api/read": "read",
          "POST /api/policy": "policy",
          "POST /api/verify": "verify",
          "DELETE /api/session": "stop",
        };
        const op = allowed[`${req.method} ${path}`];
        if (!op) return send(res, 404, { error: "この操作はありません。" });
        // A custom header and exact Origin protect all mutations; no CORS support.
        if (
          req.method !== "GET" &&
          (req.headers.origin !== origin || req.headers["x-intro"] !== "1")
        )
          return send(res, 403, { error: "同じ画面から操作してください。" });
        const token = (req.headers.cookie ?? "").match(
          /(?:^|;\s*)intro=([A-Za-z0-9_-]{43})(?:;|$)/,
        )?.[1];
        let session = sessions.get(token);
        if (session && session.expires <= Date.now()) {
          retire(session);
          session = undefined;
        }
        if (op === "start") {
          if (session) return send(res, 200, { expires: session.expires });
          if (!accepting || workers.size >= max)
            return send(
              res,
              503,
              {
                error:
                  "ただいま満員です。枠が空いてから「開始」を押してください。",
              },
              { "retry-after": "10" },
            );
          if (--starts < 0)
            return send(res, 429, {
              error: "開始回数の上限です。1分待って再試行してください。",
            });
          session = await spawn();
          return send(
            res,
            201,
            { expires: session.expires },
            { "set-cookie": cookie(session.token) },
          );
        }
        if (!session)
          return send(res, 401, {
            error:
              "体験が終了したか期限切れです。「開始」で新しく始められます。",
          });
        if (op === "stop") {
          retire(session);
          return send(res, 200, { stopped: true }, { "set-cookie": cookie() });
        }
        if (session.busy)
          return send(res, 429, {
            error: "前の操作を確認中です。少し待って再試行してください。",
          });
        session.busy = true;
        try {
          const body = ["read", "policy"].includes(op) ? await json(req) : {};
          if (
            op === "read" &&
            (Object.keys(body).join() !== "target" ||
              !["self", "other"].includes(body.target))
          )
            return send(res, 400, { error: "対象を選んでください。" });
          if (
            op === "policy" &&
            (Object.keys(body).join() !== "scope" ||
              !["all", "owner", "deny", "off", "throttle", "observed"].includes(
                body.scope,
              ))
          )
            return send(res, 400, { error: "ルールを選んでください。" });
          const result = await rpc(session, op, body);
          if (sessions.get(token) !== session)
            return send(res, 401, {
              error: "体験は終了しました。開始し直してください。",
            });
          send(res, 200, { ...result, expires: session.expires });
        } finally {
          session.busy = false;
        }
      } catch (error) {
        send(
          res,
          error instanceof SyntaxError ||
            ["body too large", "content type", "object required"].includes(
              error.message,
            )
            ? 400
            : 502,
          {
            error:
              "操作を完了できませんでした。結果は未確認です。再試行し、続く場合は終了して開始し直してください。",
          },
        );
      }
    },
  );
  server.maxConnections = 48;
  server.keepAliveTimeout = 2000;
  server.maxRequestsPerSocket = 100;
  return {
    server,
    stats: () => ({ workers: workers.size, sessions: sessions.size }),
    async close() {
      accepting = false;
      clearInterval(rateTimer);
      const exits = [...workers].map((session) => once(session.child, "exit"));
      for (const session of workers) retire(session);
      await Promise.all([
        ...exits,
        new Promise((resolve) => server.close(resolve)),
      ]);
    },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = bounded(process.env.PORT, 18090, 65535);
  const app = createIntro({
    origin: process.env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`,
    max: process.env.MAX_SESSIONS,
    ttl: process.env.SESSION_TTL_MS,
  });
  app.server.listen(port, "127.0.0.1", () =>
    console.log(`Incident intro: http://127.0.0.1:${port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => app.close().then(() => process.exit(0)));
}
