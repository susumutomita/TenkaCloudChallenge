import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  checkCheckLabelSpoilerAdvisory,
  checkContainerWriteupAdvisory,
  checkCompositeAppRunDescriptor,
  checkMultiVerifyStructure,
  checkMultiVerifyTranslations,
  checkParticipantVisibleSpoilerAdvisory,
  checkRequiredReadmes,
  checkScoringRegulation,
  checkWriteupTranslations,
} from "./validate-problems";

const temporaryDirectories: string[] = [];

function problemDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "tenkacloud-readmes-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("composite Sakura AppRun descriptor", () => {
  it("should require every component image to use a supported immutable digest", () => {
    const directory = problemDirectory();
    const descriptor = join(directory, "application.json");
    const application = (image: string) => ({
      name: "hello",
      timeout_seconds: 60,
      port: 8080,
      min_scale: 0,
      max_scale: 1,
      components: [
        {
          name: "hello",
          max_cpu: "0.5",
          max_memory: "1Gi",
          deploy_source: { container_registry: { image } },
        },
      ],
    });
    writeFileSync(
      descriptor,
      `${JSON.stringify(application(`ghcr.io/example/hello@sha256:${"a".repeat(64)}`))}\n`,
    );
    expect(checkCompositeAppRunDescriptor(directory, "sakura-hello", "application.json")).toEqual(
      [],
    );

    writeFileSync(descriptor, `${JSON.stringify(application("ghcr.io/example/hello:latest"))}\n`);
    expect(
      checkCompositeAppRunDescriptor(directory, "sakura-hello", "application.json").join("\n"),
    ).toMatch(/digest-pinned/);

    writeFileSync(descriptor, "{\n");
    expect(
      checkCompositeAppRunDescriptor(directory, "sakura-hello", "application.json").join("\n"),
    ).toMatch(/valid JSON/);
  });
});

describe("checkRequiredReadmes", () => {
  it("should accept non-empty English and Japanese README files", () => {
    const directory = problemDirectory();
    writeFileSync(join(directory, "README.md"), "# English\n");
    writeFileSync(join(directory, "README.ja.md"), "# 日本語\n");

    expect(checkRequiredReadmes(directory)).toEqual([]);
  });

  it("should reject a missing English README", () => {
    const directory = problemDirectory();
    writeFileSync(join(directory, "README.ja.md"), "# 日本語\n");

    expect(checkRequiredReadmes(directory)).toContainEqual(expect.stringContaining("README.md"));
  });

  it("should reject a missing Japanese README", () => {
    const directory = problemDirectory();
    writeFileSync(join(directory, "README.md"), "# English\n");

    expect(checkRequiredReadmes(directory)).toContainEqual(
      expect.stringContaining("README.ja.md"),
    );
  });

  it("should reject empty and directory placeholders", () => {
    const directory = problemDirectory();
    writeFileSync(join(directory, "README.md"), " \n");
    mkdirSync(join(directory, "README.ja.md"));

    const errors = checkRequiredReadmes(directory);
    expect(errors).toContainEqual(expect.stringContaining("README.md must not be empty"));
    expect(errors).toContainEqual(
      expect.stringContaining("README.ja.md must be a regular file and not a symlink"),
    );
  });

  it("should reject a symbolic link in place of a required README", () => {
    const directory = problemDirectory();
    writeFileSync(join(directory, "source.md"), "# Shared\n");
    symlinkSync(join(directory, "source.md"), join(directory, "README.md"));
    writeFileSync(join(directory, "README.ja.md"), "# 日本語\n");

    expect(checkRequiredReadmes(directory)).toContainEqual(
      expect.stringContaining("README.md must be a regular file and not a symlink"),
    );
  });

  it("should reject case-mismatched filenames", () => {
    const directory = problemDirectory();
    writeFileSync(join(directory, "readme.md"), "# English\n");
    writeFileSync(join(directory, "README.JA.md"), "# 日本語\n");

    const errors = checkRequiredReadmes(directory);
    expect(errors).toContainEqual(expect.stringContaining("README.md is required with this exact case"));
    expect(errors).toContainEqual(
      expect.stringContaining("README.ja.md is required with this exact case"),
    );
  });

  it("should reject a broken symbolic link", () => {
    const directory = problemDirectory();
    symlinkSync(join(directory, "missing.md"), join(directory, "README.md"));
    writeFileSync(join(directory, "README.ja.md"), "# 日本語\n");

    expect(checkRequiredReadmes(directory)).toContainEqual(
      expect.stringContaining("README.md must be a regular file and not a symlink"),
    );
  });

  it("should reject invalid UTF-8", () => {
    const directory = problemDirectory();
    writeFileSync(join(directory, "README.md"), Uint8Array.from([0xc3, 0x28]));
    writeFileSync(join(directory, "README.ja.md"), "# 日本語\n");

    expect(checkRequiredReadmes(directory)).toContainEqual(
      expect.stringContaining("README.md must be valid UTF-8 text"),
    );
  });

  it("should reject an unreadable regular file", () => {
    // chmod cannot deny reads to root, and Windows does not reliably apply POSIX read bits.
    if (process.getuid?.() === 0 || process.platform === "win32") return;
    const directory = problemDirectory();
    const readme = join(directory, "README.md");
    writeFileSync(readme, "# English\n");
    chmodSync(readme, 0o000);
    writeFileSync(join(directory, "README.ja.md"), "# 日本語\n");

    expect(checkRequiredReadmes(directory)).toContainEqual(
      expect.stringContaining("README.md cannot be read"),
    );
  });
});

