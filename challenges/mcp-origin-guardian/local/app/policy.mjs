const LOOPBACK = new Set(["127.0.0.1:18110", "localhost:18110"]);

function parseCanonical(value) {
  if (typeof value !== "string") return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !url.hostname ||
    url.hostname === "localhost" ||
    /^127\./.test(url.hostname)
  ) {
    return null;
  }
  return url;
}

function parseDevelopment(value) {
  if (typeof value !== "string") return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !LOOPBACK.has(url.host.toLowerCase())
  ) {
    return null;
  }
  return url;
}

export function validatePolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return ["policy must be an object"];
  }
  const errors = [];
  if (!parseCanonical(policy.canonicalOrigin)) {
    errors.push("canonicalOrigin must be an authority-only HTTPS origin from trusted configuration");
  }
  if (!parseDevelopment(policy.developmentOrigin)) {
    errors.push("developmentOrigin must be an explicit loopback-only HTTP origin");
  }
  return errors;
}

export function evaluateRequest(policy, request) {
  if (validatePolicy(policy).length > 0) {
    return { accepted: false, reason: "invalid_policy" };
  }
  if (String(request.forwardedHost ?? "").trim()) {
    return { accepted: false, reason: "untrusted_forwarded_host" };
  }

  const configured =
    request.environment === "production"
      ? parseCanonical(policy.canonicalOrigin)
      : request.environment === "development"
        ? parseDevelopment(policy.developmentOrigin)
        : null;
  if (!configured) {
    return { accepted: false, reason: "invalid_environment" };
  }

  const host = String(request.host ?? "").toLowerCase();
  const origin = String(request.origin ?? "");
  if (host !== configured.host.toLowerCase() || origin !== configured.origin) {
    return { accepted: false, reason: "authority_mismatch" };
  }

  return {
    accepted: true,
    reason: "accepted",
    metadataResource: configured.origin,
    resourceMetadataUrl: `${configured.origin}/.well-known/oauth-protected-resource`,
  };
}

export function encodeSubmission(policy) {
  return Buffer.from(JSON.stringify(policy), "utf8").toString("base64url");
}

export function decodeSubmission(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 2048) return null;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== value.replace(/=+$/, "")) {
      return null;
    }
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
