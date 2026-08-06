import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allPosts } from "../board.mjs";
import { log } from "../log.mjs";
import { activeSourcePath } from "../overrides.mjs";
import { gateToken } from "../secrets.mjs";

/**
 * The vibe-build scenario: the board gets a search feature, and somebody has to
 * be the one who checks that the generated code does what was asked.
 *
 * Everything this problem adds lives in this module. The shared base gives it
 * routes, gates, gate receipts and checkpoint handlers, and that is all it gets.
 *
 * The model is small and honest about being a model. There is no cloud account
 * and no build pipeline. What there is:
 *
 *   spec        `GET /api/spec` — nine numbered requirements, the same text the
 *               READMEs carry, served by the app so it cannot drift out of reach
 *   feature     one file in the participant's checkout, mounted read-only and
 *               re-read whenever it changes: `search` and `renderResults`
 *   corpus      the imported archive the search runs over — public entries and
 *               entries that have never been on a public surface
 *   surfaces    `GET /api/search` (JSON) and `GET /search` (HTML), both of which
 *               call the participant's code and publish what comes back
 *   selfcheck   `GET /api/selfcheck` — the same measurement scoring runs, on
 *               demand, with expected-vs-actual notes and no answers
 *
 * Two properties are load-bearing and neither is negotiable.
 *
 * **The participant's code runs in a child process.** Not a worker thread: a
 * worker is a thread in the same OS process, so `/proc/self/environ` still holds
 * the exec-time environment and anything derived from `FLAG_SEED` stays
 * forgeable. The child is spawned with `env: {}`, so its environment really is
 * empty, and it cannot reach this process's memory — which matters because code
 * running *here* could import `secrets.mjs` and mint its own gate receipts, or
 * replace `globalThis.fetch` and answer the scorer's own probes.
 *
 * **Nothing this problem grades is derived from `FLAG_SEED`.** Every submission
 * is a `gateToken(...)` receipt, and those come from a secret generated at boot
 * that was never in the environment (see `secrets.mjs`). A participant who reads
 * `/proc/1/environ` out of the container gains nothing here.
 */

const FEATURE_PATH = process.env.APP_FEATURE ?? "/app/feature/search.mjs";
const SOURCE_NAME = "vibe-search";
const FEATURE_LABEL = "/api/source";

export const editableSource = {
  name: SOURCE_NAME,
  basePath: FEATURE_PATH,
  summary: { ja: "検索機能の source", en: "search feature source" },
  example:
    "export function search({ query, posts }) { return { status: 200, body: { query, matches: posts } }; }\n",
};

const ORIGIN = `http://127.0.0.1:${Number(process.env.CHALLENGE_PORT ?? 8080)}`;

/** The longest a single call into the participant's code may take. */
const CALL_TIMEOUT_MS = 1_500;

/**
 * How many calls may be outstanding at once.
 *
 * The child can reach loopback, so a `search()` that fetches `/api/search`
 * recurses. The cap plus the timeout bound that: the recursion answers with an
 * error instead of queueing forever, and the board and `/verify` keep serving.
 */
const MAX_PENDING_CALLS = 8;

export const seedPosts = [
  {
    author: "cto",
    title: "検索、 付けてください",
    body: "過去ログのインポートが終わったので、 板から検索できるようにしてください。 生成 AI に書かせて構いません。 要件は仕様書にしてアプリの中に置いてあります (GET /api/spec)。",
    at: "2026-04-08T09:10:00.000Z",
  },
  {
    author: "sre-predecessor",
    title: "引き継ぎ: アーカイブは 1 つの入れ物です",
    body: "移行のとき、 取り込み待ちのものも含めて 1 か所にまとめました。 公開面に出す分の切り分けは、 表示側でやる約束のまま止まっています。",
    at: "2026-04-08T09:25:00.000Z",
  },
];

// ---------------------------------------------------------------------------
// the participant's code, in a process of its own
// ---------------------------------------------------------------------------

/**
 * The child's whole program. Written to a temp file at boot and run by
 * `process.execPath`, so the same source runs under Node in the container and
 * under Bun in CI.
 *
 * It speaks newline-delimited JSON on stdio: one request in, one reply out. The
 * participant's module is imported with a cache-busting query derived from the
 * file's mtime and size, so a save takes effect without a restart.
 */
const HARNESS_SOURCE = `
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\\n");
  while (index >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim() !== "") void handle(line);
    index = buffer.indexOf("\\n");
  }
});

function write(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}

async function handle(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  let loaded;
  try {
    loaded = await import("file://" + message.path + "?v=" + message.stamp);
  } catch (error) {
    // Reported as a *load* failure, not a call failure: the parent has to throw
    // this process away, because one runtime leaves a module registry that took
    // a failed import in a state where the next import of the same specifier
    // never settles.
    write({
      id: message.id,
      ok: false,
      phase: "load",
      error: String((error && error.message) || error),
    });
    return;
  }
  try {
    if (message.fn === "__exports") {
      write({
        id: message.id,
        ok: true,
        value: Object.keys(loaded).filter((name) => typeof loaded[name] === "function"),
      });
      return;
    }
    const handler = loaded[message.fn];
    if (typeof handler !== "function") {
      write({
        id: message.id,
        ok: false,
        phase: "call",
        error: message.fn + " is not exported as a function",
      });
      return;
    }
    const value = await handler(message.arg);
    write({
      id: message.id,
      ok: true,
      value: JSON.parse(JSON.stringify(value === undefined ? null : value)),
    });
  } catch (error) {
    write({
      id: message.id,
      ok: false,
      phase: "call",
      error: String((error && error.message) || error),
    });
  }
}
`;

const HARNESS_PATH = join(mkdtempSync(join(tmpdir(), "stackstack-vibe-build-")), "harness.mjs");
writeFileSync(HARNESS_PATH, HARNESS_SOURCE);

/** @type {import("node:child_process").ChildProcess | null} */
let child = null;
let childAlive = false;
let childBuffer = "";
let nextCallId = 0;

/**
 * The version of the feature file the running child imported.
 *
 * A fresh process is how a saved edit takes effect. The obvious alternative —
 * importing `file://…?v=<mtime>` inside a long-lived child — reloads under Node
 * and silently does not under Bun, which resolves a file specifier without its
 * query string. The same source has to behave the same in the container and in
 * CI, so the reload is a respawn rather than a cache trick.
 */
let childStamp = null;

/** @type {Map<number, (payload: { ok: boolean, value?: unknown, error?: string }) => void>} */
const pending = new Map();

