/**
 * 参加者が実行中に変えた設定の置き場。
 *
 * マウント元のファイルを書き換える方向は採らない — あれは checkout の中の git 管理下の
 * ファイルなので、 書いた瞬間に作業ツリーが汚れ、 コンテナを作り直しても内容が残る。
 * つまり「一度解いたらその checkout に二周目が無い」状態になる。
 *
 * 永続ボリュームに置く方向も採らない — 消し方を知っている人しかやり直せなくなる。
 * `/tmp` はコンテナと一緒に消えるので、 作り直しがそのままリセットになる。
 *
 * 検証はここでしない。 設定の形は scenario ごとに違い (板は 2 つの値、 access policy は
 * ルールの配列)、 それぞれ既に自分の validator を持っている。 ここが持つのは
 * 「マウント元に上書きを重ねて生の object を返す」 ことだけで、 妥当性の判断は呼び出し側に
 * 残す — 二重に持つと、 片方だけ直された仕様がもう片方に残る。
 */

import { readFileSync, rmSync, writeFileSync } from "node:fs";

const OVERRIDE_DIR = process.env.APP_OVERRIDE_DIR ?? "/tmp";

function overridePath(name) {
  return `${OVERRIDE_DIR}/stackstack-${name}.json`;
}

/**
 * 実行中に変えた分。 読めなければ「無かったこと」にする。
 *
 * 壊れた上書きを報告する方向は採らない — ここを書くのは API だけで、 参加者が手で編集する
 * 面ではない。 報告しても直す手段が無い相手に見せることになる。 参加者が触れるマウント元の
 * JSON 破損は、 従来どおり各 loader が `/healthz` と `/posture` に出す。
 */
export function readOverride(name) {
  try {
    const parsed = JSON.parse(readFileSync(overridePath(name), "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** マウント元の JSON に、 実行中に変えた分を重ねた生の object。 */
export function readWithOverride(name, basePath) {
  const base = JSON.parse(readFileSync(basePath, "utf8"));
  if (base === null || typeof base !== "object" || Array.isArray(base)) return base;
  return { ...base, ...readOverride(name) };
}

/**
 * 上書きを保存する。 妥当性は呼び出し側が先に見ている前提。
 *
 * 部分適用はしない — 3 つ送って 2 つだけ通ると、 参加者は状態を読み直すまで何が効いたか
 * 分からない。 呼び出し側が 1 つでも弾いたら、 ここには来ない。
 */
export function saveOverride(name, patch) {
  const next = { ...readOverride(name), ...patch };
  try {
    writeFileSync(overridePath(name), `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `cannot save the change: ${error.code ?? error.message}` };
  }
}

/** 実行中に変えた分を捨て、 マウント元のファイルだけの状態に戻す。 */
export function clearOverride(name) {
  try {
    rmSync(overridePath(name), { force: true });
  } catch {
    // 消せない = 元から無い。 呼び出し側にとっては同じ結果なので黙る。
  }
}
