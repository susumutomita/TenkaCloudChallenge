/**
 * The message board itself — the one workload every StackStack problem shares.
 *
 * Posts live in memory: the board is a training target that is torn down with
 * the container, and an in-memory store keeps the image free of a database
 * dependency so the same source runs under Node in the container and under Bun
 * in CI.
 *
 * `seeded` separates the posts the board ships with from the ones a participant
 * wrote through the API. A checkpoint that wants proof of a real write can then
 * ask for a participant post specifically, instead of being satisfied by
 * furniture that was there before they arrived.
 */

const MAX_POSTS = 200;
const MAX_FIELD = 200;
const MAX_BODY = 2000;

/** @type {{ id: number, author: string, title: string, body: string, at: string, seeded: boolean }[]} */
const posts = [];
let nextId = 1;

export function resetBoard(seedPosts = []) {
  posts.length = 0;
  nextId = 1;
  for (const post of seedPosts) {
    posts.push({
      id: nextId++,
      author: post.author,
      title: post.title,
      body: post.body,
      at: post.at,
      seeded: true,
    });
  }
}

export function allPosts() {
  return posts.map((post) => ({ ...post }));
}

export function participantPosts() {
  return allPosts().filter((post) => !post.seeded);
}

/**
 * Validate a submitted post.
 * @returns {{ ok: true, post: object } | { ok: false, error: string }}
 */
export function validatePost(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  for (const field of ["author", "title"]) {
    if (typeof raw[field] !== "string" || raw[field].trim() === "") {
      return { ok: false, error: `${field} is required` };
    }
    if (raw[field].length > MAX_FIELD) {
      return { ok: false, error: `${field} must be at most ${MAX_FIELD} characters` };
    }
  }
  const body = raw.body ?? "";
  if (typeof body !== "string" || body.length > MAX_BODY) {
    return { ok: false, error: `body must be a string of at most ${MAX_BODY} characters` };
  }
  return {
    ok: true,
    post: { author: raw.author.trim(), title: raw.title.trim(), body: body.trim() },
  };
}

export function addPost({ author, title, body }, at) {
  const post = { id: nextId++, author, title, body, at, seeded: false };
  posts.push(post);
  if (posts.length > MAX_POSTS) posts.splice(0, posts.length - MAX_POSTS);
  return { ...post };
}