function failPending(reason) {
  const waiting = [...pending.values()];
  pending.clear();
  for (const resolve of waiting) resolve({ ok: false, error: reason });
}

/**
 * The container path appears in a loader's own error text, and it is not a path
 * the participant can open. Swapped for the one they can — the same reason
 * `CONFIG_HINT` exists.
 */
const readable = (text) =>
  String(text)
    .split(FEATURE_PATH)
    .join(FEATURE_LABEL)
    .split(activeSourcePath(SOURCE_NAME, FEATURE_PATH))
    .join(FEATURE_LABEL);

function onChildLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const resolve = pending.get(message.id);
  if (resolve === undefined) return;
  pending.delete(message.id);
  if (message.ok === true) {
    resolve({ ok: true, value: message.value });
    return;
  }
  const error = readable(message.error ?? "the feature call failed");
  resolve({ ok: false, error });
  // A module that failed to load poisons the process that tried: throw it away
  // rather than let the next call hang on a specifier the loader will not
  // settle. A handler that merely threw leaves the process perfectly usable.
  if (message.phase === "load") restartChild(`${FEATURE_LABEL} could not be loaded`);
}

function ensureChild(stamp) {
  if (child !== null && childAlive && childStamp === stamp) return child;
  if (child !== null && childAlive) restartChild("the feature file changed");
  // `env: {}` and nothing else. The child is a real process, so this *is* its
  // exec-time environment: `/proc/self/environ` inside it is empty.
  const spawned = spawn(process.execPath, [HARNESS_PATH], {
    env: {},
    stdio: ["pipe", "pipe", "pipe"],
  });
  child = spawned;
  childAlive = true;
  childStamp = stamp;
  childBuffer = "";
  spawned.stdout.setEncoding("utf8");
  spawned.stdout.on("data", (chunk) => {
    childBuffer += chunk;
    let index = childBuffer.indexOf("\n");
    while (index >= 0) {
      const line = childBuffer.slice(0, index);
      childBuffer = childBuffer.slice(index + 1);
      if (line.trim() !== "") onChildLine(line);
      index = childBuffer.indexOf("\n");
    }
  });
  spawned.stderr.setEncoding("utf8");
  spawned.stderr.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text !== "") noteFeatureError(`feature process wrote to stderr: ${readable(text).slice(0, 300)}`);
  });
  // stdout, stderr, exit and spawn-error were all handled; stdin was not. A
  // write can only fail because the child is already gone, and the pending call
  // is failed by `gone` either way -- but an EPIPE on a stream with no `error`
  // listener is an unhandled 'error' event, which takes the whole app down.
  // This scenario runs participant code that is expected to crash its own
  // process, so that is not a rare path here; it is the normal one.
  spawned.stdin.on("error", (error) => {
    noteFeatureError(`the feature process stopped accepting input: ${readable(error.message)}`);
  });
  const gone = (reason) => {
    if (child !== spawned) return;
    childAlive = false;
    failPending(reason);
  };
  spawned.on("exit", (code, signal) => gone(`the feature process exited (code=${code} signal=${signal})`));
  spawned.on("error", (error) => gone(`the feature process could not start: ${error.message}`));
  spawned.unref?.();
  return spawned;
}

function restartChild(reason) {
  const doomed = child;
  child = null;
  childAlive = false;
  childStamp = null;
  failPending(reason);
  // The harness installs no SIGTERM handler, so the default disposition applies
  // and even a synchronous infinite loop in the participant's code dies here.
  doomed?.kill();
}

/** The feature file as it is on disk right now — never cached at boot. */
function featureStamp() {
  const path = activeSourcePath(SOURCE_NAME, FEATURE_PATH);
  try {
    const stat = statSync(path);
    return { ok: true, path, value: `${path}:${stat.mtimeMs}-${stat.size}` };
  } catch (error) {
    return {
      ok: false,
      path,
      value: "",
      error: `cannot read ${FEATURE_LABEL}: ${error.code ?? error.message}`,
    };
  }
}

let lastFeatureError = null;

/** Log a feature failure once per distinct message, so a reload loop cannot flood the ring. */
function noteFeatureError(message) {
  if (lastFeatureError === message) return;
  lastFeatureError = message;
  log("warn", `feature: ${message}`);
}

/**
 * Call one export of the participant's module.
 *
 * @returns {Promise<{ ok: true, value: unknown } | { ok: false, error: string }>}
 */
function callFeature(fn, arg) {
  const stamp = featureStamp();
  if (!stamp.ok) {
    noteFeatureError(stamp.error);
    return Promise.resolve({ ok: false, error: stamp.error });
  }
  if (pending.size >= MAX_PENDING_CALLS) {
    return Promise.resolve({
      ok: false,
      error: `too many calls into ${FEATURE_LABEL} at once (${MAX_PENDING_CALLS})`,
    });
  }
  const proc = ensureChild(stamp.value);
  nextCallId += 1;
  const id = nextCallId;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      const error = `${fn} in ${FEATURE_LABEL} did not answer within ${CALL_TIMEOUT_MS}ms`;
      noteFeatureError(error);
      restartChild(error);
      resolve({ ok: false, error });
    }, CALL_TIMEOUT_MS);
    timer.unref?.();
    pending.set(id, (payload) => {
      clearTimeout(timer);
      if (payload.ok !== true) noteFeatureError(String(payload.error));
      resolve(payload);
    });
    try {
      proc.stdin.write(`${JSON.stringify({ id, path: stamp.path, stamp: stamp.value, fn, arg })}\n`);
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      resolve({ ok: false, error: error.message });
    }
  });
}

// ---------------------------------------------------------------------------
// the corpus the search runs over
// ---------------------------------------------------------------------------

/**
 * The archive the migration left behind. Ids sit far above anything the board
 * can mint, so ordering by id is total across the whole corpus.
 *
 * Two entries have never been on a public surface. They are not marked in the
 * prose anywhere a participant can read; the only place the distinction exists
 * is the `visibility` field on the objects their own function is handed.
 */
