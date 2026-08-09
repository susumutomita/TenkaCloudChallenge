import { describe, expect, it } from "bun:test";
import { findPinnedPorts, participantProse, publishedPorts, scanAll } from "./check-local-play-urls";

/**
 * 検出器そのものの test (Issue 399)。
 *
 * 実際に起きた壊れ方を fixture として持つ。`stackstack-onboarding` を起動したまま
 * `wix-exposure-audit` を起動すると後者は 19080 へ再割り当てされ、18080 を焼き込んだ問題文と
 * sitemap は**別の問題**を指した。検出器が空配列を返すだけになっていないこと、そして
 * 正しい書き方を誤検出しないことの両方を固定する。
 */

describe("publishedPorts", () => {
  it("should read the host side of a loopback-bound mapping", () => {
    expect(publishedPorts(`    ports:\n      - "127.0.0.1:18080:80"\n`)).toEqual([18080]);
  });

  it("should read the default out of a ${VAR:-port} host side", () => {
    // rls-tenant-isolation はこの形。既定値を読まないとこの問題だけ検査対象が空になる。
    expect(publishedPorts(`      - "127.0.0.1:\${RLS_APP_PORT:-18080}:8080"\n`)).toEqual([18080]);
  });

  it("should read a mapping with no bind address", () => {
    expect(publishedPorts(`      - "18080:80"\n`)).toEqual([18080]);
  });

  it("should ignore a trailing comment", () => {
    expect(publishedPorts(`      - "127.0.0.1:18100:8080" # workshop\n`)).toEqual([18100]);
  });

  it("should not treat a container-internal port as published", () => {
    // healthcheck の `127.0.0.1:8080` は publish されていないので、この規則で自動的に外れる。
    const compose = `    healthcheck:\n      test: ["CMD", "curl", "http://127.0.0.1:8080/healthz"]\n`;
    expect(publishedPorts(compose)).toEqual([]);
  });
});

describe("findPinnedPorts", () => {
  it("should catch the sitemap that sent players to another problem", () => {
    const source = `<url><loc>http://127.0.0.1:18080/preview/client-review</loc></url>`;
    expect(findPinnedPorts(source, [18080])).toMatchObject([{ line: 1, port: 18080 }]);
  });

  it("should catch the localhost spelling too", () => {
    expect(findPinnedPorts(`open http://localhost:18080/robots.txt`, [18080])).toHaveLength(1);
  });

  it("should ignore a port this problem does not publish", () => {
    // 別問題の既定ポートや、外部サービスの例示まで拾うと赤が意味を失う。
    expect(findPinnedPorts(`postgres://user@127.0.0.1:5432/db`, [18080])).toEqual([]);
  });

  it("should accept the fixed form that derives the base from the request", () => {
    expect(findPinnedPorts('`${siteBase(request)}/sitemap.xml`', [18080])).toEqual([]);
  });

  it("should report the line the pin actually sits on", () => {
    expect(findPinnedPorts(`a\nb\nhttp://127.0.0.1:18080/x`, [18080])[0]?.line).toBe(3);
  });
});

describe("participantProse", () => {
  it("should include instructions and hints", () => {
    const prose = participantProse({
      instructions: "open A",
      scoring: { hints: [{ content: "open B" }] },
      i18n: { en: { instructions: "open C" } },
    });
    expect(prose).toContain("open A");
    expect(prose).toContain("open B");
    expect(prose).toContain("open C");
  });

  it("should exclude runtime declarations, which the platform rewrites", () => {
    // runtime.verifyUrl / challengeEndpoints は既定ポートを書くのが正しい。ここを検査すると
    // 正しい宣言を violation と教えることになる。
    const prose = participantProse({
      instructions: "open the access URL",
      runtime: { verifyUrl: "http://127.0.0.1:18081/verify" },
    });
    expect(prose).not.toContain("18081");
  });
});

describe("the catalog", () => {
  it("should pin no reassignable port in any participant-facing surface", () => {
    expect(scanAll()).toEqual([]);
  });
});
