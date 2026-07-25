import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "bun:test";
import {
  parseCourseArgs,
  portsFor,
  rewriteCompose,
  rewriteCourseMetadata,
  rewriteMakefile,
} from "./new-course-challenge";

/**
 * [#212] course-aligned challenge の scaffold 契約テスト。
 *
 * 手で copy すると必ず取りこぼす 4 箇所 — port、track.order、courseAlignment、
 * service 名 — を rewrite が全部書き換えることを固定する。取りこぼすと
 * 「隣の challenge と port が衝突する」「対応表から辿れない」形で後から効く。
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const SCHEMA = JSON.parse(readFileSync(join(REPO_ROOT, "SCHEMA.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateMetadata = ajv.compile(SCHEMA);

const SAMPLE = readFileSync(
  join(REPO_ROOT, "challenges/ac26-bridge-experiment/metadata.json"),
  "utf8",
);

function args(overrides: Record<string, unknown> = {}) {
  return {
    trackId: "advanced-cryptography-2026",
    id: "ac26-w3-field-inverse",
    week: 3,
    role: "mechanism",
    order: 310,
    chapter: "Week 3 / TODO",
    from: "ac26-bridge-experiment",
    ...overrides,
  } as Parameters<typeof rewriteCourseMetadata>[1];
}

describe("parseCourseArgs", () => {
  const base = ["advanced-cryptography-2026", "ac26-w3-field-inverse"];

  it("should accept a complete invocation", () => {
    const parsed = parseCourseArgs([...base, "--week", "3", "--role", "mechanism", "--order", "310"]);
    expect(parsed).toMatchObject({
      trackId: "advanced-cryptography-2026",
      id: "ac26-w3-field-inverse",
      week: 3,
      role: "mechanism",
      order: 310,
    });
  });

  it("should reject a track that no course is bound to", () => {
    const parsed = parseCourseArgs(["some-other-track", "x", "--week", "1", "--role", "mechanism", "--order", "10"]);
    expect(parsed).toHaveProperty("error");
  });

  it("should reject a role outside the alignment vocabulary", () => {
    // 語彙外の role は SCHEMA で落ちるが、 scaffold 時点で言わないと
    // 「生成できたのに validate で落ちる」体験になる。
    const parsed = parseCourseArgs([...base, "--week", "3", "--role", "companion", "--order", "310"]);
    expect(parsed).toHaveProperty("error");
  });

  it("should reject a week below 1, since course weeks are 1-based", () => {
    expect(parseCourseArgs([...base, "--week", "0", "--role", "mechanism", "--order", "310"])).toHaveProperty(
      "error",
    );
  });

  it("should reject an order that is not a positive multiple of ten", () => {
    // order は port の導出元なので、 10 刻みでないと隣と重なる。
    for (const order of ["0", "-10", "315"]) {
      expect(
        parseCourseArgs([...base, "--week", "3", "--role", "mechanism", "--order", order]),
      ).toHaveProperty("error");
    }
  });

  it("should require every flag", () => {
    expect(parseCourseArgs([...base, "--role", "mechanism", "--order", "310"])).toHaveProperty("error");
    expect(parseCourseArgs([...base, "--week", "3", "--order", "310"])).toHaveProperty("error");
    expect(parseCourseArgs([...base, "--week", "3", "--role", "mechanism"])).toHaveProperty("error");
  });

  it("should reject an id that is not kebab-case", () => {
    expect(
      parseCourseArgs(["advanced-cryptography-2026", "AC26_Bad", "--week", "3", "--role", "mechanism", "--order", "310"]),
    ).toHaveProperty("error");
  });
});

describe("portsFor", () => {
  it("should derive both ports from track order so two challenges cannot collide", () => {
    expect(portsFor(10)).toEqual({ challenge: 18310, verify: 18311 });
    expect(portsFor(310)).toEqual({ challenge: 18610, verify: 18611 });
    expect(portsFor(720)).toEqual({ challenge: 19020, verify: 19021 });
  });

  it("should never overlap for adjacent orders", () => {
    const a = portsFor(10);
    const b = portsFor(20);
    expect(b.challenge).toBeGreaterThan(a.verify);
  });

  it("should stay clear of the ports the rest of the catalog already uses", () => {
    // 18080/18081, 18100/18101, 18200/18201 が既に使われている。
    for (const order of [10, 20, 110, 720]) {
      expect(portsFor(order).challenge).toBeGreaterThan(18201);
    }
  });
});

describe("rewriteCourseMetadata", () => {
  it("should produce metadata that validates against the schema", () => {
    const out = JSON.parse(rewriteCourseMetadata(SAMPLE, args()));
    expect(validateMetadata(out)).toBe(true);
  });

  it("should set the id, and mark it draft so a skeleton cannot ship as ready", () => {
    const out = JSON.parse(rewriteCourseMetadata(SAMPLE, args()));
    expect(out.id).toBe("ac26-w3-field-inverse");
    expect(out.status).toBe("draft");
  });

  it("should carry the track position and chapter through", () => {
    const out = JSON.parse(rewriteCourseMetadata(SAMPLE, args()));
    expect(out.track).toEqual({
      id: "advanced-cryptography-2026",
      order: 310,
      chapter: "Week 3 / TODO",
    });
  });

  it("should set the course alignment week and role", () => {
    const out = JSON.parse(rewriteCourseMetadata(SAMPLE, args()));
    expect(out.courseAlignment.week).toBe(3);
    expect(out.courseAlignment.role).toBe("mechanism");
    expect(out.courseAlignment.courseId).toBe("advanced-cryptography-program");
    expect(out.courseAlignment.edition).toBe("2026");
  });

  it("should drop the sample's source pins rather than inherit a claim nobody checked", () => {
    // pin は「この版を読んだ」という記録。 copy 元の pin を引き継ぐのは
    // 読んでいない版について読んだと言うこと。
    expect(JSON.parse(SAMPLE).courseAlignment.sources).toBeDefined();
    const out = JSON.parse(rewriteCourseMetadata(SAMPLE, args()));
    expect(out.courseAlignment.sources).toBeUndefined();
  });

  it("should renumber both ports and the runtime URLs together", () => {
    const out = JSON.parse(rewriteCourseMetadata(SAMPLE, args()));
    expect(out.exposedPorts.map((p: { port: number }) => p.port)).toEqual([18610, 18611]);
    expect(out.runtime.verifyUrl).toBe("http://127.0.0.1:18611/verify");
    expect(JSON.stringify(out.runtime.challengeEndpoints)).toContain("18610");
  });

  it("should not leave the sample's own scoring content behind as if it were authored", () => {
    const out = JSON.parse(rewriteCourseMetadata(SAMPLE, args()));
    expect(JSON.stringify(out.scoring)).not.toContain("first-divergence");
    expect(out.scoring.kind).toBe("multi-verify");
    // multi-verify は 2 件以上必須で、 ASSESSMENT.md も証拠種別 2 種以上を要求する。
    expect(out.scoring.checks.length).toBeGreaterThanOrEqual(2);
    expect(out.i18n.en.checks.map((c: { id: string }) => c.id)).toEqual(
      out.scoring.checks.map((c: { id: string }) => c.id),
    );
  });

  it("should blank the prose so a copied writeup cannot ship under a new id", () => {
    const out = JSON.parse(rewriteCourseMetadata(SAMPLE, args()));
    for (const field of [out.description, out.shortDescription, out.instructions, out.writeup]) {
      expect(field).toContain("TODO");
    }
    expect(out.writeup).not.toContain("ずれた計数器");
    expect(out.i18n.en.writeup).toContain("TODO");
  });
});

describe("rewriteCompose", () => {
  const compose = readFileSync(
    join(REPO_ROOT, "challenges/ac26-bridge-experiment/local/docker-compose.yml"),
    "utf8",
  );

  it("should rename the service and renumber the published ports", () => {
    const out = rewriteCompose(compose, { id: "ac26-w3-field-inverse", ports: portsFor(310) });
    expect(out).toContain("ac26-w3-field-inverse:");
    expect(out).toContain("127.0.0.1:18610:8080");
    expect(out).toContain("127.0.0.1:18611:8081");
  });

  it("should leave no reference to the sample it was copied from", () => {
    const out = rewriteCompose(compose, { id: "ac26-w3-field-inverse", ports: portsFor(310) });
    expect(out).not.toContain("ac26-bridge-experiment");
    expect(out).not.toContain("18310");
    expect(out).not.toContain("18311");
  });
});

describe("rewriteMakefile", () => {
  const makefile = readFileSync(
    join(REPO_ROOT, "challenges/ac26-bridge-experiment/local/Makefile"),
    "utf8",
  );

  it("should point SERVICE at the new challenge", () => {
    const out = rewriteMakefile(makefile, { id: "ac26-w3-field-inverse" });
    expect(out).toContain("SERVICE ?= ac26-w3-field-inverse");
    expect(out).not.toContain("ac26-bridge-experiment");
  });
});