const ARCHIVE = [
  {
    id: 10_001,
    title: "リリース手順の棚卸し",
    author: "sre-predecessor",
    body: "手順書の版が 3 つに割れていたので 1 本にまとめた。 旧版は破棄。",
    at: "2026-02-03T01:00:00.000Z",
    visibility: "public",
  },
  {
    id: 10_002,
    title: "問い合わせ窓口の当番表",
    author: "ops",
    body: "月曜から金曜、 9 時から 18 時。 祝日は当番なし。",
    at: "2026-02-05T02:10:00.000Z",
    visibility: "public",
  },
  {
    id: 10_003,
    title: "社内勉強会のお知らせ",
    author: "cto",
    body: "毎月第 2 水曜。 テーマ持ち込み歓迎。 資料は板に貼ってください。",
    at: "2026-02-10T03:20:00.000Z",
    visibility: "public",
  },
  {
    id: 10_004,
    title: "備品の申請フロー",
    author: "ops",
    body: "申請から到着までおおむね 5 営業日。 急ぎは窓口へ。",
    at: "2026-02-14T04:30:00.000Z",
    visibility: "public",
  },
  {
    id: 10_005,
    title: "監視のしきい値を見直した",
    author: "sre-predecessor",
    body: "夜間の誤検知が多かったので、 応答時間の警告値を上げた。",
    at: "2026-02-20T05:40:00.000Z",
    visibility: "public",
  },
  {
    id: 10_006,
    title: "議事録: 3 月の計画",
    author: "cto",
    body: "掲示板を社内公開する。 検索は次の反復で入れる。",
    at: "2026-03-02T06:50:00.000Z",
    visibility: "public",
  },
  {
    id: 10_007,
    title: "アカウント棚卸しの結果",
    author: "ops",
    body: "使われていない社内アカウントを 4 件停止した。",
    at: "2026-03-09T07:00:00.000Z",
    visibility: "public",
  },
  {
    id: 10_008,
    title: "バックアップの復元訓練",
    author: "sre-predecessor",
    body: "四半期に 1 回、 復元まで通す。 前回は 22 分。",
    at: "2026-03-16T08:10:00.000Z",
    visibility: "public",
  },
  {
    id: 10_009,
    title: "板の使い方",
    author: "ops",
    body: "宛先を書く、 期限を書く、 決まったことを書く。 それだけ。",
    at: "2026-03-23T09:20:00.000Z",
    visibility: "public",
  },
  {
    id: 10_010,
    title: "past logs import 完了",
    author: "sre-predecessor",
    body: "取り込みは終わり。 まだ整理しきれていないものが同じ入れ物に残っている。",
    at: "2026-04-01T10:30:00.000Z",
    visibility: "public",
  },
  {
    id: 10_011,
    title: "退職にあたって",
    author: "sre-predecessor",
    body: "書きかけ。 引き継ぎのうち、 まだ誰にも見せていない部分をここに置いている。",
    at: "2026-04-02T11:40:00.000Z",
    visibility: "internal",
  },
  {
    id: 10_012,
    title: "夜間障害の一次報告",
    author: "sre-predecessor",
    body: "書きかけ。 原因が確定するまで社外にも社内にも出していない。",
    at: "2026-04-03T12:50:00.000Z",
    visibility: "internal",
  },
];

/**
 * The importer keeps appending lots, so the corpus always carries a handful of
 * freshly generated entries with values nobody could have known in advance.
 *
 * That is deliberate. If random-looking entries appeared *only* while the app
 * was measuring, an implementation could tell "I am being graded" from the shape
 * of its own input and behave differently. They are always there instead.
 */
const ROTATION_MS = 2_000;
let rotation = [];
let rotatedAt = 0;

function rotate() {
  const now = Date.now();
  if (rotation.length > 0 && now - rotatedAt < ROTATION_MS) return;
  rotatedAt = now;
  rotation = [0, 1, 2, 3].map((index) => {
    const lot = randomBytes(8).toString("hex");
    return {
      id: 20_000 + index,
      title: `インポート ロット ${lot.slice(0, 8)}`,
      author: "importer",
      body: `取り込みキュー lot=${lot}`,
      at: new Date(now).toISOString(),
      // One lot per rotation is still being triaged and has never been public.
      visibility: index === 3 ? "internal" : "public",
    };
  });
}

/** @type {Map<string, object[]>} */
const activeBatches = new Map();

let nextProbeId = 100_000;

function probeEntry({ title, author = "importer", body, visibility }) {
  nextProbeId += 1;
  return {
    id: nextProbeId,
    title,
    author,
    body,
    at: new Date().toISOString(),
    visibility,
  };
}

/** The whole corpus, exactly as the participant's `search` receives it. */
function corpus() {
  rotate();
  const entries = allPosts().map((post) => ({
    id: post.id,
    title: post.title,
    author: post.author,
    body: post.body,
    at: post.at,
    visibility: "public",
  }));
  entries.push(...ARCHIVE, ...rotation);
  for (const batch of activeBatches.values()) entries.push(...batch);
  return entries;
}

async function withBatch(entries, task) {
  const id = randomUUID();
  activeBatches.set(id, entries);
  try {
    return await task();
  } finally {
    // Probe entries never touch the board, so nothing a participant wrote can be
    // disturbed by being scored; this only has to put the corpus back.
    activeBatches.delete(id);
  }
}

// ---------------------------------------------------------------------------
// the requirements
// ---------------------------------------------------------------------------

const MAX_QUERY_LENGTH = 64;
const MAX_RESULTS = 10;
const ERROR_REQUIRED = "q_required";
const ERROR_TOO_LONG = "q_too_long";
const ENTRY_KEYS = ["at", "author", "id", "title"];

