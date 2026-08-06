import { reviewPackage } from "../app/engine.mjs";
import { gradeAll, gradeReplay } from "./grader.mjs";
import { REFERENCE_TRIAGE } from "./reference.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mutated(mutate) {
  const triage = clone(REFERENCE_TRIAGE);
  mutate(triage);
  return triage;
}

/** 依存 graph の並び順に結果が依存する評価器 (= 同名 package の最初の verdict を使い回す)。 */
function orderDependentEvaluator() {
  const memo = new Map();
  return (submission, subject) => {
    if (!memo.has(subject.name)) memo.set(subject.name, reviewPackage(submission, subject));
    return memo.get(subject.name);
  };
}

const mutations = [
  ["provenance-implies-safe", () => gradeAll(mutated((triage) => {
    triage.review.treatValidAttestationAsSafe = true;
  })).correct === false],
  ["ignore-lockfile-resolution", () => gradeAll(mutated((triage) => {
    triage.review.resolveFrom = "manifest-range";
  })).correct === false],
  ["ignore-lifecycle-script", () => gradeAll(mutated((triage) => {
    triage.review.flagOn = triage.review.flagOn.filter((signal) => signal !== "added-lifecycle-script");
  })).correct === false],
  ["allow-all-scripts", () => gradeAll(mutated((triage) => {
    triage.scriptPolicy = { default: "allow", allow: [] };
  })).correct === false],
  ["rotate-without-execution-evidence", () => gradeAll(mutated((triage) => {
    triage.incident.actions["installed-scripts-disabled"] = ["remove-artifact", "rotate-credentials"];
  })).correct === false],
  ["order-dependent-graph", () => gradeReplay(REFERENCE_TRIAGE, orderDependentEvaluator()) === false],
];

export function runMutations() {
  return mutations.map(([name, killed]) => ({ name, killed: killed() }));
}

const invokedDirectly = import.meta.main ?? process.argv[1]?.endsWith("mutation.mjs");
if (invokedDirectly) {
  const results = runMutations();
  for (const result of results) console.log(`${result.killed ? "KILLED" : "SURVIVED"} ${result.name}`);
  if (!results.every((result) => result.killed)) process.exit(1);
  console.log(`All ${results.length} mutations killed.`);
}
