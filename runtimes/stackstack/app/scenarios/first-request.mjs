import { createHash } from "node:crypto";
import { log } from "../log.mjs";
import { posture } from "../posture.mjs";
import { READY_TOKEN } from "../secrets.mjs";

/**
 * The first-request scenario: the evening before day one, and the very first
 * conversation with a web app — chapter 0 of the stackstack-route.
 *
 * The participant has never spoken HTTP on purpose. The lesson is the round
 * trip itself, three times over:
 *
 *   read      `GET /api/postcard` — a request goes out, a response comes back,
 *             and the response carries the value you need next
 *   repair    `GET /api/door` — a 400 is not a wall, it is the app telling you
 *             how to ask again; the fix is a query parameter
 *   write     `POST /api/guestbook` — a request can carry a body, and the app
 *             answers 201 with a receipt or 400 with the reason
 *
 * No vulnerability, no trap, no config editing — that starts with onboarding
 * (order 10). Everything here is answerable from the API console at `/docs`,
 * in the browser, and every value worth submitting is derived from the
 * per-deploy `FLAG_SEED`, so no answer is committed and no two deploys agree.
 */

const FLAG_SEED = process.env.FLAG_SEED ?? "local-dev-seed";

/** Namespaced under `first-request:` so it can never collide with the board's own derivations. */
function firstRequestDigest(namespace) {
  return createHash("sha256").update(`first-request:${namespace}:${FLAG_SEED}`).digest("hex");
}

/**
 * The value on the postcard. Deliberately not `TC{...}`-shaped: it is a
 * password for the door, and its job is to be carried into the next request,
 * not to look like a flag.
 */
const POSTCARD_TOKEN = `postcard-${firstRequestDigest("postcard").slice(0, 12)}`;

/** Behind the door. Only ever served to a request that carried the right key. */
const DOOR_TOKEN = `TC{door_${firstRequestDigest("door").slice(0, 16)}}`;

/** The receipt for a guestbook entry that the app actually accepted. */
const GUESTBOOK_RECEIPT = `TC{guestbook_${firstRequestDigest("guestbook").slice(0, 16)}}`;

export const seedPosts = [
  {
    author: "cto",
    title: "明日からよろしく。この板は練習用です",
    body: "ここはデモ板で、全部このコンテナの中だけで動いています。クラウドのアカウントも課金もありません。何をどう壊しても、コンテナを作り直せば元に戻ります。今夜は好きなだけ試してください。",
    at: "2026-04-05T19:00:00.000Z",
  },
  {
    author: "cto",
    title: "今夜の宿題: この板と 3 回話す",
    body: "板の docs (API コンソール) の「任意の API を試す」から、次の 3 つを実行してみてください。(1) GET /api/postcard — 葉書を読む。(2) GET /api/door — 扉を開ける。最初は断られますが、返ってきたエラーが開け方を教えてくれます。(3) POST /api/guestbook — 芳名帳に一言。body は {\"name\":\"...\",\"message\":\"...\"} です。3 つ終わったら GET /posture で確かめてください。",
    at: "2026-04-05T19:05:00.000Z",
  },
];

/**
 * Checkpoints this participant has already answered correctly.
 *
 * Same rule as onboarding: a value that is only ever printed in one response is
 * itself proof the response was read, so a correct answer counts the same as
 * the request would have — including after a container restart, when the
 * `observed` set and this scenario's own state start empty again.
 */
const proven = new Set();

/** Set only by a `GET /api/door` request that carried the right key. */
let doorOpened = false;

/** Guestbook entries the app accepted, oldest first. */
const entries = [];

export const gates = {
  /** The postcard came back to somebody: the first round trip completed. */
  postcard_read: (context) => context.observed.has("GET /api/postcard") || proven.has("postcard"),
  /** A request with the right key actually opened the door. */
  door_opened: () => doorOpened || proven.has("locked-door"),
  /** The guestbook accepted at least one entry. */
  message_left: () => entries.length > 0 || proven.has("guestbook"),
};

/** Free-form answers are compared after trimming; nothing here is case-folded. */
const matches = (submission, expected) => submission.trim() === expected;

