import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const repo = new URL("../../../", import.meta.url).pathname;

test("prototype placement cannot break native catalog's eligible-directory scan", () => {
  // Native browser-metadata.ts at TenkaCloud 05ffed84 reads metadata for every
  // directory matching this identity contract. The old battles/pi-siege path
  // crashed that scan despite the metadata-only catalog CI being green.
  for (const category of ["battles", "challenges"]) {
    for (const entry of readdirSync(join(repo, category), { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]*$/.test(entry.name)) continue;
      expect(existsSync(join(repo, category, entry.name, "metadata.json"))).toBe(true);
    }
  }
  expect(existsSync(join(repo, "battles", "pi-siege"))).toBe(false);
  expect(/^[a-z0-9][a-z0-9-]*$/.test("_pi-siege")).toBe(false);
});
test("the Portal owns scoped styles and coordination entry has the existing path shape", () => {
  const problem = join(repo, "battles", "_pi-siege");
  expect(existsSync(join(problem, "coordination", "pi-siege.ts"))).toBe(true);
  expect(readFileSync(join(problem, "portal", "StatusPanel.tsx"), "utf8")).toContain('import "./style.css"');
  const css = readFileSync(join(problem, "portal", "style.css"), "utf8");
  expect(css).not.toMatch(/(?:^|\n)(?:body|:root|\*)\s*\{/);
});