const SPEC = {
  version: 1,
  feature: FEATURE_LABEL,
  endpoints: {
    json: "GET /api/search?q=<検索語>",
    html: "GET /search?q=<検索語>",
  },
  exports: {
    search: "search({ query, posts }) -> { status, body }",
    renderResults: "renderResults({ query, matches }) -> string (HTML)",
  },
  arguments: {
    query: "?q= が無いときは null、 有るときはその文字列そのまま (trim していない)",
    posts: "{ id, title, author, body, at, visibility } の配列",
    matches: "search が返した body.matches をそのまま渡す",
  },
  rules: [
    {
      id: "R1",
      ja: `query が null、 空文字、 空白だけのいずれかなら { status: 400, body: { error: "${ERROR_REQUIRED}" } } を返す。`,
      en: `If query is null, empty, or only whitespace, return { status: 400, body: { error: "${ERROR_REQUIRED}" } }.`,
    },
    {
      id: "R2",
      ja: `trim した長さが ${MAX_QUERY_LENGTH} を超えるなら { status: 400, body: { error: "${ERROR_TOO_LONG}" } } を返す。 ${MAX_QUERY_LENGTH} 文字ちょうどは許可する。`,
      en: `If the trimmed length exceeds ${MAX_QUERY_LENGTH}, return { status: 400, body: { error: "${ERROR_TOO_LONG}" } }. Exactly ${MAX_QUERY_LENGTH} is allowed.`,
    },
    {
      id: "R3",
      ja: "それ以外は { status: 200, body: { query, matches } } を返す。 query は trim 済みの検索語そのもの。",
      en: "Otherwise return { status: 200, body: { query, matches } }, where query is the trimmed search term itself.",
    },
    {
      id: "R4",
      ja: `matches の各要素はキーがちょうど ${ENTRY_KEYS.join(" / ")} の 4 つ。 値は元の post のまま。 余分なキーを付けない。`,
      en: `Every element of matches has exactly the four keys ${ENTRY_KEYS.join(" / ")}, carrying the original post's values. No extra keys.`,
    },
    {
      id: "R5",
      ja: "一致判定は title と body に対する大文字小文字を区別しない部分文字列一致。 正規表現でも単語分割でもない。",
      en: "A post matches when the term appears in its title or body, case-insensitively, as a substring — not a regex, not word splitting.",
    },
    {
      id: "R6",
      ja: 'visibility が "public" のものだけを返す。 posts には他の値のものも混ざって届く。',
      en: 'Return only posts whose visibility is "public". Other values arrive in posts as well.',
    },
    {
      id: "R7",
      ja: `id の降順に並べ、 先頭 ${MAX_RESULTS} 件までを返す (並べてから ${MAX_RESULTS} 件)。`,
      en: `Sort by id descending and return at most ${MAX_RESULTS} (sort first, then cut).`,
    },
    {
      id: "R8",
      ja: "一致が 0 件でもエラーにしない。 200 と空の matches を返す。",
      en: "No hits is not an error: return 200 with an empty matches array.",
    },
    {
      id: "R9",
      ja: 'renderResults が返す HTML では、 検索語と各 entry の title / author を「文字として」表示する。 1 文字も落とさず、 & < > " \' を実体参照に置き換える。 一致 0 件でも検索語は表示する。',
      en: 'The HTML renderResults returns must display the search term and every entry\'s title and author as text: drop no character, and replace & < > " \' with entity references. Show the term even when there are no hits.',
    },
  ],
  aiPolicy: {
    ja: "生成 AI に書かせて構いません (推奨します)。 ただし採点は生成物のコードを読みません。 走っているアプリへの HTTP レスポンスだけで決まります。 貼る前に GET /api/selfcheck を 1 回通してください。",
    en: "Generating this with an AI tool is allowed and encouraged. Scoring never reads the code: it is decided only from the HTTP responses the running app gives. Run GET /api/selfcheck once before you trust what you pasted.",
  },
  howToVerify: {
    ja: "GET /api/selfcheck が採点とまったく同じ検査を回し、 落ちた規則と「期待した値 / 返ってきた値」を返します。 全部緑になったら GET /posture の tokens に受領印が出ます。 検査に使う投稿は毎回作り直されるので、 覚えても次は別物です。",
    en: "GET /api/selfcheck runs exactly the measurement scoring runs and reports which rules failed, with expected-versus-actual. Once every rule is green, GET /posture carries a receipt per gate under tokens. The posts the check uses are rebuilt every run, so memorising them buys nothing.",
  },
};

// ---------------------------------------------------------------------------
// probes
// ---------------------------------------------------------------------------

/**
 * A per-batch tag with no stable part at all.
 *
 * An earlier shape put a `FLAG_SEED`-derived prefix on every probe, which handed
 * the participant's own code a reliable "this is the grader" signal on its very
 * first argument. Nothing here is derived from anything that outlives the batch,
 * and at least one hex letter is guaranteed so the case-folding probe has
 * something to fold.
 */
function probeTag() {
  for (;;) {
    const tag = randomBytes(8).toString("hex");
    if (/[a-f]/.test(tag)) return tag;
  }
}

const WORDS = [
  "lantern",
  "quartz",
  "harbor",
  "meadow",
  "cobalt",
  "ember",
  "willow",
  "garnet",
  "tundra",
  "saffron",
  "onyx",
  "cedar",
  "zephyr",
  "indigo",
  "marble",
  "juniper",
];

/**
 * A word-shaped per-batch term.
 *
 * The tag probes all look like hex, so an implementation could in principle
 * apply the rules only to hex-looking queries. One probe in every batch that
 * cares about the public/non-public line uses this instead, and it has to hold
 * there too.
 */
function probeWord() {
  const first = WORDS[Math.floor(Math.random() * WORDS.length)];
  let second = first;
  while (second === first) second = WORDS[Math.floor(Math.random() * WORDS.length)];
  return `${first}-${second}`;
}

async function probeGet(path) {
  try {
    const response = await fetch(`${ORIGIN}${path}`);
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    return { status: response.status, body, text, headers: response.headers };
  } catch (error) {
    return { status: 0, body: undefined, text: "", headers: null, error: error.message };
  }
}

const searchPath = (term) => `/api/search?q=${encodeURIComponent(term)}`;

const idsOf = (matches) => matches.map((entry) => entry.id);

const sameSet = (left, right) =>
  left.length === right.length && [...left].sort().join(",") === [...right].sort().join(",");

/**
 * The JSON envelope every probe needs before it can say anything else.
 *
 * @returns {{ ok: true, matches: object[], body: object, text: string } | { ok: false, note: string }}
 */
function readSearch(response, expectedQuery) {
  if (response.status === 0) return { ok: false, note: `/api/search did not answer (${response.error})` };
  if (response.status !== 200) {
    const detail = response.body?.error ?? response.body?.detail ?? "";
    return { ok: false, note: `R3: expected status 200 for "${expectedQuery}", got ${response.status} ${detail}` };
  }
  const body = response.body;
  if (body === undefined || body === null || typeof body !== "object") {
    return { ok: false, note: "R3: the response body was not a JSON object" };
  }
  if (body.query !== expectedQuery) {
    return {
      ok: false,
      note: `R3: body.query should be the trimmed search term, got ${JSON.stringify(body.query)}`,
    };
  }
  if (!Array.isArray(body.matches)) {
    return { ok: false, note: `R3: body.matches should be an array, got ${typeof body.matches}` };
  }
  return { ok: true, matches: body.matches, body, text: response.text };
}

/** R4: every entry carries exactly the four declared keys. */
function checkEntryShape(matches) {
  for (const entry of matches) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return `R4: every element of matches must be an object, got ${JSON.stringify(entry)}`;
    }
    const keys = Object.keys(entry).sort();
    if (keys.join(",") !== ENTRY_KEYS.join(",")) {
      return `R4: an entry had keys [${keys.join(", ")}], expected exactly [${ENTRY_KEYS.join(", ")}]`;
    }
  }
  return null;
}

