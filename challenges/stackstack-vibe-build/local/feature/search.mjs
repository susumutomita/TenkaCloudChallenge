/**
 * 掲示板アーカイブの検索機能 (JavaScript)。
 *
 * 要件は走っているアプリが持っています: `GET /api/spec` (R1〜R9)。
 * このファイルは読み取り専用でコンテナにマウントされ、 変更するたびに読み直されます。
 * 再起動は要りません。 保存した瞬間から `GET /api/search` と `GET /search` が
 * ここのコードを呼びます。
 *
 * 生成 AI に書かせて構いません (むしろ推奨です)。 採点はこのファイルの中身を読みません。
 * 走っているアプリに実際の HTTP リクエストを投げ、 返ってきたものだけで決まります。
 * 貼ったら信じる前に `GET /api/selfcheck` を 1 回通してください。
 */

/**
 * @param {{ query: string | null, posts: Array<{ id: number, title: string, author: string, body: string, at: string, visibility: string }> }} input
 * @returns {{ status: number, body: object }}
 */
export function search({ query, posts }) {
  // R3 / R4 の土台: 検索語を trim して echo し、 matches は 4 キーだけにする。
  // まだ: R1/R2 の断り、 R5 の一致判定、 R6 の公開範囲、 R7 の並びと件数、 R8 の 0 件。
  const q = typeof query === "string" ? query.trim() : "";
  const matches = posts.map((post) => ({
    at: post.at,
    author: post.author,
    id: post.id,
    title: post.title,
  }));
  return { status: 200, body: { query: q, matches } };
}

/**
 * @param {{ query: string, matches: Array<{ id: number, title: string, author: string, at: string }> }} input
 * @returns {string} 検索結果ページに埋め込む HTML
 */
export function renderResults({ query, matches }) {
  // まだ R9 は未実装。 検索語と title / author を文字として出すこと。
  return "<p>検索結果の表示はまだ実装されていません。</p>";
}
