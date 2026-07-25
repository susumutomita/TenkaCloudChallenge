import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "bun:test";
import { toCourseAlignment } from "./build-index";
import { checkCourseAlignment } from "./validate-problems";

/**
 * [#211] course alignment metadata の契約テスト。
 *
 * 形 (1 field ごと) は SCHEMA.json、 field をまたぐ規律は checkCourseAlignment が見る。
 * 両方をここで固定し、 「schema は通るが対応表から辿れない」 状態を作れないようにする。
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const SCHEMA = JSON.parse(readFileSync(join(REPO_ROOT, "SCHEMA.json"), "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateMetadata = ajv.compile(SCHEMA);

const SHA = "5e80999306608a45aecf9a0e4e3394a0b62f34d2";

/**
 * courseAlignment だけを検証したいので、 base は実在の valid な問題をそのまま使う。
 * 手書きの最小 metadata だと schema 側の必須 field 追加で無関係に壊れる。
 */
const BASE_METADATA = JSON.parse(
  readFileSync(join(REPO_ROOT, "challenges/hello-world/metadata.json"), "utf8"),
);

function metadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...structuredClone(BASE_METADATA), ...overrides };
}

function alignment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    courseId: "advanced-cryptography-program",
    edition: "2026",
    week: 1,
    role: "mechanism",
    spoilerPolicy: "independent-reimplementation",
    ...overrides,
  };
}

function source(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    repository: "zk-tokyo/advanced-cryptography-2026",
    ref: SHA,
    path: "week1/README.md",
    kind: "lecture",
    ...overrides,
  };
}

function schemaErrorsFor(meta: Record<string, unknown>): string[] {
  return validateMetadata(meta) ? [] : (validateMetadata.errors ?? []).map((e) => e.message ?? "");
}

describe("courseAlignment schema (#211)", () => {
  it("should accept a minimal alignment with no sources", () => {
    expect(schemaErrorsFor(metadata({ courseAlignment: alignment() }))).toEqual([]);
  });

  it("should accept several pinned sources of different kinds", () => {
    const meta = metadata({
      courseAlignment: alignment({
        sources: [
          source(),
          source({ path: "week1/problems/proof-of-exploit/README.md", kind: "assignment" }),
        ],
      }),
    });
    expect(schemaErrorsFor(meta)).toEqual([]);
  });

  it("should accept every declared role and spoiler policy", () => {
    for (const role of [
      "diagnostic",
      "mechanism",
      "assignment-companion",
      "transfer",
      "synthesis",
    ]) {
      expect(schemaErrorsFor(metadata({ courseAlignment: alignment({ role }) }))).toEqual([]);
    }
    for (const spoilerPolicy of [
      "public-reference",
      "independent-reimplementation",
      "approved-derivative",
    ]) {
      expect(schemaErrorsFor(metadata({ courseAlignment: alignment({ spoilerPolicy }) }))).toEqual(
        [],
      );
    }
  });

  it("should reject a role or spoiler policy outside the vocabulary", () => {
    expect(schemaErrorsFor(metadata({ courseAlignment: alignment({ role: "companion" }) }))).not
      .toEqual([]);
    expect(
      schemaErrorsFor(metadata({ courseAlignment: alignment({ spoilerPolicy: "copied" }) })),
    ).not.toEqual([]);
  });

  it("should reject week 0 and negative weeks", () => {
    expect(schemaErrorsFor(metadata({ courseAlignment: alignment({ week: 0 }) }))).not.toEqual([]);
    expect(schemaErrorsFor(metadata({ courseAlignment: alignment({ week: -1 }) }))).not.toEqual([]);
  });

  it("should reject a branch or tag where a 40-hex commit SHA is required", () => {
    // ここが緩むと upstream の変更に黙って追随してしまう (GOVERNANCE.md §5)。
    for (const ref of ["main", "v1.0.0", SHA.slice(0, 7), `${SHA}0`, SHA.toUpperCase()]) {
      const meta = metadata({ courseAlignment: alignment({ sources: [source({ ref })] }) });
      expect(schemaErrorsFor(meta), `ref=${ref} must be rejected`).not.toEqual([]);
    }
  });

  it("should reject an absolute path or a URL-escaped path", () => {
    for (const path of ["/etc/passwd", "week1%2F..%2Fsecret", "../outside/README.md"]) {
      const meta = metadata({ courseAlignment: alignment({ sources: [source({ path })] }) });
      expect(schemaErrorsFor(meta), `path=${path} must be rejected`).not.toEqual([]);
    }
  });

  it("should reject a repository given as a URL instead of owner/name", () => {
    const meta = metadata({
      courseAlignment: alignment({
        sources: [source({ repository: "https://github.com/zk-tokyo/advanced-cryptography-2026" })],
      }),
    });
    expect(schemaErrorsFor(meta)).not.toEqual([]);
  });

  it("should reject unknown fields so typos are not silently ignored", () => {
    const meta = metadata({ courseAlignment: alignment({ weeK: 1 }) });
    expect(schemaErrorsFor(meta)).not.toEqual([]);
  });

  it("should leave existing problems without courseAlignment valid", () => {
    expect(schemaErrorsFor(metadata())).toEqual([]);
  });
});

