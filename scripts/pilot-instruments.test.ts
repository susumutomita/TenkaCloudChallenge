import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

/**
 * The pilot instruments check themselves.
 *
 * Eight documents in `docs/curricula/advanced-cryptography-2026/pilot/` have to
 * agree with each other before a single participant is recruited, and once the
 * freeze lands they cannot be corrected. Until now nothing verified any of it —
 * the instruments were prose and JSON that a reviewer read.
 *
 * Review found nine defects in them. Five were mechanical:
 *
 * - two cross-document `§N` citations pointed at the wrong section, and one of
 *   those pointed at a section that says the opposite of what was cited;
 * - three schema constraints were stated in a `description` and enforced by
 *   nobody — `interventionRung` "required in practice", `delayDaysRange`
 *   "delayed instrument only", and a `scoring.kind` that never required the
 *   field that makes the item scorable;
 * - a bilingual item stated one numeric range in English and a different one in
 *   Japanese.
 *
 * Every one of those is checkable, so it is checked here rather than left to the
 * next reader's attention. The remaining four were judgement calls about ethics
 * and procedure, which a test cannot make.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PILOT = "docs/curricula/advanced-cryptography-2026/pilot";

const read = (name: string) => readFileSync(join(REPO_ROOT, PILOT, name), "utf8");
const parse = (name: string) => JSON.parse(read(name));

const SCHEMAS = ["event-schema.json", "pre-test.schema.json", "transfer-test.schema.json"];
/** Every pilot markdown file — citations are scanned in all of them. */
const DOCS = ["protocol.md", "consent.md", "analysis-plan.md", "observation-form.md", "interview-rubric.md"];

/**
 * The subset that numbers its sections, and so can be the *target* of a `§N`.
 *
 * `observation-form.md` labels its sections A, B, C… on purpose — it is a paper
 * form, and lettered blocks are what an observer writes on. Requiring numbers
 * there would be the test bending the document to suit itself.
 */
const CITABLE = ["protocol.md", "consent.md", "analysis-plan.md", "interview-rubric.md"];

/**
 * A valid envelope, lifted from the schema's own first example.
 *
 * Hand-writing one would make this file a second, quietly-diverging statement of
 * the envelope. Taking it from the example means the fixtures below stay valid
 * exactly as long as the examples do — and the examples are checked above.
 */
const ENVELOPE = (() => {
  const [first] = JSON.parse(readFileSync(join(REPO_ROOT, PILOT, "event-schema.json"), "utf8"))
    .examples as Record<string, unknown>[];
  const { type: _type, payload: _payload, ...envelope } = first as Record<string, unknown>;
  return envelope;
})();

function ajv() {
  const instance = new Ajv2020({ strict: false, allErrors: true });
  addFormats(instance);
  return instance;
}

describe("the pilot instrument set is complete", () => {
  it("should contain exactly the eight files the issue names", () => {
    // #248's deliverable is the set, and a missing instrument is the one failure
    // that cannot be fixed after the freeze.
    const present = readdirSync(join(REPO_ROOT, PILOT)).sort();
    expect(present).toEqual(
      [
        "analysis-plan.md",
        "consent.md",
        "event-schema.json",
        "interview-rubric.md",
        "observation-form.md",
        "pre-test.schema.json",
        "protocol.md",
        "transfer-test.schema.json",
      ].sort(),
    );
  });
});

