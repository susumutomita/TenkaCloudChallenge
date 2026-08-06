import {
  classifyEvidence,
  COMPROMISED_VERSION,
  evaluateHost,
  evaluateScriptPolicy,
  PATCHED_VERSION,
  PUBLIC_HOSTS,
  PUBLIC_PATCHED_SUBJECT,
  PUBLIC_REVIEW_SUBJECT,
  reviewPackage,
  validateTriage,
} from "../app/engine.mjs";

const HOST_EXPECTATIONS = Object.freeze({
  "ci-runner-7": { state: "scripts-executed", actions: "hunt-indicators|isolate|rotate-credentials" },
  "dev-laptop-3": { state: "installed-scripts-disabled", actions: "remove-artifact" },
  "prod-service-a": { state: "not-installed", actions: "monitor" },
});

export function runPublicCases(triage) {
  const errors = validateTriage(triage);
  if (errors.length > 0) return { correct: false, errors, cases: [] };

  const results = [];
  const verdict = reviewPackage(triage, PUBLIC_REVIEW_SUBJECT);
  const locked = PUBLIC_REVIEW_SUBJECT.lockfile;
  results.push({
    name: "resolved version comes from the lockfile",
    expected: `lockfile ${COMPROMISED_VERSION}`,
    actual: verdict.resolution ? `${verdict.resolution.source} ${verdict.resolution.version}` : "unresolved",
    passed:
      verdict.resolution !== null &&
      verdict.resolution.source === "lockfile" &&
      verdict.resolution.version === locked.version &&
      verdict.resolution.integrity === locked.integrity,
    reasons: verdict.reasons,
  });
  results.push({
    name: "compromised tarball is flagged despite the valid attestation",
    expected: "flag",
    actual: verdict.flagged ? "flag" : "safe",
    passed: verdict.flagged === true,
    reasons: verdict.reasons,
  });

  const patched = reviewPackage(triage, PUBLIC_PATCHED_SUBJECT);
  results.push({
    name: `clean patched release ${PATCHED_VERSION} is not flagged`,
    expected: "safe",
    actual: patched.flagged ? "flag" : "safe",
    passed: patched.flagged === false,
    reasons: patched.reasons,
  });

  const neededScript = evaluateScriptPolicy(triage, { name: "native-hash", version: "3.4.1", event: "preinstall" });
  results.push({
    name: "native-hash@3.4.1 keeps its needed install script",
    expected: "allow",
    actual: neededScript.allowed ? "allow" : "deny",
    passed: neededScript.allowed === true,
    reasons: [neededScript.reason],
  });
  const compromisedScript = evaluateScriptPolicy(triage, {
    name: "flatstore",
    version: COMPROMISED_VERSION,
    event: "preinstall",
  });
  results.push({
    name: "flatstore preinstall is denied by default",
    expected: "deny",
    actual: compromisedScript.allowed ? "allow" : "deny",
    passed: compromisedScript.allowed === false,
    reasons: [compromisedScript.reason],
  });

  for (const host of PUBLIC_HOSTS) {
    const expected = HOST_EXPECTATIONS[host.id];
    const outcome = evaluateHost(triage, host);
    const truth = classifyEvidence(host, false);
    const passed =
      outcome.state === expected.state &&
      truth === expected.state &&
      [...outcome.actions].sort().join("|") === expected.actions;
    results.push({
      name: `${host.id} gets the response its evidence supports`,
      expected: `${expected.state}: ${expected.actions}`,
      actual: `${outcome.state}: ${[...outcome.actions].sort().join("|")}`,
      passed,
      reasons: [],
    });
  }

  const correct = results.every((item) => item.passed);
  return {
    correct,
    errors: correct ? [] : ["one or more public triage cases failed"],
    cases: results,
  };
}
