/**
 * battles/ac26-crypto-battle/game/constants.ts
 *
 * この model は platform の dispatcher (trusted runtime) 上で実行され、サーバーは
 * 秘密を保持しない — commitments のみ。
 *
 * playtest で調整しうる数値をここに集約する。 いずれも issue #486 の記述をもとにした
 * 初期値 (= playtest seed) であり、数値そのものに深い意味はない。 reducer.ts / fixtures.ts
 * を含む他ファイルへ得点・クールダウンの値を直接書かない — 必ずここを import する。
 *
 * 暗号領域の定数 (hex 文字列長の上限など) は crypto/modmath.ts / crypto/group.ts 側に
 * 置く — こちらは scoring / gameplay の tunable のみを扱う。
 */

/** Feldman VSS のデフォルト閾値 (t)。 issue #486: 3-of-5。 */
export const DEFAULT_THRESHOLD = 3;

/** Feldman VSS のデフォルト share 総数 (n)。 issue #486: 3-of-5。 */
export const DEFAULT_TOTAL_SHARES = 5;

/**
 * 通常の LEAK contract 成功時の得点。 issue: "Contract success +10"。
 * fixtures.ts が contract を組み立てる際のデフォルト points として使う —
 * 実際に加点されるのは applyOp が読む ContractSpec.points (この定数そのものでは
 * ない) なので、スケジューラ (PR3) は rush 帯など別の値を points に設定してよい。
 */
export const CONTRACT_SUCCESS_POINTS = 10;

/** rush (締切間際) contract の得点レンジ。 issue: "rush +15-25"。 */
export const RUSH_CONTRACT_MIN_POINTS = 15;
export const RUSH_CONTRACT_MAX_POINTS = 25;

/** HUNT 成功時の攻撃側ボーナス。 issue: "HUNT success attacker +20-30" -> +25 を採用。 */
export const HUNT_BONUS_POINTS = 25;

/** ROTATE のクールダウン (ms)。 score cost はゼロだが、乱発を防ぐ時間コスト。 */
export const ROTATE_COOLDOWN_MS = 60_000;

/**
 * state に保持する識別子 (contractId, teamId 等) の文字数上限。 敵対的入力による
 * 巨大文字列 (メモリ/比較コストでの DoS) を弾くための防御的な上限であり、ゲーム上の
 * 意味はない。
 */
export const MAX_ID_LEN = 128;