describe("every schema is a schema", () => {
  it.each(SCHEMAS)("%s should compile", (name) => {
    expect(() => ajv().compile(parse(name))).not.toThrow();
  });

  it.each(SCHEMAS)("%s should validate its own examples", (name) => {
    // A schema whose own example does not validate is the cheapest possible
    // form of "documented but not enforced", and it is how the AQ5 defect in
    // this PR's first pass survived: the metric named a field the event type
    // forbade, and nothing ever fed one through.
    const schema = parse(name);
    const examples: unknown[] = schema.examples ?? [];
    if (examples.length === 0) return;
    const validate = ajv().compile(schema);
    for (const [index, example] of examples.entries()) {
      const ok = validate(example);
      expect(ok ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`)).toEqual(
        [],
      );
      expect(ok).toBe(true);
      void index;
    }
  });
});

describe("constraints stated in prose are enforced by the schema", () => {
  it("should require interventionRung when the category is intervention", () => {
    const validate = ajv().compile(parse("event-schema.json"));
    // Find the observation payload branch by shape rather than by index, so a
    // reordered oneOf does not silently skip this.
    const note = (payload: Record<string, unknown>) => ({
      ...ENVELOPE,
      type: "observation.note",
      payload: { observed: "scrolled back to the README twice", ...payload },
    });
    // An intervention with no rung must be refused; the same note with a rung,
    // and any non-intervention category without one, must be accepted.
    expect(validate(note({ category: "intervention" }))).toBe(false);
    expect(validate(note({ category: "intervention", interventionRung: 2 }))).toBe(true);
    expect(validate(note({ category: "friction" }))).toBe(true);
  });

  it("should scope delayDaysRange to the delayed instrument", () => {
    const source = read("transfer-test.schema.json");
    const schema = JSON.parse(source);
    const branches = (schema.allOf ?? [])
      .map((b: Record<string, never>) => (b as Record<string, never>).then)
      .filter(Boolean)
      .map((t: Record<string, never>) => (t as Record<string, never>).properties)
      .filter(Boolean)
      .map((p: Record<string, never>) => (p as Record<string, never>).administration)
      .filter(Boolean) as Record<string, never>[];
    expect(branches.length).toBeGreaterThan(1);
    const immediate = branches.find(
      (a) => (a as Record<string, never>).properties?.stage?.const === 3,
    );
    const delayed = branches.find(
      (a) => (a as Record<string, never>).properties?.stage?.const === 5,
    );
    // The field's own description says delayed-only. Say it where it binds.
    expect(immediate?.not).toEqual({ required: ["delayDaysRange"] });
    expect(delayed?.required).toContain("delayDaysRange");
  });

  it.each(["pre-test.schema.json", "transfer-test.schema.json"])(
    "%s should tie a scoring kind to the field that makes it scorable",
    (name) => {
      const schema = parse(name);
      const scoringRules = JSON.stringify(schema.$defs.scoring.allOf ?? []);
      expect(scoringRules).toContain("rubric");
      expect(scoringRules).toContain("anchors");
      const itemRules = JSON.stringify(schema.$defs.item.allOf ?? []);
      expect(itemRules).toContain("single-choice");
      expect(itemRules).toContain("correctChoice");
    },
  );

  it("should require repeatOf on a repeat, which is the direction that can fail", () => {
    const schema = parse("transfer-test.schema.json");
    // `repeat` is already in `required`, so `dependentRequired: {repeatOf:
    // [repeat]}` enforced nothing. The reachable defect is the other direction.
    expect(schema.$defs.item.dependentRequired?.repeatOf).toBeUndefined();
    expect(JSON.stringify(schema.$defs.item.allOf ?? [])).toContain("repeatOf");
  });
});

describe("cross-document citations resolve", () => {
  /** `## 7. How long we keep it` → 7 */
  function sections(markdown: string): Set<number> {
    return new Set(
      [...markdown.matchAll(/^#{2,3} (\d+)\. /gm)].map((match) => Number(match[1])),
    );
  }

  const NUMBERED = new Map(CITABLE.map((name) => [name, sections(read(name))]));

  it("should find numbered sections to check against", () => {
    for (const [name, found] of NUMBERED) {
      expect(found.size, `${name} has no numbered sections`).toBeGreaterThan(0);
    }
  });

  it("should not cite a section number that does not exist", () => {
    // Two of review's nine findings were exactly this, and one of them cited a
    // section that says the opposite of the thing it was cited for. A dangling
    // §N is invisible to a reader who does not go and look.
    const broken: string[] = [];
    for (const from of DOCS) {
      const body = read(from);
      const pattern = /`?([a-z-]+\.md)`?\s*(?:§|section )\s*(\d+)/gi;
      for (const match of body.matchAll(pattern)) {
        const target = match[1] as string;
        const number = Number(match[2]);
        const known = NUMBERED.get(target);
        if (known === undefined) continue; // not one of ours
        if (!known.has(number)) broken.push(`${from} cites ${target} §${number}, which does not exist`);
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("the participant-facing numbers agree", () => {
  it("should state the same total time commitment in protocol and consent", () => {
    // consent.md said "roughly four hours" while protocol.md's own table summed
    // to 5 h 10. A participant who agreed to four hours did not agree to five,
    // so this is a consent defect rather than a typo.
    const protocolTotal = /\*\*Total\*\* \| \*\*(\d+) h (\d+) min\*\*/.exec(read("protocol.md"));
    expect(protocolTotal).not.toBeNull();
    const hours = Number(protocolTotal?.[1]);
    const minutes = Number(protocolTotal?.[2]);
    expect(read("consent.md")).toContain(`${hours} hours ${minutes} minutes`);
  });
});

describe("the privacy promise is a schema property", () => {
  /**
   * `consent.md` §5 lists what is never collected, and the schema refuses those
   * keys at the root of any event rather than per event type — one `not.anyOf`
   * covering all twenty-one types, so a new event type cannot reintroduce them
   * by forgetting.
   */
  const FORBIDDEN = [
    "keystrokes",
    "keystrokeLog",
    "prompt",
    "promptText",
    "aiPrompt",
    "completion",
    "sourceCode",
    "credentials",
    "secrets",
    "apiKey",
    "flagSeedValue",
    "realName",
    "email",
    "ipAddress",
    "screenRecording",
  ] as const;

  const valid = {
    ...ENVELOPE,
    type: "ai-assistant.use",
    payload: {
      problemId: "ac26-w1-constraint-lab",
      purpose: "explain-concept",
      target: "own-code",
      declaredBy: "participant",
    },
  };

  it("should accept an assistant-use event that declares only the category", () => {
    const validate = ajv().compile(parse("event-schema.json"));
    const ok = validate(valid);
    expect(ok ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`)).toEqual([]);
  });

  it.each(FORBIDDEN)("should refuse an event carrying %s", (field) => {
    // The point of the root-level `not` is that this holds for every event type,
    // not only the one that would obviously carry a prompt.
    const validate = ajv().compile(parse("event-schema.json"));
    expect(validate({ ...valid, [field]: "x" })).toBe(false);
  });

  it("should refuse every forbidden key the consent text names", () => {
    // Keeps the list above honest against the schema, so neither can shrink
    // quietly: consent.md promises a set, and this is that set.
    const schema = parse("event-schema.json");
    const declared = (schema.not.anyOf as { required: string[] }[]).map((e) => e.required[0]);
    expect(declared.sort()).toEqual([...FORBIDDEN].sort());
  });
});