describe("checkWriteupTranslations (#2191)", () => {
  it("accepts no writeup or a complete ja/en pair", () => {
    expect(checkWriteupTranslations({})).toEqual([]);
    expect(
      checkWriteupTranslations({
        writeup: "脆弱性と対策",
        i18n: { en: { writeup: "Vulnerability and remediation" } },
      }),
    ).toEqual([]);
  });

  it("rejects a writeup present in only one language", () => {
    expect(checkWriteupTranslations({ writeup: "日本語のみ" }).join()).toMatch(
      /i18n\.en\.writeup/,
    );
    expect(
      checkWriteupTranslations({ i18n: { en: { writeup: "English only" } } }).join(),
    ).toMatch(/top-level writeup/);
  });
});

describe("checkContainerWriteupAdvisory (#2393)", () => {
  it("warns when a local-play problem ships without any writeup", () => {
    const warnings = checkContainerWriteupAdvisory({});
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/writeup/);
  });

  it("stays silent once a writeup exists in either language", () => {
    expect(checkContainerWriteupAdvisory({ writeup: "解説" })).toEqual([]);
    expect(
      checkContainerWriteupAdvisory({ i18n: { en: { writeup: "Explanation" } } }),
    ).toEqual([]);
  });

  it("treats a blank writeup as missing (whitespace is not a writeup)", () => {
    expect(checkContainerWriteupAdvisory({ writeup: "   " })).toHaveLength(1);
  });
});

