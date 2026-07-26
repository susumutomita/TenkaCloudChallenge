import { participantPosts } from "../board.mjs";
import { readConfig } from "../config.mjs";
import { posture } from "../posture.mjs";
import { BOARD_SERIAL, BOOT_CHECK, READY_TOKEN } from "../secrets.mjs";

/**
 * The onboarding scenario: the 15-minute shakedown a participant runs before
 * StackStack proper.
 *
 * It deliberately contains no vulnerability and no trick. Its job is to prove
 * the environment works end to end — the participant can reach the app, read
 * its log, change its configuration, write through it, and see a score — and to
 * leave behind a machine-readable "this environment is good" signal that a
 * later problem's gate can read (`GET /posture` → `ready`).
 */

export const seedPosts = [
  {
    author: "cto",
    title: "社内掲示板、今週中に開けます",
    body: "AI Builder が作った掲示板をそのまま社内公開します。まずは読めるところまで。投稿の受付は運用チーム側で開けてください。",
    at: "2026-04-06T09:00:00.000Z",
  },
  {
    author: "sre-predecessor",
    title: "引き継ぎ: 設定は config/app.json",
    body: "アプリの設定はリポジトリの config/app.json 1 枚です。書き換えたら即反映されます。再起動は要りません。",
    at: "2026-04-06T09:20:00.000Z",
  },
];

/**
 * Checkpoints this participant has already answered correctly.
 *
 * A gate below asks whether they looked at something, and there is more than
 * one honest way to look. The boot-check value, for instance, is in the app's
 * log — reachable through `GET /api/logs` and equally through
 * `docker compose logs`, which the README offers as an alternative and which
 * this process never sees. Answering the checkpoint is itself proof they read
 * it, so a correct answer counts the same as the request would have.
 */
const proven = new Set();

/**
 * Every gate is measured from the running app: routes it actually served, what
 * the participant has demonstrably answered, the config file as it is on disk
 * right now, and the posts that exist.
 */
export const gates = {
  /** The participant reached the board surface at all. */
  board_visited: (context) =>
    context.observed.has("GET /") ||
    context.observed.has("GET /api/board") ||
    proven.has("board-open"),
  /** They went looking at the app's log rather than guessing. */
  logs_read: (context) => context.observed.has("GET /api/logs") || proven.has("log-trail"),
  /** The config edit landed: the board is accepting posts. */
  posts_open: (context) => context.configOk && context.config.acceptingPosts === true,
  /** And a write actually went through the app, not just the config. */
  post_created: (context) => context.participantPosts.length > 0,
};

/** Free-form answers are compared after trimming; nothing here is case-folded. */
const matches = (submission, expected) => submission.trim() === expected;

/** Record a correct answer so the matching gate can count it, and pass the verdict through. */
function remember(checkpointId, correct) {
  if (correct) proven.add(checkpointId);
  return correct;
}

/**
 * One handler per checkpoint. Each returns the verdict only — the platform owns
 * the points, and the container never sees them (AGENT.md §13).
 */
export const checks = {
  "board-open": (submission) => remember("board-open", matches(submission, BOARD_SERIAL)),

  "log-trail": (submission) => remember("log-trail", matches(submission, BOOT_CHECK)),

  /**
   * The submission is the title of the post the participant wrote. Passing it
   * needs two independent facts to hold at once: the config edit is live, and a
   * post with that title exists that the board did not ship with. Neither the
   * config nor the title alone is enough, so a participant cannot answer this
   * from the README.
   */
  "board-open-for-posts": (submission) => {
    const config = readConfig();
    if (!config.ok || config.value.acceptingPosts !== true) return false;
    const wanted = submission.trim();
    if (wanted === "") return false;
    return participantPosts().some((post) => post.title === wanted);
  },

  /**
   * The handover token. `/posture` withholds it until every gate above is
   * green, so this checkpoint is exactly "the environment is verified end to
   * end" — which is what a later StackStack gate wants to read.
   */
  handover: (submission) => posture({ gates }).ready && matches(submission, READY_TOKEN),
};
