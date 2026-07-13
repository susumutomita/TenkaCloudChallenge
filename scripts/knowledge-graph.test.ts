import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "bun:test";
import {
  type KnowledgeGraphCatalogEntry,
  validateKnowledgeGraphCatalog,
} from "./knowledge-graph";

type NodeCollection =
  | "learning_objectives"
  | "concepts"
  | "assessment_criteria"
  | "misconceptions"
  | "audiences";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(
  JSON.parse(readFileSync(join(import.meta.dir, "..", "SCHEMA.json"), "utf8")),
);

function validCatalogMetadata(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(import.meta.dir, "..", "challenges", "api-idor-demo", "metadata.json"), "utf8"),
  ) as Record<string, unknown>;
}

function node(id: string, description = id): { id: string; description: string } {
  return { id, description };
}

function entry(
  file: string,
  id: string,
  nodes: Partial<Record<NodeCollection, Array<ReturnType<typeof node>>>> = {},
  relations: Array<{ type: string; source: string; target: string }> = [],
): KnowledgeGraphCatalogEntry {
  return { file, metadata: { id, nodes, relations } };
}

describe("validateKnowledgeGraphCatalog", () => {
  it("should accept legacy metadata without graph fields", () => {
    expect(
      validateKnowledgeGraphCatalog([{ file: "challenges/legacy/metadata.json", metadata: { id: "legacy" } }]),
    ).toEqual([]);
  });

  it("should accept every MVP relation type and implicit problem nodes", () => {
    const catalog = [
      entry(
        "challenges/api-idor-demo/metadata.json",
        "api-idor-demo",
        {
          learning_objectives: [node("lo.api-idor-demo.detect-object-authorization-gap")],
          concepts: [node("concept.authorization"), node("concept.authentication")],
          assessment_criteria: [node("assessment.api-idor-demo.unauthorized-object-read")],
          misconceptions: [node("misconception.authenticated-means-authorized")],
          audiences: [node("audience.software-engineer")],
        },
        [
          {
            type: "teaches",
            source: "problem.api-idor-demo",
            target: "lo.api-idor-demo.detect-object-authorization-gap",
          },
          {
            type: "covers",
            source: "problem.api-idor-demo",
            target: "concept.authorization",
          },
          {
            type: "requires",
            source: "lo.api-idor-demo.detect-object-authorization-gap",
            target: "concept.authentication",
          },
          {
            type: "assesses",
            source: "problem.api-idor-demo",
            target: "assessment.api-idor-demo.unauthorized-object-read",
          },
          {
            type: "related_to",
            source: "problem.api-idor-demo",
            target: "problem.rls-tenant-isolation",
          },
        ],
      ),
      entry("challenges/rls-tenant-isolation/metadata.json", "rls-tenant-isolation"),
    ];

    expect(validateKnowledgeGraphCatalog(catalog)).toEqual([]);
  });

  it("should reject duplicate explicit node IDs across the catalog", () => {
    const catalog = [
      entry("challenges/one/metadata.json", "one", {
        concepts: [node("concept.authorization")],
      }),
      entry("challenges/two/metadata.json", "two", {
        concepts: [node("concept.authorization")],
      }),
    ];

    expect(validateKnowledgeGraphCatalog(catalog)).toContainEqual({
      file: "challenges/two/metadata.json",
      path: "nodes.concepts[0].id",
      message:
        'node id "concept.authorization" is duplicated; first declared at challenges/one/metadata.json:nodes.concepts[0].id',
    });
  });

  it("should reject learning objectives declared under another problem scope", () => {
    const diagnostics = validateKnowledgeGraphCatalog([
      entry("challenges/one/metadata.json", "one", {
        learning_objectives: [node("lo.two.learn")],
      }),
    ]);

    expect(diagnostics).toContainEqual({
      file: "challenges/one/metadata.json",
      path: "nodes.learning_objectives[0].id",
      message: 'learning_objective node id "lo.two.learn" must use problem scope "lo.one."',
    });
  });

  it("should reject assessment criteria declared under another problem scope", () => {
    const diagnostics = validateKnowledgeGraphCatalog([
      entry("challenges/one/metadata.json", "one", {
        assessment_criteria: [node("assessment.two.check")],
      }),
    ]);

    expect(diagnostics).toContainEqual({
      file: "challenges/one/metadata.json",
      path: "nodes.assessment_criteria[0].id",
      message:
        'assessment_criterion node id "assessment.two.check" must use problem scope "assessment.one."',
    });
  });

  it("should reject a relation with a missing source node", () => {
    const diagnostics = validateKnowledgeGraphCatalog([
      entry("challenges/one/metadata.json", "one", {}, [
        { type: "related_to", source: "problem.missing", target: "problem.one" },
      ]),
    ]);

    expect(diagnostics).toContainEqual({
      file: "challenges/one/metadata.json",
      path: "relations[0].source",
      message: 'source node "problem.missing" does not exist in this catalog',
    });
  });

  it("should reject a relation with a missing target node", () => {
    const diagnostics = validateKnowledgeGraphCatalog([
      entry("challenges/one/metadata.json", "one", {}, [
        { type: "related_to", source: "problem.one", target: "problem.missing" },
      ]),
    ]);

    expect(diagnostics).toContainEqual({
      file: "challenges/one/metadata.json",
      path: "relations[0].target",
      message: 'target node "problem.missing" does not exist in this catalog',
    });
  });

  it("should enforce the endpoint matrix for directed relation types", () => {
    const catalog = [
      entry(
        "challenges/one/metadata.json",
        "one",
        {
          learning_objectives: [node("lo.one.learn")],
          concepts: [node("concept.authorization")],
          assessment_criteria: [node("assessment.one.check")],
        },
        [
          { type: "teaches", source: "concept.authorization", target: "lo.one.learn" },
          { type: "covers", source: "problem.one", target: "lo.one.learn" },
          { type: "assesses", source: "problem.one", target: "concept.authorization" },
          { type: "requires", source: "assessment.one.check", target: "concept.authorization" },
        ],
      ),
    ];

    expect(validateKnowledgeGraphCatalog(catalog).map((diagnostic) => diagnostic.path)).toEqual([
      "relations[0]",
      "relations[1]",
      "relations[2]",
      "relations[3]",
    ]);
  });

  it("should reject a self-referential requires cycle", () => {
    const diagnostics = validateKnowledgeGraphCatalog([
      entry(
        "challenges/one/metadata.json",
        "one",
        { concepts: [node("concept.authorization")] },
        [
          {
            type: "requires",
            source: "concept.authorization",
            target: "concept.authorization",
          },
        ],
      ),
    ]);

    expect(diagnostics[0]?.message).toBe(
      "requires cycle detected: concept.authorization -> concept.authorization",
    );
  });

  it("should reject a two-node requires cycle across metadata files", () => {
    const catalog = [
      entry("challenges/one/metadata.json", "one", {}, [
        { type: "requires", source: "problem.one", target: "problem.two" },
      ]),
      entry("challenges/two/metadata.json", "two", {}, [
        { type: "requires", source: "problem.two", target: "problem.one" },
      ]),
    ];

    expect(validateKnowledgeGraphCatalog(catalog).map((diagnostic) => diagnostic.message)).toContain(
      "requires cycle detected: problem.one -> problem.two -> problem.one",
    );
  });

  it("should report a deterministic three-node requires cycle path", () => {
    const catalog = [
      entry("challenges/one/metadata.json", "one", {}, [
        { type: "requires", source: "problem.one", target: "problem.two" },
      ]),
      entry("challenges/two/metadata.json", "two", {}, [
        { type: "requires", source: "problem.two", target: "problem.three" },
      ]),
      entry("challenges/three/metadata.json", "three", {}, [
        { type: "requires", source: "problem.three", target: "problem.one" },
      ]),
    ];

    expect(validateKnowledgeGraphCatalog(catalog).map((diagnostic) => diagnostic.message)).toContain(
      "requires cycle detected: problem.one -> problem.two -> problem.three -> problem.one",
    );
  });

  it("should ignore cycles formed only by related_to relations", () => {
    const catalog = [
      entry("challenges/one/metadata.json", "one", {}, [
        { type: "related_to", source: "problem.one", target: "problem.two" },
      ]),
      entry("challenges/two/metadata.json", "two", {}, [
        { type: "related_to", source: "problem.two", target: "problem.one" },
      ]),
    ];

    expect(validateKnowledgeGraphCatalog(catalog)).toEqual([]);
  });
});