describe("checkScoringRegulation", () => {
  const challenge = (difficulty: number, scoring: Record<string, unknown>) => ({
    category: "Challenge",
    difficulty,
    scoring,
  });

  it("accepts a conforming Easy verify problem (100 / waP 5 / hints sum 50)", () => {
    const meta = challenge(2, {
      kind: "verify",
      points: 100,
      wrongAnswerPenalty: 5,
      hints: [{ penalty: 20 }, { penalty: 30 }],
    });
    expect(checkScoringRegulation(meta)).toEqual([]);
  });

  it("accepts a conforming Medium flag problem (200 / waP 10 / hints sum 100)", () => {
    const meta = challenge(3, {
      kind: "flag",
      points: 200,
      wrongAnswerPenalty: 10,
      hints: [{ penalty: 20 }, { penalty: 30 }, { penalty: 50 }],
    });
    expect(checkScoringRegulation(meta)).toEqual([]);
  });

  it("rejects points that do not match the difficulty tier", () => {
    const meta = challenge(1, { kind: "flag", points: 150, wrongAnswerPenalty: 5, hints: [] });
    expect(checkScoringRegulation(meta)).toContainEqual(
      expect.stringContaining("Easy tier standard 100"),
    );
  });

  it("rejects a wrongAnswerPenalty that is not 5% of the base", () => {
    const meta = challenge(2, {
      kind: "verify",
      points: 100,
      wrongAnswerPenalty: 10,
      hints: [{ penalty: 20 }, { penalty: 30 }],
    });
    expect(checkScoringRegulation(meta)).toContainEqual(
      expect.stringContaining("wrongAnswerPenalty"),
    );
  });

  it("rejects hint penalties summing to more than 50% of the base", () => {
    const meta = challenge(2, {
      kind: "verify",
      points: 100,
      wrongAnswerPenalty: 5,
      hints: [{ penalty: 30 }, { penalty: 40 }],
    });
    expect(checkScoringRegulation(meta)).toContainEqual(
      expect.stringContaining("exceeds 50% of points"),
    );
  });

  it("sums points and hint penalties across multi-flag checkpoints", () => {
    const ok = challenge(3, {
      kind: "multi-flag",
      flags: [
        { points: 100, hints: [{ penalty: 20 }, { penalty: 30 }] },
        { points: 100, hints: [{ penalty: 50 }] },
      ],
    });
    expect(checkScoringRegulation(ok)).toEqual([]);

    const overCap = challenge(3, {
      kind: "multi-flag",
      flags: [
        { points: 100, hints: [{ penalty: 40 }, { penalty: 40 }] },
        { points: 100, hints: [{ penalty: 40 }] },
      ],
    });
    expect(checkScoringRegulation(overCap)).toContainEqual(
      expect.stringContaining("exceeds 50% of points"),
    );
  });

  it("skips Battles (no fixed total)", () => {
    const battle = { category: "Battle", difficulty: 4, scoring: { kind: "phased-polling" } };
    expect(checkScoringRegulation(battle)).toEqual([]);
  });

  it("skips Challenges with no determinable point total (e.g. composite-probe)", () => {
    const meta = challenge(1, { kind: "composite-probe" });
    expect(checkScoringRegulation(meta)).toEqual([]);
  });
});