/** R4: and the values are the ones the corpus actually holds. */
function checkEntryValues(matches, entries) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const entry of matches) {
    const source = byId.get(entry.id);
    if (source === undefined) continue;
    for (const key of ["title", "author", "at"]) {
      if (entry[key] !== source[key]) {
        return `R4: entry ${entry.id} reported ${key}=${JSON.stringify(entry[key])}, the archive holds ${JSON.stringify(source[key])}`;
      }
    }
  }
  return null;
}

/**
 * `search_answers` — the feature answers at all, and answers about the right
 * posts.
 *
 * Three entries carry the batch's tag and three more carry a different one, so
 * "return everything" is as wrong as "return nothing". An untouched starter
 * returns neither the echoed term nor a single id.
 */
async function probeAnswers() {
  const tag = probeTag();
  const wanted = [];
  const entries = [];
  for (let index = 0; index < 3; index += 1) {
    const entry = probeEntry({
      title: `週次まとめ ${tag}`,
      body: `対象ロット ${tag} の記録`,
      visibility: "public",
    });
    wanted.push(entry.id);
    entries.push(entry);
  }
  for (let index = 0; index < 3; index += 1) {
    const other = probeTag();
    entries.push(
      probeEntry({ title: `週次まとめ ${other}`, body: `対象ロット ${other} の記録`, visibility: "public" }),
    );
  }

  return withBatch(entries, async () => {
    const read = readSearch(await probeGet(searchPath(tag)), tag);
    if (!read.ok) return { ok: false, notes: [read.note] };
    const shape = checkEntryShape(read.matches);
    if (shape !== null) return { ok: false, notes: [shape] };
    const values = checkEntryValues(read.matches, entries);
    if (values !== null) return { ok: false, notes: [values] };
    if (!sameSet(idsOf(read.matches), wanted)) {
      return {
        ok: false,
        notes: [
          `R5: the term matched ${wanted.length} archive entries, the response returned ${read.matches.length}`,
        ],
      };
    }
    return { ok: true, notes: [] };
  });
}

/**
 * `search_order` — the list a caller gets back is the right list, in the right
 * order, cut at the right place.
 *
 * The no-hit probe runs last and only if the two positive probes passed, so an
 * implementation that returns an empty array for everything never reaches it.
 */
async function probeOrder() {
  const many = probeTag();
  const cased = probeTag();
  const entries = [];
  const manyIds = [];
  for (let index = 0; index < 14; index += 1) {
    const entry = probeEntry({
      title: `ロット ${many} 第 ${index} 便`,
      body: `明細 ${many}`,
      visibility: "public",
    });
    manyIds.push(entry.id);
    entries.push(entry);
  }
  const casedIds = [];
  for (let index = 0; index < 3; index += 1) {
    const entry = probeEntry({
      title: `照合 ${cased}`,
      body: `照合対象 ${cased}`,
      visibility: "public",
    });
    casedIds.push(entry.id);
    entries.push(entry);
  }

  return withBatch(entries, async () => {
    const notes = [];
    const wide = readSearch(await probeGet(searchPath(many)), many);
    if (!wide.ok) return { ok: false, notes: [wide.note] };
    if (wide.matches.length !== MAX_RESULTS) {
      notes.push(
        `R7: ${manyIds.length} entries matched, expected ${MAX_RESULTS} back, got ${wide.matches.length}`,
      );
      return { ok: false, notes };
    }
    const returned = idsOf(wide.matches);
    const descending = returned.every(
      (id, index) => index === 0 || returned[index - 1] > id,
    );
    if (!descending) {
      notes.push("R7: the entries were not in strictly descending id order");
      return { ok: false, notes };
    }
    const expected = [...manyIds].sort((left, right) => right - left).slice(0, MAX_RESULTS);
    if (returned.join(",") !== expected.join(",")) {
      notes.push(
        `R7: the ${MAX_RESULTS} returned are not the ${MAX_RESULTS} highest ids among the ${manyIds.length} that matched (sort first, then cut)`,
      );
      return { ok: false, notes };
    }

    const upper = cased.toUpperCase();
    const folded = readSearch(await probeGet(searchPath(upper)), upper);
    if (!folded.ok) return { ok: false, notes: [folded.note] };
    if (!sameSet(idsOf(folded.matches), casedIds)) {
      notes.push(
        `R5: matching is case-insensitive — the upper-cased term should still have matched ${casedIds.length} entries, got ${folded.matches.length}`,
      );
      return { ok: false, notes };
    }

    // Only now, with the two positive probes green, does "returns nothing" mean
    // anything: an implementation that always returns nothing failed above.
    const absent = `${many}-${probeTag()}`;
    const empty = readSearch(await probeGet(searchPath(absent)), absent);
    if (!empty.ok) return { ok: false, notes: [empty.note] };
    if (empty.matches.length !== 0) {
      notes.push(`R8: a term nothing contains should return 0 entries, got ${empty.matches.length}`);
      return { ok: false, notes };
    }
    return { ok: true, notes: [] };
  });
}

/**
 * `search_bad_queries` — the four broken inputs are refused with the names the
 * spec gives them, and the two good ones still work.
 *
 * The good ones run first. "Refuse everything" is the cheap fix this checkpoint
 * exists to catch, and it has to fail before a single 400 is even looked at.
 */
