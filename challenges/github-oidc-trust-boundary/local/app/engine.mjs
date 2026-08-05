export const ISSUER = "https://token.actions.githubusercontent.com";
export const PROVIDER_ARN = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com";
export const ACTION = "sts:AssumeRoleWithWebIdentity";
export const AUDIENCE_KEY = "token.actions.githubusercontent.com:aud";
export const SUBJECT_KEY = "token.actions.githubusercontent.com:sub";
export const TARGET_AUDIENCE = "sts.amazonaws.com";
export const TARGET_SUBJECT = "repo:tenkacloud/production-app:environment:Production";

export const OBSERVATIONS = Object.freeze([
  "wrong_audience_allowed",
  "other_repository_allowed",
  "pull_request_allowed",
  "environment_bypassed",
]);

export const STARTER_POLICY = Object.freeze({
  diagnosis: [],
  trustPolicy: {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Federated: PROVIDER_ARN },
        Action: ACTION,
        Condition: {
          StringLike: {
            [SUBJECT_KEY]: "repo:tenkacloud/*",
          },
        },
      },
    ],
  },
});

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function validConditionMap(value) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.length <= 2 &&
    new Set(keys).size === keys.length &&
    keys.every(
      (key) =>
        [AUDIENCE_KEY, SUBJECT_KEY].includes(key) &&
        typeof value[key] === "string" &&
        value[key].length > 0 &&
        value[key].length <= 256,
    )
  );
}

export function validatePolicy(submission) {
  if (!exactKeys(submission, ["diagnosis", "trustPolicy"])) {
    return ["submission must contain exactly diagnosis and trustPolicy"];
  }
  const errors = [];
  if (
    !Array.isArray(submission.diagnosis) ||
    submission.diagnosis.length > OBSERVATIONS.length ||
    new Set(submission.diagnosis).size !== submission.diagnosis.length ||
    !submission.diagnosis.every((item) => OBSERVATIONS.includes(item))
  ) {
    errors.push("diagnosis must be a unique list of the documented observations");
  }

  const policy = submission.trustPolicy;
  if (!exactKeys(policy, ["Version", "Statement"]) || policy.Version !== "2012-10-17") {
    errors.push("trustPolicy must use the documented Version and Statement shape");
    return errors;
  }
  if (!Array.isArray(policy.Statement) || policy.Statement.length !== 1) {
    errors.push("trustPolicy must contain exactly one statement");
    return errors;
  }
  const statement = policy.Statement[0];
  if (!exactKeys(statement, ["Effect", "Principal", "Action", "Condition"])) {
    errors.push("the statement must contain exactly Effect, Principal, Action, and Condition");
    return errors;
  }
  if (statement.Effect !== "Allow") errors.push("Effect must be Allow");
  if (!exactKeys(statement.Principal, ["Federated"]) || typeof statement.Principal.Federated !== "string") {
    errors.push("Principal must contain one federated provider ARN");
  }
  if (typeof statement.Action !== "string") errors.push("Action must be one string");
  if (!isRecord(statement.Condition)) {
    errors.push("Condition must be an object");
    return errors;
  }
  const operators = Object.keys(statement.Condition);
  if (
    operators.length === 0 ||
    operators.length > 2 ||
    !operators.every((operator) => ["StringEquals", "StringLike"].includes(operator))
  ) {
    errors.push("Condition may use only StringEquals and StringLike");
    return errors;
  }
  if (!operators.every((operator) => validConditionMap(statement.Condition[operator]))) {
    errors.push("condition maps may contain only bounded aud and sub string values");
  }
  const conditionKeys = operators.flatMap((operator) => Object.keys(statement.Condition[operator]));
  if (new Set(conditionKeys).size !== conditionKeys.length) {
    errors.push("a condition key may appear under only one operator");
  }
  return errors;
}

