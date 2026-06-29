/**
 * rls-tenant-isolation — local-play container entrypoint.
 *
 * Two HTTP servers run in one process (mirroring sqli-demo's contract):
 *   :8080  the document-management API the participant inspects/attacks
 *   :8081  the loopback `/verify` the TenkaCloud scorer delegates to
 *
 * The :8080 API is the VULNERABLE starter: it carries identity correctly but
 * relies on app-side `organization_id` filtering, and its by-id read/write paths
 * forget to filter — so swapping a `document_id` leaks another company's data
 * UNTIL Row Level Security is added in the database. The API runs as the
 * non-superuser `app_api` role so that, once the participant enables RLS, the
 * boundary is enforced underneath the app no matter which code path is hit.
 *
 * `/verify` runs the 7 attack assertions (grade.mjs) against live Postgres
 * through pg-client.mjs and returns `{ correct }`. The platform records the
 * verdict and never sees the policies. There is no per-deploy flag here: the
 * challenge is structural (is the boundary enforced?), so FLAG_SEED is unused.
 */
import { createServer } from "node:http";
import postgres from "postgres";
import { runGrader } from "../grader/grade.mjs";
import { createPgGraderClient } from "./pg-client.mjs";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/rls_demo";

// Admin connection (table owner) — used by the API and by the grader, which then
// `set role app_api` inside each transaction so RLS binds.
const sql = postgres(DATABASE_URL, { max: 4, onnotice: () => {} });

// Seed identifiers (must match db/seed.sql).
const ORG_A = "00000000-0000-0000-0000-0000000000a1";
const ORG_B = "00000000-0000-0000-0000-0000000000b1";

// The seed actors the grader attacks across the tenant boundary.
const ACTORS = {
  aMember: { userId: "amir-member", organizationId: ORG_A, role: "member" },
  aOwner: { userId: "alice-owner", organizationId: ORG_A, role: "owner" },
  bMember: { userId: "ben-member", organizationId: ORG_B, role: "member" },
  bOwner: { userId: "bella-owner", organizationId: ORG_B, role: "owner" },
};
const DOCS = {
  aDoc: { id: "00000000-0000-0000-0000-00000000ad01", organization_id: ORG_A },
  bDoc: { id: "00000000-0000-0000-0000-00000000bd01", organization_id: ORG_B },
};

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 64 * 1024) {
        request.destroy();
        resolve("");
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", () => resolve(""));
  });
}

/**
 * Resolve the caller's identity from a demo header. In a real Supabase app this
 * is the verified JWT; here `x-user-id` stands in for the signed-in user so the
 * participant can reproduce the attack with curl. The API binds it to the same
 * GUCs the policies read, then runs as `app_api`.
 */
async function withRequestIdentity(userId, fn) {
  const role = userId ? "authenticated" : "anon";
  let captured;
  await sql.begin(async (tx) => {
    await tx.unsafe("set local role app_api");
    await tx`select set_config('request.jwt.role', ${role}, true)`;
    await tx`select set_config('app.user_id', ${userId ?? ""}, true)`;
    captured = await fn(tx);
  });
  return captured;
}

const api = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const userId = String(request.headers["x-user-id"] ?? "");
    const idMatch = url.pathname.match(/^\/documents\/([0-9a-fA-F-]+)$/);

    if (request.method === "GET" && url.pathname === "/healthz") {
      return send(response, 200, { status: "ok" });
    }

    // List — the starter DOES filter here in app code (looks safe in isolation).
    if (request.method === "GET" && url.pathname === "/documents") {
      const rows = await withRequestIdentity(userId, async (tx) => {
        // VULNERABLE shape: app-side filter only. With RLS off it is the sole
        // gate; with RLS on the database enforces it regardless.
        return tx`select id, organization_id, title from public.documents
                  order by created_at`;
      });
      return send(response, 200, { documents: [...rows] });
    }

    // Get by id — the starter FORGETS the org filter here: swap the id and read
    // another company's document. (RLS closes this.)
    if (request.method === "GET" && idMatch) {
      const rows = await withRequestIdentity(userId, async (tx) => {
        return tx`select id, organization_id, title, body, created_by
                  from public.documents where id = ${idMatch[1]}`;
      });
      if (rows.length === 0) return send(response, 404, { error: "not_found" });
      return send(response, 200, { document: rows[0] });
    }

    // Patch by id — also unfiltered in the starter.
    if (request.method === "PATCH" && idMatch) {
      const body = JSON.parse((await readBody(request)) || "{}");
      const rows = await withRequestIdentity(userId, async (tx) => {
        return tx`update public.documents
                  set title = coalesce(${body.title ?? null}, title),
                      body  = coalesce(${body.body ?? null}, body)
                  where id = ${idMatch[1]} returning id`;
      });
      if (rows.length === 0) return send(response, 404, { error: "not_found" });
      return send(response, 200, { updated: rows[0].id });
    }

    return send(response, 404, { error: "not_found" });
  } catch {
    // RLS denials and bad input both land here; never leak internals.
    return send(response, 403, { error: "forbidden" });
  }
});

const verify = createServer(async (request, response) => {
  if (request.method !== "POST" || (request.url ?? "/") !== "/verify") {
    return send(response, 404, { error: "not_found" });
  }
  await readBody(request); // submission body is ignored: the grader IS the answer
  try {
    const client = createPgGraderClient(sql);
    const verdict = await runGrader(client, { actors: ACTORS, docs: DOCS });
    return send(response, 200, {
      correct: verdict.correct,
      message: verdict.correct
        ? `All ${verdict.total} tenant-isolation checks passed.`
        : `${verdict.passedCount}/${verdict.total} checks passed. Cross-tenant access is still possible.`,
      results: verdict.results.map((r) => ({ id: r.id, passed: r.passed, detail: r.detail })),
    });
  } catch {
    return send(response, 200, {
      correct: false,
      message: "Grader could not evaluate the database (is it running?).",
    });
  }
});

api.listen(8080, "0.0.0.0", () => console.log("documents API on :8080"));
verify.listen(8081, "0.0.0.0", () => console.log("verify on :8081"));