describe("knowledge graph JSON Schema", () => {
  const validNodes = {
    learning_objectives: [node("lo.api-idor-demo.detect-object-authorization-gap")],
    concepts: [node("concept.authorization")],
    assessment_criteria: [node("assessment.api-idor-demo.unauthorized-object-read")],
    misconceptions: [node("misconception.authenticated-means-authorized")],
    audiences: [node("audience.software-engineer")],
  };

  it("should accept graph fields alongside the existing flat tags", () => {
    const metadata = {
      ...validCatalogMetadata(),
      nodes: validNodes,
      relations: [
        {
          type: "teaches",
          source: "problem.api-idor-demo",
          target: "lo.api-idor-demo.detect-object-authorization-gap",
        },
      ],
    };

    expect(validateSchema(metadata), JSON.stringify(validateSchema.errors)).toBe(true);
    expect(metadata.tags).toEqual([
      "api-security",
      "idor",
      "bola",
      "owasp",
      "access-control",
      "local-play",
      "container",
    ]);
  });

  it("should reject node IDs outside their collection namespace", () => {
    const metadata = {
      ...validCatalogMetadata(),
      nodes: { concepts: [node("lo.api-idor-demo.not-a-concept")] },
    };

    expect(validateSchema(metadata)).toBe(false);
  });

  it("should reject relation types outside the five-type MVP", () => {
    const metadata = {
      ...validCatalogMetadata(),
      nodes: validNodes,
      relations: [
        {
          type: "prerequisite_of",
          source: "concept.authorization",
          target: "concept.authorization",
        },
      ],
    };

    expect(validateSchema(metadata)).toBe(false);
  });

  it("should reject relation endpoints outside the type-specific matrix", () => {
    const metadata = {
      ...validCatalogMetadata(),
      nodes: validNodes,
      relations: [
        {
          type: "teaches",
          source: "concept.authorization",
          target: "lo.api-idor-demo.detect-object-authorization-gap",
        },
      ],
    };

    expect(validateSchema(metadata)).toBe(false);
  });
});