describe("checkCourseAlignment cross-field rules (#211)", () => {
  const track = { id: "advanced-cryptography-2026", order: 110, chapter: "Week 1 / Circuits" };

  it("should pass a consistent track + alignment pair", () => {
    expect(checkCourseAlignment(metadata({ track, courseAlignment: alignment() }))).toEqual([]);
  });

  it("should require alignment once the track is bound to a course", () => {
    const errors = checkCourseAlignment(metadata({ track }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("requires courseAlignment");
  });

  it("should not require alignment for tracks that are not course-bound", () => {
    const other = { id: "ipa-web-security", order: 2, chapter: "IPA §1.6 CSRF" };
    expect(checkCourseAlignment(metadata({ track: other }))).toEqual([]);
  });

  it("should reject a courseId or edition that contradicts the track", () => {
    const wrongCourse = checkCourseAlignment(
      metadata({ track, courseAlignment: alignment({ courseId: "some-other-course" }) }),
    );
    expect(wrongCourse.join("\n")).toContain("courseAlignment.courseId must be");

    const wrongEdition = checkCourseAlignment(
      metadata({ track, courseAlignment: alignment({ edition: "2025" }) }),
    );
    expect(wrongEdition.join("\n")).toContain("courseAlignment.edition must be");
  });

  it("should reject a '..' segment the schema pattern lets through", () => {
    // `week1/../../secret` は先頭 / でも % でもないので schema は通る。
    const meta = metadata({
      courseAlignment: alignment({ sources: [source({ path: "week1/../../secret" })] }),
    });
    expect(schemaErrorsFor(meta)).toEqual([]);
    expect(checkCourseAlignment(meta).join("\n")).toContain('must not contain a ".." segment');
  });

  it("should reject two source entries pointing at the same pinned file", () => {
    const meta = metadata({
      courseAlignment: alignment({ sources: [source(), source({ kind: "assignment" })] }),
    });
    expect(checkCourseAlignment(meta).join("\n")).toContain("duplicates an earlier entry");
  });

  it("should allow the same path pinned at two different commits", () => {
    const other = `${"a".repeat(39)}0`;
    const meta = metadata({
      courseAlignment: alignment({ sources: [source(), source({ ref: other })] }),
    });
    expect(checkCourseAlignment(meta)).toEqual([]);
  });

  it("should refuse to ship an embargoed problem as ready", () => {
    const meta = metadata({
      status: "ready",
      courseAlignment: alignment({ spoilerPolicy: "embargoed" }),
    });
    expect(checkCourseAlignment(meta).join("\n")).toContain("cannot ship with status");
  });

  it("should allow an embargoed problem while it is still a draft", () => {
    const meta = metadata({
      status: "draft",
      courseAlignment: alignment({ spoilerPolicy: "embargoed" }),
    });
    expect(checkCourseAlignment(meta)).toEqual([]);
  });
});

describe("participant-safe index projection (#211)", () => {
  it("should project the alignment fields a learner needs", () => {
    const projected = toCourseAlignment(
      metadata({ courseAlignment: alignment({ sources: [source()] }) }),
    );
    expect(projected).toEqual({
      courseId: "advanced-cryptography-program",
      edition: "2026",
      week: 1,
      role: "mechanism",
      sources: [
        {
          repository: "zk-tokyo/advanced-cryptography-2026",
          ref: SHA,
          path: "week1/README.md",
          kind: "lecture",
        },
      ],
    });
  });

  it("should never leak spoilerPolicy into the participant-facing catalog", () => {
    const projected = toCourseAlignment(metadata({ courseAlignment: alignment() }));
    expect(projected).not.toHaveProperty("spoilerPolicy");
  });

  it("should drop an embargoed problem's alignment entirely", () => {
    // 「まだ出せない」 は flag ではなく不在で表す (client 側の判断に委ねない)。
    const projected = toCourseAlignment(
      metadata({
        status: "draft",
        courseAlignment: alignment({ spoilerPolicy: "embargoed", sources: [source()] }),
      }),
    );
    expect(projected).toBeUndefined();
  });

  it("should omit sources when the week has no citable source", () => {
    const projected = toCourseAlignment(metadata({ courseAlignment: alignment({ week: 2 }) }));
    expect(projected).not.toHaveProperty("sources");
  });

  it("should leave a problem without courseAlignment unprojected", () => {
    expect(toCourseAlignment(metadata())).toBeUndefined();
  });
});
