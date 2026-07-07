#!/usr/bin/env node
// Safety harness for Operation "Hollow Invite" (the `make harness` equivalent).
//
// Enforces the isolation invariants for this GameDay so it can never point at a
// real target or ship a real payload:
//   1. Reserved names only — every absolute URL host must be *.example,
//      *.tenka.local, or loopback (127.0.0.1 / localhost). Documentation and
//      private IP ranges (RFC 5737 / RFC 1918) are allowed in evidence logs.
//   2. No real payload — no EICAR test string, no executable / installer file
//      extensions served anywhere.
//   3. No external egress in code — the container's own fetch() calls must be
//      same-origin (relative) only.
//
// Run: `node local/safety-check.mjs` (from the problem dir or the repo root).
// Exit 0 = clean, exit 1 = a safety invariant is violated.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, relative } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
// Scan the isolated-tenant payload only (the container + evidence under local/).
// The root docs (README / FACILITATOR / metadata) are operator-facing, not shipped
// into the tenant, so they are out of scope for the egress/payload invariants.
const ROOT = HERE; // challenges/hollow-invite/local

const SKIP_DIRS = new Set(["node_modules", ".git"]);
const TEXT_EXT = new Set([
  ".mjs", ".js", ".json", ".jsonl", ".eml", ".html", ".txt", ".md", ".yml", ".yaml", "",
]);

const RESERVED_HOST = /(?:\.example|\.tenka\.local|^localhost$|^127\.0\.0\.1$)/i;
// RFC 5737 documentation ranges + RFC 1918 private ranges — allowed in logs.
const DOC_OR_PRIVATE_IP =
  /^(?:192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
const ABS_URL = /\bhttps?:\/\/([a-z0-9.-]+)(?::\d+)?/gi;
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR";
const BINARY_EXT = /\.(?:exe|msi|dmg|pkg|dll|scr|bat|ps1|apk|deb|rpm|jar|com|bin)\b/i;
const OWN_FETCH_ABS = /fetch\(\s*["'`]https?:\/\//i;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const violations = [];
const add = (file, msg) => violations.push(`${relative(ROOT, file)}: ${msg}`);

for (const file of walk(ROOT)) {
  if (file === fileURLToPath(import.meta.url)) continue; // don't scan this checker
  if (!TEXT_EXT.has(extname(file))) continue;
  const text = readFileSync(file, "utf8");

  // (1) Reserved hosts only.
  for (const m of text.matchAll(ABS_URL)) {
    const host = m[1].toLowerCase().replace(/\.$/, "");
    const ok = RESERVED_HOST.test(host) || DOC_OR_PRIVATE_IP.test(host);
    if (!ok) add(file, `non-reserved URL host "${host}" (only *.example / *.tenka.local / loopback allowed)`);
  }

  // (2) No real payload.
  if (text.includes(EICAR)) add(file, "contains the EICAR test signature");
  const binMatch = text.match(BINARY_EXT);
  if (binMatch) add(file, `references an executable/installer extension "${binMatch[0]}"`);

  // (3) No external egress from the container's own code.
  if (extname(file) === ".mjs" || extname(file) === ".js") {
    if (OWN_FETCH_ABS.test(text)) add(file, "code performs fetch() to an absolute URL (must be same-origin/relative)");
  }
}

if (violations.length > 0) {
  console.error("SAFETY CHECK FAILED — the following invariants are violated:");
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log("SAFETY CHECK OK: reserved TLDs only, no external egress, no real payload.");