async function probeBadQueries() {
  const tag = probeTag();
  const longTag = probeTag();
  const exact = `${longTag}-${"k".repeat(MAX_QUERY_LENGTH - longTag.length - 1)}`;
  const entries = [];
  const tagged = [];
  for (let index = 0; index < 3; index += 1) {
    const entry = probeEntry({
      title: `受付 ${tag}`,
      body: `受付番号 ${tag}`,
      visibility: "public",
    });
    tagged.push(entry.id);
    entries.push(entry);
  }
  const boundary = probeEntry({
    title: "長い照会番号の控え",
    body: `照会番号 ${exact} で登録済み`,
    visibility: "public",
  });
  entries.push(boundary);

  return withBatch(entries, async () => {
    const notes = [];
    // R2's boundary from the allowed side: exactly the limit must still work.
    const atLimit = readSearch(await probeGet(searchPath(exact)), exact);
    if (!atLimit.ok) return { ok: false, notes: [atLimit.note] };
    if (!sameSet(idsOf(atLimit.matches), [boundary.id])) {
      notes.push(
        `R2: a term of exactly ${MAX_QUERY_LENGTH} characters is allowed and matched 1 entry, got ${atLimit.matches.length}`,
      );
      return { ok: false, notes };
    }
    const ordinary = readSearch(await probeGet(searchPath(tag)), tag);
    if (!ordinary.ok) return { ok: false, notes: [ordinary.note] };
    if (!sameSet(idsOf(ordinary.matches), tagged)) {
      notes.push(`R5: an ordinary term matched ${tagged.length} entries, got ${ordinary.matches.length}`);
      return { ok: false, notes };
    }

    const refusals = [
      { path: "/api/search", why: "no q at all", error: ERROR_REQUIRED, rule: "R1" },
      { path: "/api/search?q=", why: "an empty q", error: ERROR_REQUIRED, rule: "R1" },
      { path: "/api/search?q=%20%20", why: "a q of only spaces", error: ERROR_REQUIRED, rule: "R1" },
      {
        path: searchPath(`${exact}k`),
        why: `a q of ${MAX_QUERY_LENGTH + 1} characters`,
        error: ERROR_TOO_LONG,
        rule: "R2",
      },
    ];
    for (const refusal of refusals) {
      const response = await probeGet(refusal.path);
      if (response.status !== 400) {
        notes.push(`${refusal.rule}: ${refusal.why} should answer 400, got ${response.status}`);
        return { ok: false, notes };
      }
      if (response.body?.error !== refusal.error) {
        notes.push(
          `${refusal.rule}: ${refusal.why} should answer error="${refusal.error}", got ${JSON.stringify(response.body?.error)}`,
        );
        return { ok: false, notes };
      }
    }
    return { ok: true, notes: [] };
  });
}

/**
 * `drafts_withheld` — what comes back is the public part of the corpus, and only
 * the public part.
 *
 * Three layers, in order, on the same responses:
 *
 *  1. the public entries come back, with the values the archive holds — an
 *     implementation that returns nothing, or returns bare ids, stops here;
 *  2. one query is word-shaped rather than tag-shaped, so applying the rule only
 *     to inputs that look like the grader's does not survive;
 *  3. only then: the non-public ids and their markers must be absent from the
 *     whole response text. That last one is not implied by (1) — an entry set
 *     can be exactly right while the same response carries a `debug` field with
 *     the corpus in it, which is a leak by any measure.
 *
 * The non-public entries are minted per batch, so an exclusion list of known ids
 * is worth nothing, and one of them is a near-duplicate of a public entry so a
 * title-level de-duplication cannot stand in for reading `visibility`.
 */
async function probeDrafts() {
  const tag = probeTag();
  const word = probeWord();
  const marker = `MK-${randomBytes(8).toString("hex")}`;
  const entries = [];

  const near = probeEntry({
    title: `月次レポート ${word}`,
    body: `確定版。 ${tag}`,
    visibility: "public",
  });
  const second = probeEntry({ title: `障害連絡 ${tag}`, body: "復旧済み", visibility: "public" });
  const third = probeEntry({ title: `検収メモ ${tag}`, body: "検収完了", visibility: "public" });
  entries.push(near, second, third);

  const draftNear = probeEntry({
    title: `月次レポート ${word}（下書き）`,
    body: `未確定。 ${tag} ${marker}`,
    visibility: "internal",
  });
  const draftOther = probeEntry({
    title: `棚卸し ${tag}`,
    body: `社外にも社内にも出していない。 ${marker}`,
    visibility: "internal",
  });
  entries.push(draftNear, draftOther);

  const publicIds = [near.id, second.id, third.id];
  const draftIds = [draftNear.id, draftOther.id];

  return withBatch(entries, async () => {
    const notes = [];
    const byTag = readSearch(await probeGet(searchPath(tag)), tag);
    if (!byTag.ok) return { ok: false, notes: [byTag.note] };
    const shape = checkEntryShape(byTag.matches);
    if (shape !== null) return { ok: false, notes: [shape] };
    const values = checkEntryValues(byTag.matches, entries);
    if (values !== null) return { ok: false, notes: [values] };
    if (!sameSet(idsOf(byTag.matches), publicIds)) {
      notes.push(
        `R5/R6: the term appears in ${entries.length} archive entries, of which ${publicIds.length} may be returned; the response returned ${byTag.matches.length}`,
      );
      return { ok: false, notes };
    }

    const byWord = readSearch(await probeGet(searchPath(word)), word);
    if (!byWord.ok) return { ok: false, notes: [byWord.note] };
    if (!sameSet(idsOf(byWord.matches), [near.id])) {
      notes.push(
        `R5/R6: the second term appears in 2 archive entries, of which 1 may be returned; the response returned ${byWord.matches.length}`,
      );
      return { ok: false, notes };
    }

    // Independent of the id sets above: nothing about the withheld entries may
    // appear anywhere in either response, not even outside `matches`.
    for (const [label, read] of [
      ["the first", byTag],
      ["the second", byWord],
    ]) {
      if (read.text.includes(marker)) {
        notes.push(`R6: ${label} response carried text that only a withheld archive entry contains`);
        return { ok: false, notes };
      }
      for (const id of draftIds) {
        if (read.text.includes(String(id))) {
          notes.push(`R6: ${label} response mentioned the id of an entry that may not be returned`);
          return { ok: false, notes };
        }
      }
    }
    return { ok: true, notes: [] };
  });
}

/**
 * `results_are_text` — the search page shows what people wrote, as text.
 *
 * The graded markers are tag-shaped (`<tc-probe-...>`), so escaping removes them
 * from the response entirely — assert the absence of something that survives
 * escaping (`onerror=` does) and no correct implementation can ever pass.
 *
 * The whole response is graded, not a fragment of it. A fragment would have to
 * be delimited by markers the participant's own string sits next to, and a
 * renderer that emits the closing delimiter itself would move the payload
 * outside the region the grader looks at. The shell this module wraps around the
 * fragment is a fixed string that contains none of the per-batch markers, so
 * grading all of it costs nothing.
 */
