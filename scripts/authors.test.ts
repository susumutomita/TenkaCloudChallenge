import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schema = JSON.parse(readFileSync(new URL("../SCHEMA.json", import.meta.url), "utf8"));
const validate = ajv.compile(schema);
const metadata = JSON.parse(readFileSync(new URL("../challenges/hello-world/metadata.json", import.meta.url), "utf8"));
test("legacy, empty, single and multiple public author credits are valid", () => {
  expect(validate(metadata)).toBe(true);
  for (const authors of [[], [{ name: "作者" }], [{ name: "作者", profileUrl: "https://example.com/profile" }, { name: "共同作者".repeat(100) }]]) expect(validate({ ...metadata, authors })).toBe(true);
});
test("reject malformed credits and unsafe profile URLs", () => {
  for (const authors of [null, {}, [null], [{}], [{ name: "" }], [{ name: "  " }], [{ name: 3 }], [{ name: "作者", email: "private" }]]) expect(validate({ ...metadata, authors })).toBe(false);
  for (const profileUrl of ["javascript:alert(1)", "data:text/html,evil", "file:///tmp/x", "//example.com", "/profile", "https://user:pass@example.com", "https://example.com:abc", "https://example.com:99999", "https://example.com:", "https://example.com/ a", "https://example.com/\\evil", "https:///example.com", "https://", "https://example.com/\n"]) expect(validate({ ...metadata, authors: [{ name: "作者", profileUrl }] })).toBe(false);
});