describe("multi-verify (TenkaCloud#2252)", () => {
  const check = (over: Record<string, unknown> = {}) => ({
    id: "public-backup",
    label: "公開バックアップ",
    points: 100,
    ...over,
  });
  const enCheck = (over: Record<string, unknown> = {}) => ({
    id: "public-backup",
    label: "Public backup",
    ...over,
  });
  const meta = (checks: unknown[], enChecks?: unknown[]) =>
    ({
      category: "Challenge",
      difficulty: 3,
      scoring: { kind: "multi-verify", checks },
      ...(enChecks ? { i18n: { en: { checks: enChecks } } } : {}),
    }) as never;

  it("checkMultiVerifyStructure: 正常な checks は通す", () => {
    expect(
      checkMultiVerifyStructure(
        meta([check(), check({ id: "weak-admin-pw", label: "弱い管理者パスワード" })]),
      ),
    ).toEqual([]);
  });

  it("checkMultiVerifyStructure: 空 checks / 重複 id / 不正 id / 非正整数 points を止める", () => {
    expect(checkMultiVerifyStructure(meta([]))[0]).toMatch(/2–8 entries/);
    expect(checkMultiVerifyStructure(meta([check(), check()])).join()).toMatch(/duplicated/);
    expect(checkMultiVerifyStructure(meta([check({ id: "Bad_ID" }), check({ id: "b" })])).join()).toMatch(
      /must match/,
    );
    expect(
      checkMultiVerifyStructure(meta([check({ points: 12.5 }), check({ id: "b" })])).join(),
    ).toMatch(/positive integer/);
  });

  it("checkMultiVerifyStructure: 2〜8 件の範囲を強制する (1 件 / 9 件を止める)", () => {
    expect(checkMultiVerifyStructure(meta([check()])).join()).toMatch(/2–8 entries/);
    const nine = Array.from({ length: 9 }, (_, i) => check({ id: `c${i}`, label: `第${i}` }));
    expect(checkMultiVerifyStructure(meta(nine)).join()).toMatch(/2–8 entries/);
  });

  it("checkMultiVerifyStructure: id 先頭ハイフン / 64 文字超 / label 80 文字超を止める", () => {
    expect(
      checkMultiVerifyStructure(meta([check({ id: "-lead" }), check({ id: "ok" })])).join(),
    ).toMatch(/must match/);
    expect(
      checkMultiVerifyStructure(
        meta([check({ id: "a".repeat(65) }), check({ id: "ok" })]),
      ).join(),
    ).toMatch(/must match/);
    expect(
      checkMultiVerifyStructure(
        meta([check({ label: "あ".repeat(81) }), check({ id: "b" })]),
      ).join(),
    ).toMatch(/80 characters or fewer/);
  });

  it("checkMultiVerifyStructure: wrongAnswerPenalty > points を止める", () => {
    expect(
      checkMultiVerifyStructure(
        meta([check({ points: 100, wrongAnswerPenalty: 150 }), check({ id: "b" })]),
      ).join(),
    ).toMatch(/must not exceed the check points/);
  });

  it("checkMultiVerifyStructure: 1 check 内の hint 減点合計が check の 50% 超を止める", () => {
    expect(
      checkMultiVerifyStructure(
        meta([
          check({ points: 100, hints: [{ id: "h1", content: "a", penalty: 60 }] }),
          check({ id: "b" }),
        ]),
      ).join(),
    ).toMatch(/exceed 50% of the check points/);
    // 50% ちょうどは通す (points 100, penalty 50)
    expect(
      checkMultiVerifyStructure(
        meta([
          check({ points: 100, hints: [{ id: "h1", content: "a", penalty: 50 }] }),
          check({ id: "b" }),
        ]),
      ),
    ).toEqual([]);
  });

  it("checkMultiVerifyStructure: hint id の check 跨ぎ衝突を止める (reveal route は hintId 単独キー)", () => {
    const errors = checkMultiVerifyStructure(
      meta([
        check({ hints: [{ id: "shared", content: "a", penalty: 0 }] }),
        check({
          id: "second",
          label: "第二",
          hints: [{ id: "shared", content: "b", penalty: 0 }],
        }),
      ]),
    );
    expect(errors.join()).toMatch(/unique across the problem/);
  });

  it("checkMultiVerifyTranslations: en parity (label + per-check hints) を双方向で強制する", () => {
    // 英訳なし → error
    expect(checkMultiVerifyTranslations(meta([check()])).join()).toMatch(/英訳 label/);
    // 完全 parity → ok
    expect(
      checkMultiVerifyTranslations(
        meta(
          [check({ hints: [{ id: "h1", content: "ヒント", penalty: 0 }] })],
          [enCheck({ hints: [{ id: "h1", content: "Hint" }] })],
        ),
      ),
    ).toEqual([]);
    // 翻訳側にしか無い id → drift error
    expect(
      checkMultiVerifyTranslations(
        meta([check()], [enCheck(), enCheck({ id: "ghost" })]),
      ).join(),
    ).toMatch(/存在しない/);
    // hint の片側欠落 → error
    expect(
      checkMultiVerifyTranslations(
        meta([check({ hints: [{ id: "h1", content: "ヒント", penalty: 0 }] })], [enCheck()]),
      ).join(),
    ).toMatch(/hints\[\]\.id="h1" の英訳/);
  });

  it("checkCheckLabelSpoilerAdvisory: 脆弱性名 label を warning にする (非スポイラー §10)", () => {
    const warnings = checkCheckLabelSpoilerAdvisory(
      meta([check({ label: "SQLi bypass" })], [enCheck({ label: "XSS on login" })]),
    );
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/spoiler/);
    // 現象・対象で書いた label は通す
    expect(checkCheckLabelSpoilerAdvisory(meta([check()], [enCheck()]))).toEqual([]);
  });

  it("checkScoringRegulation: multi-verify の checks 合計もティア標準点と照合される (既存挙動の確認)", () => {
    // difficulty 3 = Medium 200。 合計 100 は違反。
    const errors = checkScoringRegulation(meta([check()]));
    expect(errors.join()).toMatch(/!= Medium tier standard 200/);
    expect(
      checkScoringRegulation(meta([check(), check({ id: "second", label: "第二" })])),
    ).toEqual([]);
  });
});

