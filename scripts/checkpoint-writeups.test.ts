import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { checkMultiVerifyTranslations } from "./validate-problems";
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(readFileSync(new URL("../SCHEMA.json", import.meta.url), "utf8")));
const fixture = () => JSON.parse(readFileSync(new URL("../challenges/stackstack-first-request/metadata.json", import.meta.url), "utf8"));
test("optional checkpoint explanations are bilingual, ID-matched and backward compatible", () => {
  const metadata = fixture();
  expect(validate(metadata)).toBe(true);
  expect(checkMultiVerifyTranslations(metadata)).toEqual([]);
  for (const check of metadata.scoring.checks) delete check.writeup;
  for (const check of metadata.i18n.en.checks) delete check.writeup;
  expect(validate(metadata)).toBe(true);
  expect(checkMultiVerifyTranslations(metadata)).toEqual([]);
  metadata.scoring.checks[0].writeup = "日本語の解説";
  expect(checkMultiVerifyTranslations(metadata).join(" ")).toContain("writeup");
  metadata.i18n.en.checks[0].writeup = "English explanation";
  expect(checkMultiVerifyTranslations(metadata)).toEqual([]);
  metadata.i18n.en.checks[0].id = "unknown-check";
  expect(checkMultiVerifyTranslations(metadata).length).toBeGreaterThan(0);
});
test("checkpoint explanation schema rejects non-text and blank prose", () => {
  for (const value of [null, 12, "", "  "]) {
    for (const locale of ["ja", "en"]) {
      const metadata = fixture();
      const checks = locale === "ja" ? metadata.scoring.checks : metadata.i18n.en.checks;
      checks[0].writeup = value;
      expect(validate(metadata)).toBe(false);
    }
  }
});