async function probeText() {
  const tag = probeTag();
  const nonce = randomBytes(8).toString("hex");
  const rawTitle = `<img src=x onerror="alert(1)"> <tc-probe-${nonce}>`;
  const rawAuthor = `<b>${nonce}-author</b>`;
  const escapedTitle = `&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &lt;tc-probe-${nonce}&gt;`;
  const escapedAuthor = `&lt;b&gt;${nonce}-author&lt;/b&gt;`;
  const entry = probeEntry({
    title: rawTitle,
    author: rawAuthor,
    body: `添付あり ${tag}`,
    visibility: "public",
  });
  const rawQuery = `<tc-query-${nonce}>`;

  return withBatch([entry], async () => {
    const notes = [];
    const page = await probeGet(`/search?q=${encodeURIComponent(tag)}`);
    if (page.status !== 200) {
      notes.push(`R9: GET /search should answer 200 for an ordinary term, got ${page.status}`);
      return { ok: false, notes };
    }
    if (!page.text.includes(escapedTitle)) {
      notes.push(
        "R9: the matched entry's title did not appear on the page with every character intact and the five characters replaced by entity references",
      );
      return { ok: false, notes };
    }
    if (!page.text.includes(escapedAuthor)) {
      notes.push("R9: the matched entry's author did not appear on the page the same way");
      return { ok: false, notes };
    }

    const echoed = await probeGet(`/search?q=${encodeURIComponent(rawQuery)}`);
    if (echoed.status !== 200) {
      notes.push(`R8/R9: a term nothing matches should still render a page, got ${echoed.status}`);
      return { ok: false, notes };
    }
    if (!echoed.text.includes(`&lt;tc-query-${nonce}&gt;`)) {
      notes.push("R9: the search term itself was not shown on the page as text");
      return { ok: false, notes };
    }

    // Only now: the same characters must not also be present in a form a browser
    // would read as markup.
    const forbidden = [
      [page.text, `<tc-probe-${nonce}>`],
      [page.text, "<img "],
      [page.text, rawAuthor],
      [echoed.text, rawQuery],
    ];
    for (const [text, needle] of forbidden) {
      if (text.includes(needle)) {
        notes.push("R9: some of it reached the page as markup rather than as text");
        return { ok: false, notes };
      }
    }
    return { ok: true, notes: [] };
  });
}

const GROUPS = {
  search_answers: probeAnswers,
  search_order: probeOrder,
  search_bad_queries: probeBadQueries,
  drafts_withheld: probeDrafts,
  results_are_text: probeText,
};

const GATE_NAMES = Object.keys(GROUPS);

// ---------------------------------------------------------------------------
// measurement
// ---------------------------------------------------------------------------

/**
 * One measurement at a time.
 *
 * Batches inject into the shared corpus and read the result back over loopback;
 * two at once would each see the other's entries. The queue is bounded so a
 * participant's own code calling back into the app cannot pile up work forever —
 * past the bound the request is refused rather than parked.
 */
const MAX_QUEUED = 3;
let queue = Promise.resolve();
let queued = 0;

function serialize(task) {
  if (queued >= MAX_QUEUED) return Promise.resolve(null);
  queued += 1;
  const run = queue.then(task, task).finally(() => {
    queued -= 1;
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** @type {Record<string, { ok: boolean, stamp: string, notes: string[], at: string }>} */
const lastMeasured = {};

/**
 * Run the named gate groups against the running app and record what was seen.
 *
 * @returns the report, or `null` when the queue was already full.
 */
function runMeasured(names) {
  return serialize(async () => {
    const stamp = featureStamp();
    const gates = {};
    const notes = {};
    for (const name of names) {
      let result;
      try {
        result = await GROUPS[name]();
      } catch (error) {
        result = { ok: false, notes: [`the probe itself failed: ${error.message}`] };
      }
      gates[name] = result.ok === true;
      notes[name] = result.notes;
      lastMeasured[name] = {
        ok: gates[name],
        stamp: stamp.value,
        notes: result.notes,
        at: new Date().toISOString(),
      };
    }
    return { gates, notes, featureError: stamp.ok ? null : stamp.error };
  });
}

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

/**
 * The search page's shell.
 *
 * The fragment goes in unescaped on purpose: escaping it here would mean this
 * module, not the participant, decides how their output is displayed, and there
 * would be nothing left to measure. The response therefore carries a
 * `Content-Security-Policy` that permits nothing and sandboxes the document, so
 * the page cannot execute anything even when the fragment is exactly the mistake
 * this problem is about. That header is not a scoring device and cannot be
 * turned off from the feature file: the participant's code returns a string and
 * never touches this response.
 */
function sendPage(response, status, fragment) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": "default-src 'none'; sandbox",
    "x-content-type-options": "nosniff",
  });
  response.end(`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>archive search</title></head>
<body style="font-family:system-ui;max-width:44rem;margin:2.5rem auto;line-height:1.7;padding:0 1rem">
<h1>アーカイブ検索</h1>
<p>この下は <code>renderResults</code> が返した HTML をそのまま置いた領域です。</p>
<hr>
${fragment}
<hr>
<p><a href="api/spec">仕様</a> / <a href="api/selfcheck">自己検査</a> / <a href="posture">posture</a></p>
</body></html>`);
}

const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

/**
 * Ask the participant's `search` and check the envelope it came back in.
 *
 * The status and body are theirs — R1 and R2 are their rules to implement — but
 * a value that is not a `{ status, body }` at all is a loading failure rather
 * than an answer, and saying so beats publishing `undefined` as if it were one.
 */
async function runSearch(rawQuery) {
  const called = await callFeature("search", { query: rawQuery, posts: corpus() });
  if (!called.ok) return { ok: false, status: 503, error: "feature_unloadable", detail: called.error };
  const value = called.value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      status: 500,
      error: "feature_bad_response",
      detail: "search must return an object shaped { status, body }",
    };
  }
  if (!Number.isInteger(value.status) || value.status < 200 || value.status > 599) {
    return {
      ok: false,
      status: 500,
      error: "feature_bad_response",
      detail: `search returned status=${JSON.stringify(value.status)}; it must be an integer HTTP status`,
    };
  }
  if (value.body === null || typeof value.body !== "object" || Array.isArray(value.body)) {
    return {
      ok: false,
      status: 500,
      error: "feature_bad_response",
      detail: "search must return body as a JSON object",
    };
  }
  return { ok: true, status: value.status, body: value.body };
}

