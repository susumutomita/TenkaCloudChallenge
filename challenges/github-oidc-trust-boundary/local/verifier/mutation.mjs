import { gradeAll } from "./grader.mjs";
import { REFERENCE_POLICY } from "./reference.mjs";
import { AUDIENCE_KEY, SUBJECT_KEY } from "../app/engine.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const mutations = [
  ["drops the audience condition", (policy) => delete policy.trustPolicy.Statement[0].Condition.StringEquals[AUDIENCE_KEY]],
  ["allows every repository in the owner", (policy) => {
    const statement = policy.trustPolicy.Statement[0];
    delete statement.Condition.StringEquals[SUBJECT_KEY];
    statement.Condition.StringLike = { [SUBJECT_KEY]: "repo:tenkacloud/*" };
  }],
  ["allows the pull-request subject", (policy) => {
    policy.trustPolicy.Statement[0].Condition.StringEquals[SUBJECT_KEY] = "repo:tenkacloud/production-app:pull_request";
  }],
  ["widens the repository to every context", (policy) => {
    const statement = policy.trustPolicy.Statement[0];
    delete statement.Condition.StringEquals[SUBJECT_KEY];
    statement.Condition.StringLike = { [SUBJECT_KEY]: "repo:tenkacloud/production-app:*" };
  }],
  ["folds the environment name to lower case", (policy) => {
    policy.trustPolicy.Statement[0].Condition.StringEquals[SUBJECT_KEY] = "repo:tenkacloud/production-app:environment:production";
  }],
  ["treats a percent-encoded repository separator as canonical", (policy) => {
    policy.trustPolicy.Statement[0].Condition.StringEquals[SUBJECT_KEY] = "repo:tenkacloud%2Fproduction-app:environment:Production";
  }],
];

export function runMutations() {
  const results = [];
  for (const [name, mutate] of mutations) {
    const policy = clone(REFERENCE_POLICY);
    mutate(policy);
    results.push({ name, killed: gradeAll(policy).correct === false });
  }
  return results;
}

if (import.meta.main) {
  const results = runMutations();
  for (const result of results) console.log(`${result.killed ? "KILLED" : "SURVIVED"} ${result.name}`);
  if (!results.every((result) => result.killed)) process.exit(1);
  console.log(`All ${results.length} mutations killed.`);
}
