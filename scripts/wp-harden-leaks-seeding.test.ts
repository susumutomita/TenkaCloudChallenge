import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

/**
 * `wp-harden-leaks` — the two things that stop an unseeded site scoring (Issue 415).
 *
 * ## The failure being prevented
 *
 * Every checkpoint in this problem is judged by an external scanner asking "can I still
 * reach this?". A site where the leftovers have not been planted yet answers 404 to every
 * probe, which is **exactly** what a perfectly remediated site answers. So a scan that
 * lands before `wpinit` finishes reads as all four holes closed, and the participant is
 * handed all 200 points for doing nothing — with a green result and nothing in any log
 * to indicate it.
 *
 * There are two independent defences and this pins both, because either alone is one
 * edit away from being removed by someone who does not know why it is there:
 *
 *   1. compose will not start `verify` until `wpinit` has exited successfully;
 *   2. the scanner itself refuses to score until it sees the marker `wpinit` writes last.
 *
 * The second is what survives a weakened `depends_on`, so it is the one that matters.
 *
 * ## Why this is a file-contents test
 *
 * Running the stack needs a Docker daemon. These are static assertions on the artifacts
 * that encode the ordering, which is the part a future edit would break silently — an
 * actual playthrough is tracked separately as real-environment verification.
 */

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LOCAL = join(REPO_ROOT, "challenges", "wp-harden-leaks", "local");
const read = (relative: string) => readFileSync(join(LOCAL, relative), "utf8");

describe("wp-harden-leaks: 未 seed のサイトが満点を出さない (Issue 415)", () => {
  it("は verify を wpinit の正常終了まで起動させない", () => {
    const compose = read("docker-compose.yml");
    const verify = compose.slice(compose.indexOf("\n  verify:"));
    expect(verify).toContain("wpinit:");
    expect(verify).toContain("condition: service_completed_successfully");
  });

  it("は scanner 自身が marker を見るまで採点を拒む", () => {
    // depends_on が緩められても残る側の防御。ここが消えると、compose の 1 行だけが
    // 「何もせず 200 点」を防いでいる状態になる。
    const server = read("verify/server.mjs");
    expect(server).toContain(".tenkacloud-seeded");
    expect(server).toContain("existsSync(SEED_MARKER)");
    // 拒むときも platform contract は守る: 200 で checkpointId を echo し、correct:false。
    const guard = server.slice(server.indexOf("if (!existsSync(SEED_MARKER))"));
    expect(guard.slice(0, 400)).toContain("correct: false");
  });

  it("は marker を wpinit の最後に書く", () => {
    // 途中で書くと、seed が半分だけ済んだ状態で採点が始まりうる。`set -e` と
    // 「最後の 1 行」の組み合わせが、失敗時に marker を残さないことを保証している。
    const init = read("wpinit/init.sh");
    expect(init).toContain("set -e");
    const marker = init.lastIndexOf('printf \'seeded\\n\' > "${MARKER}"');
    expect(marker).toBeGreaterThan(-1);
    // marker を書いたあとに残るのは echo だけ。planting も install も前に済んでいる。
    expect(init.slice(marker)).not.toContain("cat >");
    expect(init.slice(marker)).not.toContain("wp core install");
    // 再起動時に前回の marker で採点されないよう、先に消していること。
    expect(init.indexOf('rm -f "${MARKER}"')).toBeLessThan(marker);
  });

  it("は scanner に docroot を read-only でしか渡さない", () => {
    // scanner は外部スキャナなので、判定は HTTP だけで行う。書き込めると
    // 「自分で塞いで自分で合格させる」ことが原理的に可能になる。
    const compose = read("docker-compose.yml");
    const verify = compose.slice(compose.indexOf("\n  verify:"));
    expect(verify).toContain("wp_data:/wp:ro");
  });
});

describe("wp-harden-leaks: participant stage に仕掛けを置かない (Issue 415)", () => {
  it("は参加者が入るイメージへ seed script を焼き込まない", () => {
    // 参加者はこのコンテナに shell で入る。seed script は 4 つの穴とその正確な path を
    // 名指ししており、問題文が「自分で見極める」と言っている当のもの。
    const dockerfile = read("wordpress/Dockerfile");
    expect(dockerfile).toContain("AS participant");
    // 「文字列が出てこない」ではなく「イメージに入らない」を見る。この Dockerfile は
    // なぜ planting を追い出したかをコメントで説明しており、そこに名前が出るのは正しい。
    const build = dockerfile
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    expect(build).not.toMatch(/^\s*COPY\b/m);
    expect(build).not.toContain("seed-and-start.sh");
    expect(build).not.toMatch(/^\s*ENTRYPOINT\b/m);
  });

  it("は seed script を wpinit 側だけに置く", () => {
    const init = read("wpinit/init.sh");
    for (const hole of [
      "wp-content/backups/db-backup.sql",
      "wp-config.php.bak",
      "wp-content/mu-plugins/zz-ops-notice.php",
      "internal/handover.txt",
    ]) {
      expect(init, `${hole} の planting が wpinit に無い`).toContain(hole);
    }
  });

  it("は Portal terminal を wordpress service へ宣言する", () => {
    const meta = JSON.parse(
      readFileSync(join(LOCAL, "..", "metadata.json"), "utf8"),
    ) as { runtime: { terminal?: { service: string } }; instructions: string };
    expect(meta.runtime.terminal).toEqual({ service: "wordpress" });
    // ブラウザで完結するようになったので、手元のコマンドを要求する文言は残さない。
    expect(meta.instructions).not.toContain("docker compose exec");
  });
});