describe("checkParticipantVisibleSpoilerAdvisory (id)", () => {
  const withDisruption = (
    disruption: Record<string, unknown>,
    visible: Record<string, unknown>,
  ) => ({ disruptions: [disruption], ...visible });

  const surprise = { id: "ai-wipes-database", name: "AI がデータを消す" };
  const announced = { id: "frontend-down", name: "nginx 停止", publicHint: true };

  it("accepts a problem without disruptions", () => {
    expect(checkParticipantVisibleSpoilerAdvisory({ instructions: "SSM で入る。" })).toEqual([]);
  });

  it("accepts a publicHint disruption named in participant-facing text", () => {
    // battles/hello-world-battle pattern: the author opted in with publicHint,
    // so telling the participant about the fault is the intended lesson.
    const meta = withDisruption(announced, {
      instructions: "運営のレッドチームが予告なく frontend-down を起こします。",
      shortDescription: "frontend-down からの復旧を学ぶ。",
      i18n: { en: { instructions: "The red team may fire frontend-down." } },
    });
    expect(checkParticipantVisibleSpoilerAdvisory(meta)).toEqual([]);
  });

  it("keeps the surprise out of instructions", () => {
    const meta = withDisruption(surprise, {
      instructions: "まず ai-wipes-database に備えて backup を取る。",
    });
    const errors = checkParticipantVisibleSpoilerAdvisory(meta);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/ai-wipes-database/);
    expect(errors[0]).toMatch(/instructions/);
  });

  it("keeps the surprise out of shortDescription and the en overlay", () => {
    expect(
      checkParticipantVisibleSpoilerAdvisory(
        withDisruption(surprise, { shortDescription: "ai-wipes-database に耐える。" }),
      ),
    ).toHaveLength(1);
    expect(
      checkParticipantVisibleSpoilerAdvisory(
        withDisruption(surprise, {
          i18n: { en: { instructions: "Survive ai-wipes-database." } },
        }),
      ),
    ).toHaveLength(1);
  });

  it("allows the surprise in description, which is the operator's field", () => {
    // SCHEMA: description is [管理者/作者向け] and the fairness contract keeps it
    // off the competitor's portal, so the red-team playbook belongs there.
    const meta = withDisruption(surprise, {
      description: "## レッドチーム\n- `ai-wipes-database`: 投稿を空にする。revert は復元。",
      instructions: "vibe-status を実行して不足 gate を確認する。",
    });
    expect(checkParticipantVisibleSpoilerAdvisory(meta)).toEqual([]);
  });
});

describe("checkParticipantVisibleSpoilerAdvisory (誤検知で CI を止めない)", () => {
  it("does not hard-error on a single-word id that reads as ordinary prose", () => {
    // SCHEMA の id pattern `^[a-z0-9][a-z0-9-]*$` はハイフンを要求しないので id="down" は valid。
    // それを hard error にすると "If the site is down" で CI が壊れる。 複合語だけを gate する。
    const meta = {
      disruptions: [{ id: "down", name: "ダミー" }],
      instructions: "If the site is down, restart it.",
    };
    // hard error は出さない (CI を止めない) が、 助言としては拾う。
    expect(checkParticipantVisibleSpoilerAdvisory(meta)).toHaveLength(1);
  });

  it("still hard-errors on a compound id, which cannot occur in prose", () => {
    expect(
      checkParticipantVisibleSpoilerAdvisory({
        disruptions: [{ id: "ai-wipes-database", name: "DB 消去" }],
        instructions: "注意: ai-wipes-database が起きます。",
      }),
    ).toHaveLength(1);
  });
});

