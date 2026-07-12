import { describe, expect, it } from "bun:test";
import { parseCompatibilityArguments } from "./check-simulator-compatibility";

describe("Simulator compatibility CLI argument", () => {
  it("pinned Simulator checkout と report path を受け取る", () => {
    const parsed = parseCompatibilityArguments([
      "--simulator",
      "../TenkaCloudSimulator",
      "--output",
      "reports/simulator-coverage.json",
    ]);
    expect(parsed).not.toBe("help");
    if (parsed === "help") return;
    expect(parsed.simulator).toEndWith("TenkaCloudSimulator");
    expect(parsed.output).toEndWith("reports/simulator-coverage.json");
  });

  it("help だけを副作用なしで処理する", () => {
    expect(parseCompatibilityArguments(["--help"])).toBe("help");
  });

  it("missing、unknown、duplicate option を拒否する", () => {
    expect(() => parseCompatibilityArguments([])).toThrow(/Usage/);
    expect(() => parseCompatibilityArguments(["--unknown", "value"])).toThrow(/Usage/);
    expect(() =>
      parseCompatibilityArguments([
        "--simulator",
        "one",
        "--simulator",
        "two",
        "--output",
        "report.json",
      ]),
    ).toThrow(/Usage/);
  });
});
