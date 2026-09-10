import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createModel } from "./model.mjs";
export function start({
  seed,
  webPort = 8080,
  verifyPort = 8081,
  host = "0.0.0.0",
}) {
  const model = createModel(seed);
  const assets = new Map(
    ["index.html", "app.js", "style.css"].map((name) => [
      name,
      readFileSync(new URL(`../public/${name}`, import.meta.url)),
    ]),
  );
  const json = (res, code, body) => {
    res.writeHead(code, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  async function body(req) {
    let data = "";
    for await (const chunk of req) {
      data += chunk;
      if (data.length > 8192) throw Error("body too large");
    }
    const value = JSON.parse(data);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("invalid body");
    return value;
  }
  const web = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (req.method === "GET" && path === "/healthz")
        return json(res, 200, { ok: true });
      if (req.method === "GET" && path === "/scenario")
        return json(res, 200, {
          ...model.scenario,
          completed: model.progress(),
        });
      if (req.method === "GET" && path === "/report")
        return json(res, 200, model.report());
      if (req.method === "POST" && path === "/submit") {
        const input = await body(req);
        const receipt = model.submit(input.stage, input.answer);
        return json(res, 200, {
          accepted: receipt !== null,
          ...(receipt ? { receipt } : {}),
          completed: model.progress(),
        });
      }
      const name = path === "/" ? "index.html" : path.slice(1);
      if (req.method === "GET" && assets.has(name)) {
        res.writeHead(200, {
          "Content-Type": name.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : name.endsWith(".css")
              ? "text/css; charset=utf-8"
              : "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'",
        });
        return res.end(assets.get(name));
      }
      json(res, 404, { error: "not found" });
    } catch {
      json(res, 400, { error: "Invalid request" });
    }
  });
  const verifier = createServer(async (req, res) => {
    try {
      if (req.method !== "POST" || req.url !== "/verify")
        return json(res, 404, { error: "not found" });
      const input = await body(req);
      return json(res, 200, {
        checkpointId:
          typeof input.checkpointId === "string" ? input.checkpointId : "",
        correct: model.verify(input.checkpointId, input.submission),
      });
    } catch {
      json(res, 400, { error: "Invalid request" });
    }
  });
  web.listen(webPort, host);
  verifier.listen(verifyPort, host);
  return { web, verifier };
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  start({
    seed: process.env.FLAG_SEED,
    webPort: Number(process.env.WEB_PORT || 8080),
    verifyPort: Number(process.env.VERIFY_PORT || 8081),
  });