describe("checkParticipantVisibleSpoilerAdvisory (name / i18n.en.name)", () => {
  const surprise = { id: "ai-wipes-database", name: "AI がデータを消す", i18n: { en: { name: "AI wipes the database" } } };

  it("accepts text that does not name the surprise", () => {
    expect(
      checkParticipantVisibleSpoilerAdvisory({
        disruptions: [surprise],
        instructions: "vibe-status を実行する。",
      }),
    ).toEqual([]);
  });

  it("fails when a surprise name is repeated to the participant", () => {
    const errors = checkParticipantVisibleSpoilerAdvisory({
      disruptions: [surprise],
      instructions: "AI がデータを消す ことがあります。",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/ai-wipes-database/);
  });

  it("fails on the en name in the en overlay too", () => {
    expect(
      checkParticipantVisibleSpoilerAdvisory({
        disruptions: [surprise],
        i18n: { en: { instructions: "AI wipes the database without warning." } },
      }),
    ).toHaveLength(1);
  });

  it("accepts a publicHint disruption the author announces on purpose", () => {
    expect(
      checkParticipantVisibleSpoilerAdvisory({
        disruptions: [{ id: "frontend-down", name: "nginx 停止", publicHint: true }],
        instructions: "nginx 停止 が起きたら復旧する。",
      }),
    ).toEqual([]);
  });

  it("catches an ordinary plural of the name", () => {
    // 後端境界を厳格にすると "AI outages" が素通りする (実測で踏んだ)。 普通の英文で起きる。
    expect(
      checkParticipantVisibleSpoilerAdvisory({
        disruptions: [{ id: "ai-outage", name: "AI outage" }],
        instructions: "AI outages may happen.",
      }),
    ).toHaveLength(1);
  });

  it("does not let the plural suffix reopen the embedded-word false positive", () => {
    // `-s`/`-es` までは許すが `-d` は許さない — 許すと "first aid kit" が name="AI" に一致する。
    for (const instructions of ["Bring a first aid kit.", "Check the air flow and aim."]) {
      expect(
        checkParticipantVisibleSpoilerAdvisory({
          disruptions: [{ id: "ai-outage", name: "AI" }],
          instructions,
        }),
      ).toEqual([]);
    }
  });

  it("does not fire on an unrelated word that merely embeds a short name", () => {
    // name="AI" を素の部分一致で見ると "available" の中の "ai" で hard error になり、
    // 無関係な文章で CI が止まる。 ASCII の tell は語境界を要求する。
    expect(
      checkParticipantVisibleSpoilerAdvisory({
        disruptions: [{ id: "ai-outage", name: "AI" }],
        instructions: "The dashboard is available at /health. Keep it maintained.",
      }),
    ).toEqual([]);
  });

  it("still flags a short name used as a word", () => {
    expect(
      checkParticipantVisibleSpoilerAdvisory({
        disruptions: [{ id: "ai-outage", name: "AI" }],
        instructions: "AI が予告なく落ちます。",
      }),
    ).toHaveLength(1);
  });

  it("leaves the hard error to the id check", () => {
    // 日本語に直付けされた ASCII id (助詞が直結) は error 側が捕まえる。
    const meta = {
      disruptions: [{ id: "ai-wipes-database", name: "DB 消去" }],
      instructions: "障害ai-wipes-databaseが発生します。",
    };
    expect(checkParticipantVisibleSpoilerAdvisory(meta)).toHaveLength(1);
  });

  it("is not fooled by case, width, or spacing drift", () => {
    // 善意の作者が見出しで Title Case にする / 全角で書く / 空白が揺れる、で素通りさせない。
    const cases = [
      "AI WIPES THE DATABASE may happen.",
      "AI Wipes The Database may happen.",
      "ＡＩ wipes the database may happen.",
      "AI  wipes   the database may happen.",
    ];
    for (const instructions of cases) {
      expect(
        checkParticipantVisibleSpoilerAdvisory({ disruptions: [surprise], i18n: { en: { instructions } } }),
      ).toHaveLength(1);
    }
  });

  it("allows the name in description, the operator's field", () => {
    expect(
      checkParticipantVisibleSpoilerAdvisory({
        disruptions: [surprise],
        description: "## レッドチーム\n- AI がデータを消す。",
        instructions: "vibe-status を実行する。",
      }),
    ).toEqual([]);
  });
});
