import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PROBLEM_NAMES } from "./app/names.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

/** compose の `SCENARIO:` を宣言している問題と、その名前を集める。 */
function catalogScenarios() {
  const found = [];
  for (const id of readdirSync(`${root}challenges`)) {
    let compose;
    try {
      compose = readFileSync(`${root}challenges/${id}/local/docker-compose.yml`, "utf8");
    } catch {
      continue;
    }
    const scenario = compose.match(/^\s*SCENARIO:\s*"?([\w-]+)"?\s*$/m)?.[1];
    if (!scenario) continue;
    const metadata = JSON.parse(readFileSync(`${root}challenges/${id}/metadata.json`, "utf8"));
    found.push({ id, scenario, ja: metadata.name, en: metadata.i18n.en.name });
  }
  return found;
}

const problems = catalogScenarios();

test("the catalog has StackStack problems to compare against", () => {
  assert.equal(problems.length, 9);
});

for (const { id, scenario, ja, en } of problems) {
  test(`${id}: the API console title is the problem name in both languages`, () => {
    assert.deepEqual(PROBLEM_NAMES[scenario], { ja, en });
  });
}

test("every scenario module has a name", () => {
  const scenarios = readdirSync(`${root}runtimes/stackstack/app/scenarios`).map((file) => file.replace(/\.mjs$/, ""));
  assert.deepEqual(Object.keys(PROBLEM_NAMES).sort(), scenarios.sort());
});
