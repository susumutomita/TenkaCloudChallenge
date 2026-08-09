import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "bun:test";
import {
  classify,
  inspect,
  isActionable,
  report,
  requestedBlobKeys,
  resetBlobShaCache,
} from "./check-course-drift";
import type { DriftRow } from "./check-course-drift";

/**
 * [#214] drift 分類の契約テスト。
 *
 * 一番効かせたいのは `material-published`: 未公開週 (Week 2 / Week 4) の README を
 * `kind="placeholder"` で pin しておき、 それが動いたら「編集」ではなく「教材が公開された」
 * として別扱いにする。 これを普通の drifted に混ぜると、 講座が進んで教材が出たことに
 * 誰も気づかないまま companion challenge が古い前提のまま残る。
 *
 * network を叩く部分 (blobShaAt / defaultBranch) は分類の外に出してあるので、
 * ここでは blob sha の組み合わせだけで全分岐を固定できる。
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const SCHEMA = JSON.parse(readFileSync(join(REPO_ROOT, "SCHEMA.json"), "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateMetadata = ajv.compile(SCHEMA);

const PINNED = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const MOVED = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("classify", () => {
  it("should report in-sync when the pinned and upstream blobs match", () => {
    expect(classify("lecture", PINNED, PINNED)).toEqual({ status: "in-sync" });
  });

  it("should report drifted when a published source's content moved", () => {
    expect(classify("lecture", PINNED, MOVED)).toEqual({ status: "drifted" });
  });

  it("should report material-published when a placeholder pin's content moved", () => {
    expect(classify("placeholder", PINNED, MOVED)).toEqual({
      status: "material-published",
      detail:
        "the pin recorded this path as not-yet-published; upstream has now replaced its content",
    });
  });

  it("should keep a placeholder pin in-sync while the material is still unpublished", () => {
    expect(classify("placeholder", PINNED, PINNED)).toEqual({ status: "in-sync" });
  });

  it("should report missing-upstream when the path disappeared, placeholder or not", () => {
    for (const kind of ["lecture", "placeholder"]) {
      expect(classify(kind, PINNED, undefined)).toEqual({
        status: "missing-upstream",
        detail: "path was removed or renamed upstream",
      });
    }
  });

  it("should report unreachable when the pinned commit no longer serves the path", () => {
    expect(classify("lecture", undefined, PINNED)).toEqual({
      status: "unreachable",
      detail: "pinned commit no longer serves this path",
    });
  });

  it("should prefer unreachable over missing-upstream when neither side resolves", () => {
    // pin が解決できないなら upstream の有無を語る資格がない。
    expect(classify("lecture", undefined, undefined).status).toBe("unreachable");
  });
});

describe("report", () => {
  function row(overrides: Partial<DriftRow>): DriftRow {
    return {
      problemId: "ac26-w2-secret-sharing",
      repository: "zk-tokyo/advanced-cryptography-2026",
      path: "week2/README.md",
      pinnedRef: PINNED,
      status: "in-sync",
      ...overrides,
    } as DriftRow;
  }

  function captureReport(rows: DriftRow[]): string {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      report(rows);
    } finally {
      console.log = original;
    }
    return lines.join("\n");
  }

  it("should surface a publication event with its own marker, not as generic drift", () => {
    const out = captureReport([row({ status: "material-published", upstreamRef: MOVED })]);
    expect(out).toContain("PUBLISHED");
    expect(out).toContain("ac26-w2-secret-sharing");
    expect(out).not.toContain("DRIFT ");
  });

  it("should tell the reader that a publication needs a re-read, not a re-pin", () => {
    const out = captureReport([row({ status: "material-published", upstreamRef: MOVED })]);
    expect(out).toContain("SYNC.md");
  });

  it("should count every status in the summary line", () => {
    const out = captureReport([
      row({ status: "in-sync" }),
      row({ status: "drifted", upstreamRef: MOVED }),
      row({ status: "material-published", upstreamRef: MOVED }),
      row({ status: "missing-upstream", detail: "gone" }),
      row({ status: "unreachable", detail: "boom" }),
    ]);
    expect(out).toContain("1 in sync");
    expect(out).toContain("1 drifted");
    expect(out).toContain("1 newly published");
    expect(out).toContain("1 removed upstream");
    expect(out).toContain("1 unreachable");
  });

  it("should stay quiet about next steps when everything is in sync", () => {
    const out = captureReport([row({ status: "in-sync" })]);
    expect(out).not.toContain("Do not auto-update");
    expect(out).not.toContain("SYNC.md");
  });
});

describe("isActionable", () => {
  function rows(...statuses: DriftRow["status"][]): DriftRow[] {
    return statuses.map((status) => ({
      problemId: "ac26-w2-secret-sharing",
      repository: "zk-tokyo/advanced-cryptography-2026",
      path: "week2/README.md",
      pinnedRef: PINNED,
      status,
    }));
  }

  it("should fail the check when a week's material was published", () => {
    // これが false だと scheduled run が緑のまま教材公開を見落とす。
    expect(isActionable(rows("material-published"))).toBe(true);
  });

  it("should fail the check on drift and on removal", () => {
    expect(isActionable(rows("drifted"))).toBe(true);
    expect(isActionable(rows("missing-upstream"))).toBe(true);
  });

  it("should not fail the check when the answer is merely unknown", () => {
    // rate limit / network 断で赤にすると「再実行して緑にする」癖がつく。
    expect(isActionable(rows("unreachable"))).toBe(false);
  });

  it("should not fail the check when every pin is in sync", () => {
    expect(isActionable(rows("in-sync", "in-sync"))).toBe(false);
  });
});

describe("SCHEMA.json source kinds", () => {
  const base = JSON.parse(
    readFileSync(join(REPO_ROOT, "challenges/hello-world/metadata.json"), "utf8"),
  );

  function withKind(kind: string): Record<string, unknown> {
    return {
      ...structuredClone(base),
      courseAlignment: {
        courseId: "advanced-cryptography-program",
        edition: "2026",
        week: 2,
        role: "mechanism",
        spoilerPolicy: "independent-reimplementation",
        sources: [
          {
            repository: "zk-tokyo/advanced-cryptography-2026",
            ref: "5e80999306608a45aecf9a0e4e3394a0b62f34d2",
            path: "week2/README.md",
            kind,
          },
        ],
      },
    };
  }

  it("should accept placeholder as a source kind", () => {
    expect(validateMetadata(withKind("placeholder"))).toBe(true);
  });

  it("should still reject an unknown source kind", () => {
    expect(validateMetadata(withKind("guess"))).toBe(false);
  });
});

describe("blob request deduplication", () => {
  /**
   * The catalog pins the same upstream path from several problems, and each `inspect`
   * asks for two refs. Before the cache, one run made 94 requests for 24 answers and
   * spent the unauthenticated 60-an-hour budget partway through — which surfaced as a
   * different set of `unreachable` rows on every run of the same commit.
   *
   * `fetch` is replaced rather than reached over the network: the property is "how many
   * distinct requests does a run make", which a live call cannot pin.
   */
  it("should request each (repository, ref, path) triple once, however many problems pin it", async () => {
    resetBlobShaCache();
    const requested: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      requested.push(String(input));
      return new Response(JSON.stringify({ sha: PINNED }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const source = {
        problemId: "p",
        repository: "owner/repo",
        ref: PINNED,
        path: "week3/README.md",
        kind: "lecture",
      } as const;
      // Three problems pinning the same path, inspected concurrently against the same
      // default branch: 6 logical lookups over 2 distinct triples.
      await Promise.all([
        inspect({ ...source, problemId: "a" }, "main"),
        inspect({ ...source, problemId: "b" }, "main"),
        inspect({ ...source, problemId: "c" }, "main"),
      ]);
      expect(requested).toHaveLength(2);
      expect(requestedBlobKeys().toSorted()).toEqual([
        `owner/repo@${PINNED}:week3/README.md`,
        "owner/repo@main:week3/README.md",
      ]);
    } finally {
      globalThis.fetch = realFetch;
      resetBlobShaCache();
    }
  });

  it("should not cache a failure, so one transient error is not replayed as the answer", async () => {
    resetBlobShaCache();
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return calls === 1
        ? new Response("rate limited", { status: 403 })
        : new Response(JSON.stringify({ sha: PINNED }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    }) as typeof fetch;

    try {
      const source = {
        problemId: "p",
        repository: "owner/repo",
        ref: PINNED,
        path: "week3/README.md",
        kind: "lecture",
      } as const;
      const first = await inspect(source, PINNED);
      expect(first.status).toBe("unreachable");
      const second = await inspect(source, PINNED);
      expect(second.status).toBe("in-sync");
    } finally {
      globalThis.fetch = realFetch;
      resetBlobShaCache();
    }
  });
});