export const routes = {
  "GET /api/spec": (request, response) => sendJson(response, 200, SPEC),

  "GET /api/search": async (request, response, url) => {
    const result = await runSearch(url.searchParams.get("q"));
    if (!result.ok) {
      return sendJson(response, result.status, {
        error: result.error,
        detail: result.detail,
        feature: FEATURE_LABEL,
      });
    }
    return sendJson(response, result.status, result.body);
  },

  "GET /search": async (request, response, url) => {
    const raw = url.searchParams.get("q");
    const result = await runSearch(raw);
    if (!result.ok) {
      return sendPage(
        response,
        result.status,
        `<p><code>${escapeHtml(result.error)}</code></p><p>${escapeHtml(result.detail)}</p><p>${escapeHtml(FEATURE_LABEL)}</p>`,
      );
    }
    if (result.status !== 200) {
      return sendPage(
        response,
        result.status,
        `<p>検索できませんでした: <code>${escapeHtml(String(result.body.error ?? result.status))}</code></p>`,
      );
    }
    const matches = Array.isArray(result.body.matches) ? result.body.matches : [];
    const rendered = await callFeature("renderResults", {
      query: typeof result.body.query === "string" ? result.body.query : String(raw ?? ""),
      matches,
    });
    if (!rendered.ok) {
      return sendPage(
        response,
        503,
        `<p><code>feature_unloadable</code></p><p>${escapeHtml(rendered.error)}</p>`,
      );
    }
    if (typeof rendered.value !== "string") {
      return sendPage(
        response,
        500,
        `<p><code>feature_bad_response</code></p><p>${escapeHtml("renderResults must return an HTML string")}</p>`,
      );
    }
    return sendPage(response, 200, rendered.value);
  },

  /**
   * The public face of the archive.
   *
   * It is the corpus with the non-public entries taken out — which is what every
   * public surface of this app shows, and not what `search` is handed.
   */
  "GET /api/archive": (request, response) => {
    const entries = corpus().filter((entry) => entry.visibility === "public");
    return sendJson(response, 200, { count: entries.length, entries });
  },

  "GET /api/feature": async (request, response) => {
    const stamp = featureStamp();
    if (!stamp.ok) {
      return sendJson(response, 200, {
        feature: FEATURE_LABEL,
        loaded: false,
        error: stamp.error,
        exports: [],
      });
    }
    const called = await callFeature("__exports", null);
    return sendJson(response, 200, {
      feature: FEATURE_LABEL,
      loaded: called.ok,
      error: called.ok ? null : called.error,
      exports: called.ok ? called.value : [],
      required: Object.keys(SPEC.exports),
    });
  },

  /**
   * The measurement, on demand.
   *
   * It runs exactly what scoring runs, against freshly built archive entries, and
   * reports which rule failed and what came back instead. It never reports a
   * receipt: those live on `/posture`, and only while the gate behind them is
   * true.
   */
  "GET /api/selfcheck": async (request, response) => {
    const report = await runMeasured(GATE_NAMES);
    if (report === null) {
      return sendJson(response, 409, {
        error: "selfcheck_busy",
        detail: "a measurement is already running; try again in a moment",
      });
    }
    return sendJson(response, 200, {
      feature: FEATURE_LABEL,
      featureError: report.featureError,
      allGreen: GATE_NAMES.every((name) => report.gates[name] === true),
      checks: GATE_NAMES.map((name) => ({
        gate: name,
        ok: report.gates[name] === true,
        notes: report.notes[name] ?? [],
      })),
      next: "全部 ok になったら GET /posture の tokens に受領印が出ます。",
    });
  },
};

// ---------------------------------------------------------------------------
// posture
// ---------------------------------------------------------------------------

export const gateTokens = true;

/**
 * A gate is green when the last measurement of *this* version of the feature
 * file said so.
 *
 * Keyed on the file's stamp rather than on a clock: a participant who saves a
 * change has, by definition, not been measured yet, so the receipt goes away the
 * moment the thing it is a receipt for changes. Nothing here re-measures —
 * `/posture` is a report, and running probes from a page a participant refreshes
 * would let them drive the app into itself.
 */
export function postureContext() {
  const stamp = featureStamp();
  const green = (name) => {
    const measured = lastMeasured[name];
    return stamp.ok && measured !== undefined && measured.stamp === stamp.value && measured.ok === true;
  };
  const state = {};
  for (const name of GATE_NAMES) state[name] = green(name);
  return { vibe: state };
}

/**
 * Five gates, one per checkpoint, none implied by another: search can answer
 * while the ordering is wrong, the ordering can be right while broken input is
 * accepted, and every one of those can be right while the page publishes markup
 * or the withheld entries leak.
 */
export const gates = {
  /** The feature answers, about the posts the term is actually in. */
  search_answers: (context) => context.vibe.search_answers === true,
  /** ...and the list is ordered and cut the way the spec says. */
  search_order: (context) => context.vibe.search_order === true,
  /** ...and a broken search term is refused by name, without breaking the good ones. */
  search_bad_queries: (context) => context.vibe.search_bad_queries === true,
  /** ...and what comes back is the public part of the archive, and only that. */
  drafts_withheld: (context) => context.vibe.drafts_withheld === true,
  /** ...and the page shows what people wrote as text. */
  results_are_text: (context) => context.vibe.results_are_text === true,
};

// ---------------------------------------------------------------------------
// checkpoints
// ---------------------------------------------------------------------------

const matches = (submission, expected) => submission.trim() === expected;

/**
 * Every checkpoint is the same two facts.
 *
 * First the app re-measures, right now, with archive entries that did not exist
 * when the submission was made — so a receipt kept from an earlier green run
 * cannot outlive the implementation that earned it. Then the submission has to
 * be that gate's receipt, which `/posture` only ever emits while the gate is
 * true and which is namespaced per gate, so one gate's receipt cannot answer
 * another's checkpoint.
 */
/**
 * Wait for a measurement slot rather than scoring the participant for the load.
 *
 * `serialize` declines past `MAX_QUEUED` so a participant's own code calling
 * back into the app cannot pile up work forever. That bound is right for
 * `/api/selfcheck`, which answers 409 and asks them to try again — the
 * participant sees the refusal and retries.
 *
 * It is wrong for `/verify`. The `multi-verify` contract carries a boolean, so
 * a declined measurement reaching `graded` becomes `correct: false`, which is
 * indistinguishable from a wrong receipt and costs the participant a wrong-
 * answer penalty for a queue they did not create. Nothing in the response
 * would say why.
 *
 * So the scorer waits: a few short retries, which is far below the platform's
 * verify timeout and far above the time a batch takes. Only if the queue is
 * still saturated after that does it give up — at which point the app really is
 * wedged, and a failed checkpoint is the least of it.
 */
async function measuredForScoring(gate, attempts = 12, waitMs = 250) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const report = await runMeasured([gate]);
    if (report !== null) return report;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return null;
}

async function graded(gate, submission) {
  const report = await measuredForScoring(gate);
  if (report === null || report.gates[gate] !== true) return false;
  return matches(submission, gateToken(gate));
}

export const checks = {
  "search-answers": (submission) => graded("search_answers", submission),
  "search-order": (submission) => graded("search_order", submission),
  "search-bad-queries": (submission) => graded("search_bad_queries", submission),
  "drafts-withheld": (submission) => graded("drafts_withheld", submission),
  "results-are-text": (submission) => graded("results_are_text", submission),
};
