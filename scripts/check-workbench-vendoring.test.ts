import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  findVendoredCopies,
  formatReport,
  groupByDigest,
} from "./check-workbench-vendoring";

/**
 * vendoring gate の振る舞いを固定する。 実 repo に対する 「今は揃っている」 の確認は
 * gate 自身が CI で行うので、 ここでは合成した木で 揃っている / 割れている / 無い の
 * 3 状態を作って判定を pin する。
 */
let root: string;

function writeCopy(
  category: string,
  problem: string,
  contents: string,
  runtime = "verifier",
): void {
  const dir = join(root, category, problem, "local", runtime);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "workbench.py"), contents, "utf-8");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "workbench-vendoring-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("findVendoredCopies", () => {
  it("should collect a copy from every problem that vendors one", () => {
    writeCopy("challenges", "b-second", "same\n");
    writeCopy("challenges", "a-first", "same\n");
    writeCopy("battles", "a-battle", "same\n");

    expect(findVendoredCopies(root).map((c) => c.path)).toEqual([
      join("battles", "a-battle", "local", "verifier", "workbench.py"),
      join("challenges", "a-first", "local", "verifier", "workbench.py"),
      join("challenges", "b-second", "local", "verifier", "workbench.py"),
    ]);
  });

  it("should include a participant-only copy from a split Workbench image", () => {
    writeCopy("challenges", "split-boundary", "same\n", "participant");

    expect(findVendoredCopies(root).map((c) => c.path)).toEqual([
      join("challenges", "split-boundary", "local", "participant", "workbench.py"),
    ]);
  });

  it("should skip problems that vendor no workbench rather than failing", () => {
    mkdirSync(join(root, "challenges", "no-workbench", "local"), { recursive: true });
    writeCopy("challenges", "has-workbench", "same\n");

    expect(findVendoredCopies(root)).toHaveLength(1);
  });

  it("should tolerate a repo with no problem directories at all", () => {
    expect(findVendoredCopies(root)).toEqual([]);
  });
});

describe("groupByDigest", () => {
  it("should put identical copies in one group and differing copies in separate groups", () => {
    writeCopy("challenges", "a", "same\n");
    writeCopy("challenges", "b", "same\n");
    writeCopy("challenges", "c", "drifted\n");

    expect(groupByDigest(findVendoredCopies(root)).size).toBe(2);
  });
});

describe("formatReport", () => {
  it("should pass when every copy is byte-identical", () => {
    writeCopy("challenges", "a", "same\n");
    writeCopy("challenges", "b", "same\n");

    const report = formatReport(findVendoredCopies(root));

    expect(report.ok).toBe(true);
    expect(report.lines.join("\n")).toContain("2 複製はすべて同一");
  });

  it("should pass when no problem vendors a workbench", () => {
    expect(formatReport([]).ok).toBe(true);
  });

  it("should fail and name every drifted copy so the author knows what to re-vendor", () => {
    writeCopy("challenges", "majority-a", "same\n");
    writeCopy("challenges", "majority-b", "same\n");
    writeCopy("challenges", "drifted", "drifted\n");

    const report = formatReport(findVendoredCopies(root));
    const text = report.lines.join("\n");

    expect(report.ok).toBe(false);
    expect(text).toContain("2 群に割れています");
    expect(text).toContain(join("challenges", "drifted", "local", "verifier", "workbench.py"));
    expect(text).toContain(join("challenges", "majority-a", "local", "verifier", "workbench.py"));
  });

  // 多数決で「正しい版」を決めない。 どちらが正しいかは人にしか分からないので、 群を並べて
  // 選ばせる。 ここでは少数派が消えないことだけを固定する。
  it("should list the minority group instead of silently treating the majority as correct", () => {
    writeCopy("challenges", "a", "same\n");
    writeCopy("challenges", "b", "same\n");
    writeCopy("challenges", "c", "same\n");
    writeCopy("challenges", "lonely", "different\n");

    const text = formatReport(findVendoredCopies(root)).lines.join("\n");

    expect(text).toContain(join("challenges", "lonely", "local", "verifier", "workbench.py"));
  });
});
