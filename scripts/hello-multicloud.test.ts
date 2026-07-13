import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "challenges", "hello-multicloud");
const PINNED_OCI_IMAGE =
  /^(?:gcr\.io|ghcr\.io|docker\.io|index\.docker\.io|registry\.sakura\.ad\.jp)\/[A-Za-z0-9._/-]+@sha256:[a-f0-9]{64}$/;

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function metadata() {
  return JSON.parse(read("metadata.json")) as {
    runtime: { targets: Array<Record<string, string>> };
    scoring: { targets: Array<Record<string, unknown>> };
    simulationOverlay?: { schemaVersion?: string; entry?: string };
    instructions: string;
    i18n: { en: { instructions: string } };
  };
}

describe("hello-multicloud four-provider contract", () => {
  it("should declare one native target and one scoring probe for every provider", () => {
    const value = metadata();
    expect(value.runtime.targets).toEqual([
      {
        id: "aws-hello",
        provider: "aws",
        engine: "cloudformation",
        entry: "template.yaml",
      },
      {
        id: "gcp-hello",
        provider: "gcp",
        engine: "infra-manager",
        entry: "gcp/terraform",
      },
      {
        id: "azure-hello",
        provider: "azure",
        engine: "bicep",
        entry: "azure/main.bicep",
      },
      {
        id: "sakura-hello",
        provider: "sakura",
        engine: "apprun",
        entry: "sakura/application.json",
      },
    ]);
    expect(value.scoring.targets).toEqual([
      {
        targetId: "aws-hello",
        probe: "https",
        outputKey: "AwsHelloUrl",
        expectStatus: [200],
      },
      {
        targetId: "gcp-hello",
        probe: "https",
        outputKey: "GcpHelloUrl",
        expectStatus: [200],
      },
      {
        targetId: "azure-hello",
        probe: "https",
        outputKey: "AzureHelloUrl",
        path: "/healthz",
        expectStatus: [200],
      },
      {
        targetId: "sakura-hello",
        probe: "https",
        outputKey: "BaseUrl",
        path: "/healthz",
        expectStatus: [200],
      },
    ]);
  });

  it("should pin every container image and bound scale and resources", () => {
    const gcpImage = /image\s*=\s*"([^"]+)"/.exec(read("gcp/terraform/main.tf"))?.[1];
    const azureImage = /image:\s*'([^']+)'/.exec(read("azure/main.bicep"))?.[1];
    const sakura = JSON.parse(read("sakura/application.json")) as {
      components: Array<{ deploy_source: { container_registry: { image: string } } }>;
    };
    const sakuraImage = sakura.components[0]?.deploy_source.container_registry.image;

    expect(gcpImage).toMatch(PINNED_OCI_IMAGE);
    expect(azureImage).toMatch(PINNED_OCI_IMAGE);
    expect(sakuraImage).toMatch(PINNED_OCI_IMAGE);
    expect(read("gcp/terraform/main.tf")).toContain("max_instance_count = 1");
    expect(read("azure/main.bicep")).toContain("maxReplicas: 1");
    expect(read("azure/main.bicep")).toContain("cpu: json('0.5')");
    expect(read("azure/main.bicep")).toContain("memory: '1Gi'");
    expect(sakura).toMatchObject({ min_scale: 0, max_scale: 1 });
  });

  it("should grant both public Lambda Function URL permission contracts", () => {
    const template = read("template.yaml");
    expect(template.match(/Type: AWS::Lambda::Permission/g)).toHaveLength(2);
    expect(template).toContain("Action: lambda:InvokeFunctionUrl");
    expect(template).toContain("Action: lambda:InvokeFunction");
    expect(template).toContain("InvokedViaFunctionUrl: true");
    expect(template.match(/FunctionUrlAuthType: NONE/g)).toHaveLength(2);
  });

  it("should keep the overlay limited to Sakura HTTP behavior and workload binding", () => {
    const value = metadata();
    expect(value.simulationOverlay).toEqual({ schemaVersion: "1", entry: "simulation.json" });
    const overlay = JSON.parse(read("simulation.json")) as Record<string, unknown> & {
      requirements: Array<Record<string, unknown>>;
      workloads: Array<Record<string, unknown>>;
    };
    expect(Object.keys(overlay).sort()).toEqual([
      "$schema",
      "requirements",
      "schemaVersion",
      "workloads",
    ]);
    expect(overlay.requirements).toEqual([
      {
        targetId: "sakura-hello",
        service: "http",
        resourceType: "HTTP::Endpoint",
        operation: "Request",
        fidelity: "L4",
        plane: "workload",
      },
      {
        targetId: "sakura-hello",
        service: "http",
        resourceType: "HTTP::Endpoint",
        operation: "Probe",
        fidelity: "L4",
        plane: "scoring",
      },
    ]);
    expect(overlay.workloads).toHaveLength(1);
    expect(overlay.workloads[0]).toMatchObject({
      id: "sakura-hello",
      targetId: "sakura-hello",
      resourceRef: "BaseUrl",
      containerPort: 8080,
      healthPath: "/healthz",
    });
    expect(overlay.workloads[0]?.image).toMatch(PINNED_OCI_IMAGE);
  });

  it("should describe the real root and health-check paths in both languages", () => {
    const value = metadata();
    for (const text of [
      value.instructions,
      value.i18n.en.instructions,
      read("README.md"),
      read("README.ja.md"),
    ]) {
      expect(text).toContain("/healthz");
      expect(text).toContain("aws-hello");
      expect(text).toContain("gcp-hello");
      expect(text).toContain("azure-hello");
      expect(text).toContain("sakura-hello");
    }
  });
});
