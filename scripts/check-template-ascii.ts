#!/usr/bin/env bun
/**
 * CFn template ASCII / Latin-1 gate (problem-repo side).
 *
 * Why this lives here: problem `template.yaml` files are authored in THIS repo, but
 * the only ASCII gate used to live in the platform repo's pre-commit. So CJK in a
 * `Description:` (e.g. WAF Classic kuyo), a comment, or a typographic em-dash in
 * embedded HTML slipped in unnoticed and only blew up when the platform bumped the
 * submodule pin. Gate it at authoring time instead.
 *
 * IAM Role / Policy / IAM-adjacent CFn Description fields are constrained by IAM to
 * [tab/LF/CR + 0x20-0x7E + 0xA1-0xFF]. A CJK / non-Latin-1 char anywhere a template
 * may surface as an IAM Description makes CreateStack fail (CREATE_FAILED). We scan
 * the whole template to be safe; keep template copy ASCII English.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const TEMPLATE_DIRS = ["battles", "challenges"];

/** IAM Description allowed range: tab / LF / CR + printable ASCII + Latin-1 supplement. */
function isAllowedCharCode(cp: number): boolean {
  return (
    cp === 0x09 ||
    cp === 0x0a ||
    cp === 0x0d ||
    (cp >= 0x20 && cp <= 0x7e) ||
    (cp >= 0xa1 && cp <= 0xff)
  );
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (extname(entry) === ".yaml") out.push(full);
  }
  return out;
}

const errors: string[] = [];
const files = TEMPLATE_DIRS.flatMap((d) => {
  try {
    return walk(d);
  } catch {
    return [];
  }
});

for (const file of files) {
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, idx) => {
      for (const ch of line) {
        const cp = ch.codePointAt(0);
        if (cp === undefined) continue;
        if (!isAllowedCharCode(cp)) {
          const hex = cp.toString(16).toUpperCase().padStart(4, "0");
          errors.push(`${file}:${idx + 1}: non-Latin1 char U+${hex} (${ch}) -- breaks IAM Description (CREATE_FAILED)`);
          break;
        }
      }
    });
}

if (errors.length > 0) {
  console.error("NG: CFn template(s) contain CJK / non-Latin-1 characters");
  for (const e of errors) console.error(`  ${e}`);
  console.error(
    "\nIAM Role / Policy Description allows only ASCII (0x20-0x7E) + Latin-1 supplement (0xA1-0xFF).\n" +
      "Replace CJK / Japanese with ASCII English (Descriptions, comments, embedded HTML).",
  );
  process.exit(1);
}

console.log(`OK: ${files.length} CFn template(s) are ASCII + Latin-1 (IAM Description safe)`);
