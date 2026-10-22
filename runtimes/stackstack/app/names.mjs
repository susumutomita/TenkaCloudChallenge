/**
 * 各 scenario を使う問題の名前。 API コンソールの題名がこれを使う。
 *
 * 値は `challenges/stackstack-<scenario>/metadata.json` の `name` と `i18n.en.name` と同じに保つ。
 * ずれたら `runtimes/stackstack/names.test.mjs` が落ちる。 `gameday` はカタログの問題ではないので、
 * 作戦卓の名前をそのまま持つ。
 */
export const PROBLEM_NAMES = {
  "first-request": { ja: "はじめてのリクエスト", en: "Your First Request" },
  "vibe-build": { ja: "AI が書いた検索を、 出荷できる状態にする", en: "Ship the search your AI wrote" },
  "recover": { ja: "戻さないで直す", en: "Fix It Without Rolling It Back" },
  "onboarding": { ja: "初日の 15 分", en: "The First Fifteen Minutes" },
  "observability": { ja: "黙っているアプリに口を割らせる", en: "Making a Silent App Talk" },
  "ship": { ja: "外から見えるところまで", en: "As Far As the Outside" },
  "secrets": { ja: "板に載ってしまった鍵", en: "The Key That Made It Onto the Board" },
  "safe-exposure": { ja: "誰に見せるかを決める", en: "Deciding Who Sees What" },
  "defend": { ja: "止めずに直す", en: "Fix It Without Taking It Down" },
  "gameday": { ja: "StackStack GameDay 作戦卓", en: "StackStack GameDay ops desk" },
};