function globMatches(pattern, value) {
  let source = "^";
  for (const character of pattern) {
    if (character === "*") source += ".*";
    else if (character === "?") source += ".";
    else source += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(`${source}$`, "u").test(value);
}

function claimForKey(claims, key) {
  if (key === AUDIENCE_KEY) return claims.aud;
  if (key === SUBJECT_KEY) return claims.sub;
  return undefined;
}

export function evaluateTrustPolicy(submission, request) {
  const errors = validatePolicy(submission);
  if (errors.length > 0 || !isRecord(request) || !isRecord(request.claims)) {
    return { allowed: false, reasons: errors.length ? errors : ["invalid request context"] };
  }
  const statement = submission.trustPolicy.Statement[0];
  const reasons = [];
  if (request.providerArn !== statement.Principal.Federated) reasons.push("provider-mismatch");
  if (request.action !== statement.Action) reasons.push("action-mismatch");
  if (request.claims.iss !== ISSUER) reasons.push("issuer-mismatch");

  for (const [operator, conditions] of Object.entries(statement.Condition)) {
    for (const [key, expected] of Object.entries(conditions)) {
      const actual = claimForKey(request.claims, key);
      if (typeof actual !== "string") {
        reasons.push(key === AUDIENCE_KEY ? "audience-missing-or-not-single" : "subject-missing-or-not-string");
        continue;
      }
      const matched = operator === "StringEquals" ? actual === expected : globMatches(expected, actual);
      if (!matched) reasons.push(key === AUDIENCE_KEY ? "audience-mismatch" : "subject-mismatch");
    }
  }
  return { allowed: reasons.length === 0, reasons };
}

export function requestContext(options) {
  const {
    id,
    iss = ISSUER,
    providerArn = PROVIDER_ARN,
    action = ACTION,
    extraClaims = {},
  } = options;
  const aud = Object.hasOwn(options, "aud") ? options.aud : TARGET_AUDIENCE;
  const sub = Object.hasOwn(options, "sub") ? options.sub : TARGET_SUBJECT;
  const claims = { iss, aud, sub, ...extraClaims };
  for (const [key, value] of Object.entries(claims)) {
    if (value === undefined) delete claims[key];
  }
  return { id, providerArn, action, claims };
}

export const OBSERVATION_MATRIX = Object.freeze([
  {
    observation: "wrong_audience_allowed",
    request: requestContext({ id: "wrong-audience", aud: "https://example.invalid" }),
  },
  {
    observation: "other_repository_allowed",
    request: requestContext({
      id: "other-repository",
      sub: "repo:tenkacloud/preview-app:environment:Production",
    }),
  },
  {
    observation: "pull_request_allowed",
    request: requestContext({ id: "pull-request", sub: "repo:tenkacloud/production-app:pull_request" }),
  },
  {
    observation: "environment_bypassed",
    request: requestContext({
      id: "branch-without-environment",
      sub: "repo:tenkacloud/production-app:ref:refs/heads/main",
    }),
  },
]);

export function inspectStarter() {
  return {
    target: { issuer: ISSUER, audience: TARGET_AUDIENCE, subject: TARGET_SUBJECT },
    cases: OBSERVATION_MATRIX.map(({ observation, request }) => ({
      id: request.id,
      expected: "deny",
      actual: evaluateTrustPolicy(STARTER_POLICY, request).allowed ? "allow" : "deny",
      observation,
      claims: request.claims,
    })),
  };
}

export function encodeSubmission(policy) {
  const errors = validatePolicy(policy);
  if (errors.length > 0) throw new Error(errors[0]);
  return Buffer.from(JSON.stringify({ version: 1, policy }), "utf8").toString("base64url");
}

export function decodeSubmission(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 16 * 1024 || /TC\{|FLAG\{/i.test(value)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!exactKeys(decoded, ["version", "policy"]) || decoded.version !== 1) return null;
    return validatePolicy(decoded.policy).length === 0 ? decoded.policy : null;
  } catch {
    return null;
  }
}
