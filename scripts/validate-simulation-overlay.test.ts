import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { checkSimulationOverlay } from "./validate-simulation-overlay";

const temporaryDirectories: string[] = [];

function problemDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "tenkacloud-simulation-overlay-"));
  temporaryDirectories.push(directory);
  return directory;
}

function metadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "simulation-test",
    cfnTemplate: "template.yaml",
    simulationOverlay: { schemaVersion: "1", entry: "simulation.json" },
    ...overrides,
  };
}

function writeOverlay(directory: string, overlay: Record<string, unknown>): string {
  const metadataPath = join(directory, "metadata.json");
  writeFileSync(metadataPath, "{}\n");
  writeFileSync(join(directory, "simulation.json"), `${JSON.stringify(overlay, null, 2)}\n`);
  return metadataPath;
}

function requirement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    targetId: "default",
    service: "http",
    resourceType: "HTTP::Endpoint",
    operation: "Request",
    fidelity: "L4",
    plane: "participant",
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("simulation overlay validation", () => {
  it("single runtime の requirement と content-addressed artifact を受理する", () => {
    const directory = problemDirectory();
    mkdirSync(join(directory, "simulation"));
    const artifact = Buffer.from("export const behavior = 'request';\n");
    writeFileSync(join(directory, "simulation", "behavior.ts"), artifact);
    const metadataPath = writeOverlay(directory, {
      $schema: "../../SIMULATION_SCHEMA.json",
      schemaVersion: "1",
      requirements: [
        requirement({
          artifact: {
            path: "simulation/behavior.ts",
            sha256: createHash("sha256").update(artifact).digest("hex"),
          },
        }),
      ],
    });

    expect(checkSimulationOverlay(metadataPath, metadata())).toEqual([]);
  });

  it("composite runtime の normalized target id を受理し unknown target を拒否する", () => {
    const directory = problemDirectory();
    const metadataPath = writeOverlay(directory, {
      schemaVersion: "1",
      requirements: [requirement({ targetId: "gcp-edge" })],
    });
    const composite = metadata({
      runtime: {
        kind: "composite",
        targets: [
          { id: "aws-api", provider: "aws", engine: "cloudformation", entry: "template.yaml" },
          { id: "gcp-edge", provider: "gcp", engine: "terraform", entry: "gcp" },
        ],
      },
    });
    expect(checkSimulationOverlay(metadataPath, composite)).toEqual([]);

    writeOverlay(directory, {
      schemaVersion: "1",
      requirements: [requirement({ targetId: "missing" })],
    });
    expect(checkSimulationOverlay(metadataPath, composite).join("\n")).toMatch(
      /does not match a normalized runtime target/,
    );
  });

  it("metadata から参照されない conventional overlay を loud に拒否する", () => {
    const directory = problemDirectory();
    const metadataPath = writeOverlay(directory, {
      schemaVersion: "1",
      requirements: [requirement()],
    });

    expect(checkSimulationOverlay(metadataPath, { id: "simulation-test" }).join("\n")).toMatch(
      /exists but metadata\.simulationOverlay does not reference it/,
    );
  });

  it("scoring、secret、environment と digest 未固定 image を schema で拒否する", () => {
    const directory = problemDirectory();
    const metadataPath = writeOverlay(directory, {
      schemaVersion: "1",
      scoring: { points: 100 },
      secret: "must-not-exist",
      workloads: [
        {
          id: "api",
          targetId: "default",
          resourceRef: "Api",
          image: "oven/bun:1.3.11",
          containerPort: 3000,
          environment: { TOKEN: "must-not-exist" },
        },
      ],
    });

    const errors = checkSimulationOverlay(metadataPath, metadata()).join("\n");
    expect(errors).toMatch(/additional properties/);
    expect(errors).toMatch(/pattern/);
  });

  it("duplicate requirement identity と workload id を拒否する", () => {
    const directory = problemDirectory();
    const image = `oven/bun@sha256:${"a".repeat(64)}`;
    const metadataPath = writeOverlay(directory, {
      schemaVersion: "1",
      requirements: [requirement(), requirement({ fidelity: "L3" })],
      workloads: [
        {
          id: "api",
          targetId: "default",
          resourceRef: "ApiOne",
          image,
          containerPort: 3000,
        },
        {
          id: "api",
          targetId: "default",
          resourceRef: "ApiTwo",
          image,
          containerPort: 3001,
        },
      ],
    });

    const errors = checkSimulationOverlay(metadataPath, metadata()).join("\n");
    expect(errors).toMatch(/duplicates identity/);
    expect(errors).toMatch(/workloads\[1\]\.id="api" is duplicated/);
  });

  it("artifact の hash drift、path escape、symlink component を拒否する", () => {
    const directory = problemDirectory();
    mkdirSync(join(directory, "real"));
    writeFileSync(join(directory, "real", "behavior.ts"), "actual\n");
    symlinkSync(join(directory, "real"), join(directory, "linked"));
    let metadataPath = writeOverlay(directory, {
      schemaVersion: "1",
      requirements: [
        requirement({
          artifact: { path: "real/behavior.ts", sha256: "0".repeat(64) },
        }),
      ],
    });
    expect(checkSimulationOverlay(metadataPath, metadata()).join("\n")).toMatch(/sha256 is stale/);

    metadataPath = writeOverlay(directory, {
      schemaVersion: "1",
      requirements: [
        requirement({
          artifact: { path: "../outside.ts", sha256: "0".repeat(64) },
        }),
      ],
    });
    expect(checkSimulationOverlay(metadataPath, metadata()).join("\n")).toMatch(/schema.*pattern/);

    metadataPath = writeOverlay(directory, {
      schemaVersion: "1",
      requirements: [
        requirement({
          artifact: { path: "linked/behavior.ts", sha256: "0".repeat(64) },
        }),
      ],
    });
    expect(checkSimulationOverlay(metadataPath, metadata()).join("\n")).toMatch(/symbolic link/);
  });

  it("overlay entry symlink、version mismatch、container runtime を拒否する", () => {
    const directory = problemDirectory();
    const metadataPath = join(directory, "metadata.json");
    writeFileSync(metadataPath, "{}\n");
    writeFileSync(
      join(directory, "real.json"),
      `${JSON.stringify({ schemaVersion: "1", requirements: [requirement()] })}\n`,
    );
    symlinkSync(join(directory, "real.json"), join(directory, "simulation.json"));
    expect(checkSimulationOverlay(metadataPath, metadata()).join("\n")).toMatch(/symbolic link/);

    rmSync(join(directory, "simulation.json"));
    writeOverlay(directory, { schemaVersion: "1", requirements: [requirement()] });
    expect(
      checkSimulationOverlay(
        metadataPath,
        metadata({ simulationOverlay: { schemaVersion: "2", entry: "simulation.json" } }),
      ).join("\n"),
    ).toMatch(/does not match metadata reference/);

    expect(
      checkSimulationOverlay(
        metadataPath,
        metadata({ runtime: { provider: "docker", engine: "compose", entry: "compose.yml" } }),
      ).join("\n"),
    ).toMatch(/cloud runtimes only/);
  });

  it("workload command の null byte を拒否する", () => {
    const directory = problemDirectory();
    const metadataPath = writeOverlay(directory, {
      schemaVersion: "1",
      workloads: [
        {
          id: "api",
          targetId: "default",
          resourceRef: "Api",
          image: `oven/bun@sha256:${"a".repeat(64)}`,
          command: ["bun", "contains\0null"],
          containerPort: 3000,
        },
      ],
    });

    expect(checkSimulationOverlay(metadataPath, metadata()).join("\n")).toMatch(/null byte/);
  });

  it("oversized overlay を読み込む前に拒否する", () => {
    const directory = problemDirectory();
    const metadataPath = join(directory, "metadata.json");
    writeFileSync(metadataPath, "{}\n");
    writeFileSync(join(directory, "simulation.json"), Buffer.alloc(1024 * 1024 + 1, 0x20));

    expect(checkSimulationOverlay(metadataPath, metadata()).join("\n")).toMatch(
      /exceeds the 1048576-byte limit/,
    );
  });
});
