/**
 * 掲示板アーカイブの検索機能。
 *
 * 要件は走っているアプリが持っています: `GET /api/spec` (R1〜R9)。
 * このファイルは読み取り専用でコンテナにマウントされ、 変更するたびに読み直されます。
 * 再起動は要りません。 保存した瞬間から `GET /api/search` と `GET /search` が
 * ここのコードを呼びます。
 *
 * 前任の SRE が置いていったものが、 そのまま残っています。 動いてはいます。
 * 動いていることと、 出してよいものだけを出していることは別の話です。
 * `GET /api/selfcheck` が採点とまったく同じ検査を回して、 どの規則が
 * 落ちているかと 「期待した値 / 返ってきた値」 を返します。
 */

const MAX_QUERY_LENGTH = 64;
const MAX_RESULTS = 10;

/**
 * @param {{ query: string | null, posts: Array<{ id: number, title: string, author: string, body: string, at: string, visibility: string }> }} input
 * @returns {{ status: number, body: object }}
 */
export function search({ query, posts }) {
  if (typeof query !== "string" || query.trim() === "") {
    return { status: 400, body: { error: "q_required" } };
  }
  const term = query.trim();
  if (term.length > MAX_QUERY_LENGTH) {
    return { status: 400, body: { error: "q_too_long" } };
  }
  const needle = term.toLowerCase();
  const matches = posts
    .filter(
      (post) =>
        String(post.title).toLowerCase().includes(needle) ||
        String(post.body).toLowerCase().includes(needle),
    )
    .sort((left, right) => right.id - left.id)
    .slice(0, MAX_RESULTS)
    .map((post) => ({ at: post.at, author: post.author, id: post.id, title: post.title }));
  return { status: 200, body: { query: term, matches } };
}

const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

/**
 * @param {{ query: string, matches: Array<{ id: number, title: string, author: string, at: string }> }} input
 * @returns {string} 検索結果ページに埋め込む HTML
 */
export function renderResults({ query, matches }) {
  const rows = matches
    .map(
      (entry) =>
        `<li><strong>${escape(entry.title)}</strong> — ${escape(entry.author)} (${escape(entry.at)})</li>`,
    )
    .join("\n");
  return `<h2>「${escape(query)}」の検索結果</h2>
<p>${matches.length} 件</p>
<ul>
${rows}
</ul>`;
}
