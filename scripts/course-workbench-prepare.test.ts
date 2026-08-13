import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

/**
 * `PortalEditorSupport.prepare_submissions` — the partial-prepare contract (Issue 414).
 *
 * ## What went wrong
 *
 * The Portal prepares one checkpoint at a time but sends the values of *every*
 * answer-kind checkpoint, filling the ones it has no input for with `""`. Once a direct
 * answer is accepted the Portal replaces its input with a "solved" badge and persists
 * that, so after a runtime restart the remembered value is gone, the field cannot be
 * typed into again, and it arrives as `""`.
 *
 * The old rule refused prepare outright if any direct-answer value was empty — for all
 * checkpoints, including pure-code ones that never needed it. A player who followed the
 * stop button's own advice to free local resources was locked out of the problem
 * permanently: `sha256-bytes-padding` measured at 2/6 cleared with the remaining four
 * unreachable, and the same adapter is vendored into 30+ problems.
 *
 * ## What is pinned here
 *
 * Both halves, because each is a way to get this wrong:
 *
 *   - a code checkpoint prepares with **no** direct answers supplied at all;
 *   - a direct-answer checkpoint with no value is **omitted**, not sealed as empty.
 *
 * The second matters more than it looks. Sealing an empty answer would hand back a
 * signature that scores as a submitted answer, which is how "do not block the player"
 * turns into "credit an unanswered checkpoint".
 */

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Drive the canonical adapter directly, the way the verifier does. */
function prepare(manual: Record<string, string>): {
  ok: boolean;
  submissions?: Record<string, string>;
  missingManual?: string[];
  output?: string;
} {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(REPO_ROOT, "scripts", "course-workbench"))})
from workbench import PortalEditorSupport

support = PortalEditorSupport(
    root=${JSON.stringify(join(REPO_ROOT, "scripts"))},
    seed="prepare-contract-seed",
    problem_id="fixture-problem",
    problem_name="n", problem_name_en="n", description="d", description_en="d",
    checkpoint_labels={}, checkpoint_labels_en={},
    submitted_files=("solution.py",),
    code_checkpoints=("code-one", "code-two"),
    checkpoints=("answer-one", "answer-two", "code-one", "code-two"),
    max_body_bytes=262144, run_timeout_seconds=10, max_output_bytes=65536,
    limit_fn=None,
)
print(json.dumps(support.prepare_submissions({"solution.py": "print(1)"}, json.loads(sys.argv[1]))))
`;
  const out = execFileSync("python3", ["-c", script, JSON.stringify(manual)], {
    encoding: "utf8",
    timeout: 60_000,
  });
  return JSON.parse(out.trim());
}

describe("prepare_submissions の部分準備契約 (Issue 414)", () => {
  it("は直接回答が 1 つも無くても、コード checkpoint を準備する", () => {
    // 再起動後に参加者が置かれる状態そのもの。ここが ok:false に戻ると恒久ロックが復活する。
    const result = prepare({ "answer-one": "", "answer-two": "" });
    expect(result.ok).toBe(true);
    expect(Object.keys(result.submissions ?? {}).toSorted()).toEqual(["code-one", "code-two"]);
  });

  it("は値の無い直接回答を、空のまま封印せずに省く", () => {
    // 空を封印すると「回答済みとして採点に通る署名」を配ることになる。
    // 参加者を止めないための修正が、未回答の checkpoint を通す穴になってはいけない。
    const result = prepare({ "answer-one": "", "answer-two": "42" });
    expect(result.submissions).not.toHaveProperty("answer-one");
    expect(result.submissions?.["answer-two"]).toStartWith("tcw1.");
    expect(result.missingManual).toEqual(["answer-one"]);
  });

  it("は全部揃っていれば全部を封印して返す", () => {
    const result = prepare({ "answer-one": "7", "answer-two": "42" });
    expect(result.ok).toBe(true);
    expect(Object.keys(result.submissions ?? {}).toSorted()).toEqual([
      "answer-one",
      "answer-two",
      "code-one",
      "code-two",
    ]);
    expect(result.missingManual).toEqual([]);
  });

  it("は何が足りないかを、成功した応答でも報告し続ける", () => {
    // 呼び出し側が「まだ答えていない欄」を促せる情報は残す。ok が true になったことで
    // 促す手がかりまで消えると、参加者は何を求められているか分からなくなる。
    const result = prepare({});
    expect(result.ok).toBe(true);
    expect(result.missingManual?.toSorted()).toEqual(["answer-one", "answer-two"]);
  });

  it("は編集ファイルが空なら、今までどおり拒否する", () => {
    // これは参加者を閉じ込める失敗ではなく、送るものが無いという失敗。
    const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(REPO_ROOT, "scripts", "course-workbench"))})
from workbench import PortalEditorSupport
support = PortalEditorSupport(
    root=${JSON.stringify(join(REPO_ROOT, "scripts"))}, seed="s", problem_id="p",
    problem_name="n", problem_name_en="n", description="d", description_en="d",
    checkpoint_labels={}, checkpoint_labels_en={},
    submitted_files=("solution.py",), code_checkpoints=("code-one",),
    checkpoints=("code-one",), max_body_bytes=262144, run_timeout_seconds=10,
    max_output_bytes=65536, limit_fn=None,
)
print(json.dumps(support.prepare_submissions({"solution.py": "   "}, {})))
`;
    const out = execFileSync("python3", ["-c", script], { encoding: "utf8", timeout: 60_000 });
    expect(JSON.parse(out.trim()).ok).toBe(false);
  });
});