/** Record a correct answer so the matching gate can count it, and pass the verdict through. */
function remember(checkpointId, correct) {
  if (correct) proven.add(checkpointId);
  return correct;
}

export const checks = {
  postcard: (submission) => remember("postcard", matches(submission, POSTCARD_TOKEN)),

  "locked-door": (submission) => remember("locked-door", matches(submission, DOOR_TOKEN)),

  guestbook: (submission) => remember("guestbook", matches(submission, GUESTBOOK_RECEIPT)),

  /**
   * The round-trip token. `/posture` withholds it until every gate above is
   * green, so this checkpoint is exactly "all three conversations happened".
   */
  "round-trip": (submission) => posture({ gates }).ready && matches(submission, READY_TOKEN),
};

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(body);
}

const MAX_BODY_BYTES = 16 * 1024;

function readJson(request) {
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        request.pause();
        resolve({ tooLarge: true });
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve({ value: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      } catch {
        resolve({ value: null });
      }
    });
    request.on("error", () => resolve({ value: null }));
  });
}

export const routes = {
  "GET /api/postcard": (request, response) => {
    return sendJson(response, 200, {
      from: "cto",
      message:
        "届いた。これがリクエストとレスポンスの一往復です。下の token が扉 (GET /api/door) の合言葉 — 次のリクエストに持っていってください。 / Delivered. That was one full request-response round trip. The token below is the password for the door (GET /api/door) — carry it into your next request.",
      token: POSTCARD_TOKEN,
    });
  },

  "GET /api/door": (request, response, url) => {
    const key = url.searchParams.get("key");
    if (key === null || key.trim() === "") {
      log("info", "door refused: no key");
      return sendJson(response, 400, {
        error: "key_required",
        detail:
          "?key=<合言葉> を付けてもう一度。合言葉は葉書 (GET /api/postcard) に書いてあります。 / Add ?key=<the token from GET /api/postcard> and ask again.",
      });
    }
    if (key.trim() !== POSTCARD_TOKEN) {
      log("info", "door refused: wrong key");
      return sendJson(response, 400, {
        error: "wrong_key",
        detail:
          "その合言葉ではありません。葉書 (GET /api/postcard) の token をそのまま使ってください。 / Not that one. Use the token from GET /api/postcard exactly as printed.",
      });
    }
    doorOpened = true;
    log("info", "door opened with the postcard key");
    return sendJson(response, 200, {
      message:
        "開きました。400 は行き止まりではなく、頼み方の直し方でした。 / Open. A 400 was never a dead end — it told you how to fix the request.",
      token: DOOR_TOKEN,
    });
  },

  "GET /api/guestbook": (request, response) => {
    return sendJson(response, 200, {
      entries: entries.map((entry) => ({ name: entry.name, message: entry.message, at: entry.at })),
    });
  },

  "POST /api/guestbook": async (request, response) => {
    const parsed = await readJson(request);
    if (parsed.tooLarge === true) {
      return sendJson(response, 413, { error: `body must be at most ${MAX_BODY_BYTES} bytes` });
    }
    const raw = parsed.value;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return sendJson(response, 400, {
        error: "rejected",
        detail:
          'body は JSON オブジェクトです。例: {"name":"あなたの名前","message":"ひとこと"} / The body must be a JSON object, e.g. {"name":"you","message":"hello"}.',
      });
    }
    if (typeof raw.name !== "string" || raw.name.trim() === "" || raw.name.length > 200) {
      return sendJson(response, 400, {
        error: "rejected",
        detail: "name は 1〜200 文字の文字列です。 / name must be a string of 1-200 characters.",
      });
    }
    if (
      typeof raw.message !== "string" ||
      raw.message.trim() === "" ||
      raw.message.length > 2000
    ) {
      return sendJson(response, 400, {
        error: "rejected",
        detail:
          "message は 1〜2000 文字の文字列です。 / message must be a string of 1-2000 characters.",
      });
    }
    const entry = {
      name: raw.name.trim(),
      message: raw.message.trim(),
      at: new Date().toISOString(),
    };
    entries.push(entry);
    log("info", `guestbook entry accepted from ${entry.name}`);
    return sendJson(response, 201, { receipt: GUESTBOOK_RECEIPT, entry, total: entries.length });
  },
};
