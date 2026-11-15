import { createHash } from "node:crypto";

/**
 * php-attachment-viewer-lab -- the five multi-verify checkpoints.
 *
 * The verifier runs in its own container (never the participant's) and holds
 * the same FLAG_SEED as the surface, so it can derive the stage-1 flag and the
 * console token without any file being shared. Every stage-2 checkpoint is
 * decided by probing the live surface over HTTP -- never by reading a setting
 * the participant typed.
 */

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function deriveSecrets(seed) {
  return {
    flagRead: `TC{escape_${sha256(`flag:read-outside:${seed}`).slice(0, 20)}}`,
    consoleToken: sha256(`console-token:${seed}`).slice(0, 32),
    auditToken: (version) =>
      version === 0
        ? `TC{escape_${sha256(`flag:read-outside:${seed}`).slice(0, 20)}}`
        : sha256(`audit-token:v${version}:${seed}`).slice(0, 32),
  };
}

/**
 * Spellings of "climb out of the shelf" the fix must refuse. The second one
 * is what defeats a patch that deletes `../` once; the rest make sure the
 * sound fix did not merely special-case the first.
 */
export const CLIMB_VARIANTS = [
  "../private/config.ini",
  "....//private/config.ini",
  "./../private/config.ini",
  "../../app/private/config.ini",
  "..\\/private/config.ini",
];

export function normalizeFlagSubmission(submission) {
  let value = String(submission ?? "").trim();
  const prefixed = value.match(/^(?:key|flag|token)\s*=\s*(.+)$/i);
  if (prefixed) value = prefixed[1].trim();
  return value;
}

export function createChecks({ surfaceUrl, seed }) {
  const secrets = deriveSecrets(seed);

  async function probe(path, opts = {}) {
    const res = await fetch(`${surfaceUrl}${path}`, {
      method: opts.method ?? "GET",
      headers: { ...(opts.headers ?? {}), ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, text, json };
  }

  const consoleHeaders = { authorization: `Bearer ${secrets.consoleToken}` };

  async function viewer(name) {
    return probe(`/attachment?file=${encodeURIComponent(name)}`);
  }

  /** The private file is recognisable by its own header, never by the token value. */
  const leaksPrivateFile = (r) => r.status === 200 && /audit_token\s*=/.test(r.text);

  async function readOutside(submission) {
    return normalizeFlagSubmission(submission) === secrets.flagRead;
  }

  async function fixViewer() {
    for (const name of CLIMB_VARIANTS) {
      const r = await viewer(name);
      if (leaksPrivateFile(r)) return false;
      if (r.status === 200) return false; // nothing outside the shelf may come back 200
    }
    const manual = await viewer("manual.txt");
    return manual.status === 200 && manual.text.includes("Document shelf");
  }

  async function cleanupLeftover() {
    const audit = await probe("/admin/audit", { headers: consoleHeaders });
    if (audit.status !== 200 || audit.json?.leftoverAccountPresent !== false) return false;
    const version = Number(audit.json?.auditTokenVersion ?? 0);
    const internal = await probe(`/internal/audit?token=${encodeURIComponent(secrets.auditToken(version))}`);
    if (internal.status !== 200 || !Array.isArray(internal.json?.accounts)) return false;
    return !internal.json.accounts.some((a) => a?.username === "svc-backup");
  }

  async function rotateToken() {
    const audit = await probe("/admin/audit", { headers: consoleHeaders });
    if (audit.status !== 200) return false;
    const version = Number(audit.json?.auditTokenVersion ?? 0);
    if (!(version >= 1)) return false;
    const old = await probe(`/internal/audit?token=${encodeURIComponent(secrets.auditToken(0))}`);
    if (old.status !== 401) return false; // the leaked token must be dead
    const current = await probe(`/internal/audit?token=${encodeURIComponent(secrets.auditToken(version))}`);
    return current.status === 200;
  }

  async function siteHealthy() {
    const home = await probe("/");
    const manual = await viewer("manual.txt");
    const documents = await probe("/documents");
    const console_ = await probe("/admin");
    return (
      home.status === 200 &&
      home.text.includes("Example Co Portal") &&
      manual.status === 200 &&
      manual.text.includes("Document shelf") &&
      documents.status === 200 &&
      Array.isArray(documents.json?.documents) &&
      documents.json.documents.includes("manual.txt") &&
      console_.status === 200
    );
  }

  return {
    "read-outside": readOutside,
    "fix-viewer": fixViewer,
    "cleanup-leftover": cleanupLeftover,
    "rotate-token": rotateToken,
    "site-healthy": siteHealthy,
  };
}
