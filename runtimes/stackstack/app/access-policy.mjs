/** Pure data-only policy evaluator shared by Defend and its short introduction. */
const ACTIONS = ["read", "publish"];
const EFFECTS = ["allow", "deny"];

function badRule(index, detail) {
  return `rules[${index}]: ${detail}`;
}

function checkActorMatcher(index, matcher) {
  if (matcher === "*") return null;
  if (
    matcher === null ||
    typeof matcher !== "object" ||
    Array.isArray(matcher)
  ) {
    return badRule(
      index,
      'actor must be "*" or an object like {"role":"moderator"}',
    );
  }
  const keys = Object.keys(matcher);
  if (keys.length !== 1 || !["id", "role"].includes(keys[0])) {
    return badRule(
      index,
      'actor object must have exactly one of "id" or "role"',
    );
  }
  if (typeof matcher[keys[0]] !== "string" || matcher[keys[0]] === "") {
    return badRule(index, `actor.${keys[0]} must be a non-empty string`);
  }
  return null;
}

function checkResourceMatcher(index, matcher) {
  if (matcher === "*") return null;
  if (
    matcher === null ||
    typeof matcher !== "object" ||
    Array.isArray(matcher)
  ) {
    return badRule(
      index,
      'resource must be "*" or an object like {"ownerIs":"actor"}',
    );
  }
  const keys = Object.keys(matcher);
  if (keys.length !== 1 || !["id", "ownerIs", "ownerIsNot"].includes(keys[0])) {
    return badRule(
      index,
      'resource object must have exactly one of "id", "ownerIs", "ownerIsNot"',
    );
  }
  const key = keys[0];
  if (key === "id") {
    if (typeof matcher.id !== "string" || matcher.id === "") {
      return badRule(index, "resource.id must be a non-empty string");
    }
    return null;
  }
  if (matcher[key] !== "actor")
    return badRule(index, `resource.${key} must be "actor"`);
  return null;
}

/**
 * Validate the policy strictly and report every problem.
 *
 * A malformed policy is NEVER quietly replaced by a working one, in either
 * direction: the drafts routes answer 503 and say why, the desk page says why,
 * `/api/policy` says why, and the log says why once. An app that keeps serving
 * on a policy nobody wrote is the failure this whole problem is about.
 */
export function validatePolicy(raw) {
  const errors = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      errors: ["the policy file must contain a JSON object"],
      value: null,
    };
  }
  for (const key of Object.keys(raw)) {
    if (!["enabled", "readsPerRound", "rules"].includes(key)) {
      errors.push(`"${key}" is not a setting this app reads`);
    }
  }
  if (typeof raw.enabled !== "boolean") errors.push("enabled must be boolean");
  if (!Number.isInteger(raw.readsPerRound) || raw.readsPerRound < 1) {
    errors.push("readsPerRound must be a positive integer");
  }
  if (!Array.isArray(raw.rules)) {
    errors.push("rules must be an array");
    return { errors, value: null };
  }
  const rules = [];
  raw.rules.forEach((rule, index) => {
    if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
      errors.push(badRule(index, "must be an object"));
      return;
    }
    for (const key of Object.keys(rule)) {
      if (!["effect", "actions", "actor", "resource"].includes(key)) {
        errors.push(badRule(index, `"${key}" is not a key this app reads`));
      }
    }
    if (!EFFECTS.includes(rule.effect))
      errors.push(badRule(index, 'effect must be "allow" or "deny"'));
    if (
      !Array.isArray(rule.actions) ||
      rule.actions.length === 0 ||
      rule.actions.some((action) => !ACTIONS.includes(action))
    ) {
      errors.push(
        badRule(
          index,
          'actions must be a non-empty subset of ["read","publish"]',
        ),
      );
    }
    const actorProblem = checkActorMatcher(index, rule.actor);
    if (actorProblem !== null) errors.push(actorProblem);
    const resourceProblem = checkResourceMatcher(index, rule.resource);
    if (resourceProblem !== null) errors.push(resourceProblem);
    rules.push(rule);
  });
  if (errors.length > 0) return { errors, value: null };
  return {
    errors: [],
    value: { enabled: raw.enabled, readsPerRound: raw.readsPerRound, rules },
  };
}

const actorMatches = (matcher, actor) => {
  if (matcher === "*") return true;
  if (typeof matcher.id === "string") return matcher.id === actor.id;
  return matcher.role === actor.role;
};

const resourceMatches = (matcher, actor, draft) => {
  if (matcher === "*") return true;
  if (typeof matcher.id === "string") return matcher.id === draft.id;
  if (matcher.ownerIs === "actor") return draft.ownerId === actor.id;
  return draft.ownerId !== actor.id;
};

/**
 * Default deny; an explicit `deny` beats any `allow`, whatever the order.
 *
 * The same shape as every real policy language a participant will meet next —
 * IAM, Cedar, a row-level-security predicate. What is *not* here is any way to
 * express "this request came from that address": every probe arrives on
 * loopback from this process, so an address answer would be a lie about what
 * had been tested.
 */
export function decide(policy, actor, action, draft) {
  let allowed = false;
  for (const rule of policy.rules) {
    if (!rule.actions.includes(action)) continue;
    if (!actorMatches(rule.actor, actor)) continue;
    if (!resourceMatches(rule.resource, actor, draft)) continue;
    if (rule.effect === "deny") return false;
    allowed = true;
  }
  return allowed;
}
