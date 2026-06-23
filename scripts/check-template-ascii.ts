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

/**
 * Length of the top-level template `Description` (folded/literal block or inline).
 * CloudFormation rejects CreateChangeSet when this exceeds 1024 chars
 * ("'Description' length is greater than 1024"), so deploy never starts.
 */
function topLevelDescriptionLength(content: string): number {
  const block = content.match(/^Description:[ \t]*(?:[>|][-+0-9]*)?[ \t]*\n((?:[ \t]+.*(?:\n|$))+)/m);
  if (block) {
    return block[1]
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ").length;
  }
  const inline = content.match(/^Description:[ \t]*(\S.*)$/m);
  return inline ? inline[1].trim().length : 0;
}

for (const file of files) {
  const content = readFileSync(file, "utf8");
  // (1) charset: IAM Description allows only ASCII + Latin-1.
  content.split("\n").forEach((line, idx) => {
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
  // (2) length: top-level Description must be <= 1024 (CFn CreateChangeSet limit).
  const descLen = topLevelDescriptionLength(content);
  if (descLen > 1024) {
    errors.push(`${file}: top-level Description is ${descLen} chars (> 1024) -- CFn rejects CreateChangeSet (deploy never starts)`);
  }
}

if (errors.length > 0) {
  console.error("NG: CFn template(s) have IAM-Description / length problems");
  for (const e of errors) console.error(`  ${e}`);
  console.error(
    "\nFix: keep Descriptions ASCII (0x20-0x7E) + Latin-1 (0xA1-0xFF), and the\n" +
      "top-level template Description <= 1024 chars. Put long prose in metadata / README.",
  );
  process.exit(1);
}

console.log(`OK: ${files.length} CFn template(s) are ASCII+Latin-1 and Description <= 1024 (deploy-safe)`);
