import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { log } from "./log.mjs";

/**
 * The app's runtime configuration, read from a file the participant owns.
 *
 * The file is bind-mounted read-only from their checkout, so editing it is a
 * real edit to a real file — not a toggle in a UI the problem controls. It is
 * re-read on every request rather than cached at boot, so a saved edit takes
 * effect immediately: an onboarding step must not hide behind "now restart the
 * container".
 *
 * A missing or malformed file is NOT silently replaced by defaults. The values
 * fall back so the app still answers (a participant who breaks the JSON must
 * still be able to reach `/healthz` to find out why), but the failure is
 * reported on `/healthz`, written to the log, and visible in `/posture`.
 */

const CONFIG_PATH = process.env.APP_CONFIG ?? "/app/config/app.json";

/**
 * 実行中に変えた設定の置き場。
 *
 * マウント元のファイルを書き換える方向は採らない — あれは checkout の中の git 管理下の
 * ファイルなので、 書いた瞬間に作業ツリーが汚れ、 コンテナを作り直しても内容が残る。
 * つまり「一度解いたらその checkout に二周目が無い」状態になる。
 *
 * 永続ボリュームに置く方向も採らない — 消し方を知っている人しかやり直せなくなる。
 * `/tmp` はコンテナと一緒に消えるので、 作り直しがそのままリセットになる。
 */
const OVERRIDE_PATH = process.env.APP_CONFIG_OVERRIDE ?? "/tmp/stackstack-config.json";

const DEFAULTS = {
  boardTitle: "board",
  acceptingPosts: false,
};

/**
 * Only known keys are adopted, and only at the declared type.
 *
 * A key that is missing, misspelled, or the wrong type is reported rather than
 * quietly ignored. `acceptingPost: true` and `"acceptingPosts": "true"` are the
 * two edits a participant actually makes by accident, and both would otherwise
 * leave the board closed with nothing anywhere saying why.
 */
function coerce(raw) {
  const problems = [];
  const value = { ...DEFAULTS };
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    if (!(key in raw)) {
      problems.push(`${key} is missing`);
      continue;
    }
    if (typeof raw[key] !== typeof fallback) {
      problems.push(`${key} must be ${typeof fallback}, got ${typeof raw[key]}`);
      continue;
    }
    value[key] = raw[key];
  }
  for (const key of Object.keys(raw)) {
    if (!(key in DEFAULTS)) problems.push(`${key} is not a setting this app reads`);
  }
  return { value, problems };
}

let lastError = null;

/**
 * Read the config as it is on disk right now.
 * @returns {{ ok: boolean, value: typeof DEFAULTS, error: string | null }}
 */
export function readConfig(path = CONFIG_PATH) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return report(`cannot read ${path}: ${error.code ?? error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return report(`${path} is not valid JSON: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return report(`${path} must contain a JSON object`);
  }
  const { value, problems } = coerce({ ...parsed, ...readOverride() });
  if (problems.length > 0) return report(problems.join("; "), value);
  if (lastError !== null) {
    lastError = null;
    log("info", "config reloaded cleanly");
  }
  return { ok: true, value, error: null };
}

/** Log a config failure once per distinct message, so a reload loop cannot flood the ring. */
function report(error, value = { ...DEFAULTS }) {
  if (lastError !== error) {
    lastError = error;
    log("error", `config error: ${error}`);
  }
  return { ok: false, value, error };
}

export const CONFIG_FILE = CONFIG_PATH;


/**
 * 実行中に変えた分。 読めなければ「無かったこと」にする。
 *
 * 壊れた上書きを報告する方向は採らない — これを書くのは API だけで、 参加者が手で編集する
 * 面ではない。 報告しても直す手段が無い相手に見せることになる。 マウント元 (参加者が
 * 触れるファイル) の JSON 破損は従来どおり `/healthz` と `/posture` に出る。
 */
function readOverride() {
  try {
    const parsed = JSON.parse(readFileSync(OVERRIDE_PATH, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 設定を 1 つ以上変える。 受け付けた結果を返す。
 *
 * 部分適用はしない — 3 つ送って 2 つだけ通ると、 参加者は `/api/board` を見るまで何が
 * 効いたか分からない。 1 つでも弾かれたら全部やめて理由を返す。
 *
 * @param {Record<string, unknown>} patch
 * @returns {{ ok: boolean, value?: typeof DEFAULTS, problems?: string[] }}
 */
export function applyConfigChange(patch) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    return { ok: false, problems: ["the body must be a JSON object"] };
  }
  const merged = { ...readConfig().value, ...readOverride(), ...patch };
  const { value, problems } = coerce(merged);
  if (problems.length > 0) return { ok: false, problems };
  const next = { ...readOverride(), ...patch };
  try {
    writeFileSync(OVERRIDE_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch (error) {
    return { ok: false, problems: [`cannot save the change: ${error.code ?? error.message}`] };
  }
  log("info", `config changed via API: ${Object.keys(patch).join(", ")}`);
  return { ok: true, value };
}

/** 実行中に変えた分を捨て、 マウント元のファイルだけの状態に戻す。 */
export function resetConfigChanges() {
  try {
    rmSync(OVERRIDE_PATH, { force: true });
  } catch {
    // 消せない = 元から無い。 呼び出し側にとっては同じ結果なので黙る。
  }
  log("info", "config changes discarded");
  return readConfig();
}
