import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * stackstack-vibe-build grades code the participant (or their AI tool) wrote,
 * from outside it: the app is asked over real HTTP and the answer decides.
 *
 * So does this suite. It spawns the real base app under Bun with
 * `SCENARIO=vibe-build`, writes implementations into the feature file the way a
 * participant's editor does, and asserts on responses — never on the scenario's
 * source text. The one thing a static check could never establish is the thing
 * this problem is about: whether the code that got pasted in does what was asked.
 *
 * The feature file and the board config are copied into a scratch directory
 * first. This suite rewrites the feature file constantly and must not leave the
 * repository's shipped starter replaced by a solution.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROBLEM_DIR = join(REPO_ROOT, "challenges", "stackstack-vibe-build");
const SERVER = join(REPO_ROOT, "stackstack-base", "app", "server.mjs");
const SCENARIO_FILE = join(REPO_ROOT, "stackstack-base", "app", "scenarios", "vibe-build.mjs");

// Ports reserved for this problem's suite, well clear of the catalog's
// 18080/18081 local-play convention.
const CHALLENGE_PORT = 18300;
const VERIFY_PORT = 18301;
const BOARD = `http://127.0.0.1:${CHALLENGE_PORT}`;
const VERIFY = `http://127.0.0.1:${VERIFY_PORT}/verify`;

/**
 * A seed the suite knows, so it can assert the real value never reaches the
 * participant's process. It is deliberately unmistakable in a haystack.
 */
const SEED = "stackstack-vibe-build-test-seed-8f2c41";


const CHECKPOINTS = [
  "search-answers",
  "search-order",
  "search-bad-queries",
  "drafts-withheld",
  "results-are-text",
] as const;

const GATES = [
  "search_answers",
  "search_order",
  "search_bad_queries",
  "drafts_withheld",
  "results_are_text",
] as const;

/** checkpoint id -> the gate whose receipt answers it. */
const RECEIPT_OF: Record<string, string> = {
  "search-answers": "search_answers",
  "search-order": "search_order",
  "search-bad-queries": "search_bad_queries",
  "drafts-withheld": "drafts_withheld",
  "results-are-text": "results_are_text",
};

interface Metadata {
  readonly difficulty: number;
  readonly instructions: string;
  readonly scoring: {
    readonly kind: string;
    readonly checks: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly points: number;
      readonly wrongAnswerPenalty?: number;
      readonly hints?: ReadonlyArray<{ readonly id: string; readonly penalty: number }>;
    }>;
  };
  readonly i18n: {
    readonly en: {
      readonly instructions: string;
      readonly checks: ReadonlyArray<{
        readonly id: string;
        readonly label: string;
        readonly hints?: ReadonlyArray<{ readonly id: string }>;
      }>;
    };
  };
  readonly exposedPorts: ReadonlyArray<{ readonly port: number; readonly name: string }>;
  readonly runtime: {
    readonly challengeEndpoints: Record<string, string>;
    readonly verifyUrl: string;
  };
}

const metadata = JSON.parse(readFileSync(join(PROBLEM_DIR, "metadata.json"), "utf8")) as Metadata;
const STARTER = readFileSync(join(PROBLEM_DIR, "local", "feature", "search.mjs"), "utf8");

// ---------------------------------------------------------------------------
// implementations the suite drives the app with
// ---------------------------------------------------------------------------

/**
 * A reference implementation that satisfies all nine rules.
 *
 * Every negative fixture below is this string with one thing changed, and
 * `mutate` refuses a replacement that changed nothing — a "wrong" fixture that
 * silently became identical to this one would pass every checkpoint and prove
 * the opposite of what it was written to prove.
 */
const ESCAPE_FN = `const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );`;

/** The body of a `renderResults` that satisfies R9, and the variants that do not. */
const RENDER_CORRECT = `  const rows = matches
    .map((m) => \`<li><strong>\${escape(m.title)}</strong> — \${escape(m.author)}</li>\`)
    .join("");
  return \`<p>\${escape(query)}: \${matches.length}</p><ul>\${rows}</ul>\`;`;

const RENDER_UNESCAPED = `  const rows = matches
    .map((m) => \`<li><strong>\${m.title}</strong> — \${m.author}</li>\`)
    .join("");
  return \`<p>\${escape(query)}: \${matches.length}</p><ul>\${rows}</ul>\`;`;

const RENDER_EMPTY = `  return "<p></p>";`;

const RENDER_WITHOUT_TERM = `  const rows = matches
    .map((m) => \`<li><strong>\${escape(m.title)}</strong> — \${escape(m.author)}</li>\`)
    .join("");
  return \`<p>\${matches.length}</p><ul>\${rows}</ul>\`;`;

/** Escapes the text it shows and interpolates the same value into an attribute. */
const RENDER_ATTRIBUTE_RAW = `  const rows = matches
    .map(
      (m) =>
        \`<li title="\${m.title}"><strong>\${escape(m.title)}</strong> — \${escape(m.author)}</li>\`,
    )
    .join("");
  return \`<p>\${escape(query)}: \${matches.length}</p><ul>\${rows}</ul>\`;`;

const RENDER_SKIPPING_RISKY = `  const rows = matches
    .filter((m) => !/[&<>"']/.test(String(m.title) + String(m.author)))
    .map((m) => \`<li><strong>\${escape(m.title)}</strong> — \${escape(m.author)}</li>\`)
    .join("");
  return \`<p>\${escape(query)}: \${matches.length}</p><ul>\${rows}</ul>\`;`;

/**
 * `CORRECT`, but each call sleeps.
 *
 * Used only to hold measurement slots open long enough that the queue is
 * genuinely saturated when `/verify` arrives. Well under CALL_TIMEOUT_MS, so
 * the calls still succeed and every gate still goes green — the point is the
 * timing, not a failure.
 */
const SLOW_CORRECT_DELAY_MS = 120;

const CORRECT = `${ESCAPE_FN}

export function search({ query, posts }) {
  if (typeof query !== "string" || query.trim() === "") {
    return { status: 400, body: { error: "q_required" } };
  }
  const term = query.trim();
  if (term.length > 64) return { status: 400, body: { error: "q_too_long" } };
  const needle = term.toLowerCase();
  const matches = posts
    .filter((post) => post.visibility === "public")
    .filter(
      (post) =>
        String(post.title).toLowerCase().includes(needle) ||
        String(post.body).toLowerCase().includes(needle),
    )
    .sort((left, right) => right.id - left.id)
    .slice(0, 10)
    .map((post) => ({ id: post.id, title: post.title, author: post.author, at: post.at }));
  return { status: 200, body: { query: term, matches } };
}

export function renderResults({ query, matches }) {
${RENDER_CORRECT}
}
`;

const SLOW_CORRECT = CORRECT.replace(
  "export function search({ query, posts }) {",
  `export async function search({ query, posts }) {
  await new Promise((r) => setTimeout(r, ${SLOW_CORRECT_DELAY_MS}));`,
);

function mutate(from: string, to: string): string {
  const changed = CORRECT.replace(from, to);
  if (changed === CORRECT) {
    throw new Error(`the fixture edit ${JSON.stringify(from)} matched nothing in CORRECT`);
  }
  return changed;
}

const VISIBILITY_FILTER = '.filter((post) => post.visibility === "public")\n';
const TERM_FILTER = `.filter(
      (post) =>
        String(post.title).toLowerCase().includes(needle) ||
        String(post.body).toLowerCase().includes(needle),
    )\n`;
const SORT_THEN_CUT = ".sort((left, right) => right.id - left.id)\n    .slice(0, 10)";
const ENTRY_MAP = ".map((post) => ({ id: post.id, title: post.title, author: post.author, at: post.at }))";

/** Wrong in exactly one way each, and named for the wrong idea rather than the diff. */
const FIXTURES = {
  /** "we search everything we were handed" — the generated default. */
  noVisibilityFilter: mutate(VISIBILITY_FILTER, ""),
  /** "take ten, then sort" — the ordering mix-up. */
  cutThenSort: mutate(SORT_THEN_CUT, ".slice(0, 10)\n    .sort((left, right) => right.id - left.id)"),
  /** "return a bit extra, just in case". */
  extraField: mutate(
    ENTRY_MAP,
    ".map((post) => ({ id: post.id, title: post.title, author: post.author, at: post.at, body: post.body }))",
  ),
  /** "the query already told us what matched" — no filtering at all. */
  matchEverything: mutate(TERM_FILTER, ""),
  /** interpolating straight into the template literal. */
  unescaped: mutate(RENDER_CORRECT, RENDER_UNESCAPED),
  /** escapes the visible text and forgets the attribute holding the same value. */
  rawInAnAttribute: mutate(RENDER_CORRECT, RENDER_ATTRIBUTE_RAW),
  /** searches the title and never the body. */
  titleOnly: mutate(TERM_FILTER, ".filter((post) => String(post.title).toLowerCase().includes(needle))\n"),
  /** "sanitising" by deleting the dangerous characters. */
  strippedTags: mutate(ESCAPE_FN, `const escape = (text) => String(text).replace(/[&<>"']/g, "");`),
  /** the ids are right and the values are not — "we only really return ids". */
  redactsValues: mutate(
    ENTRY_MAP,
    '.map((post) => ({ id: post.id, title: "(redacted)", author: post.author, at: post.at }))',
  ),
  /** checks that a term is present and never that it is short enough. */
  skipsLengthCheck: mutate(
    '  if (term.length > 64) return { status: 400, body: { error: "q_too_long" } };\n',
    "",
  ),
  /** refuses the right inputs under a name of its own invention. */
  wrongErrorName: mutate('{ error: "q_required" }', '{ error: "bad_request" }'),
  /** names the refusal correctly and answers 200 anyway. */
  refusesWith200: mutate(
    '{ status: 400, body: { error: "q_required" } }',
    '{ status: 200, body: { error: "q_required" } }',
  ),
  /** compares the term to the text without folding either. */
  caseSensitive: mutate("  const needle = term.toLowerCase();", "  const needle = term;"),
  /** refuses the limit itself — the boundary landed one character early. */
  offByOneBoundary: mutate("if (term.length > 64)", "if (term.length >= 64)"),
  /** "found nothing? show them the latest instead" — helpful, and not the spec. */
  showsAllOnNoHit: mutate(
    "  return { status: 200, body: { query: term, matches } };",
    `  const shown =
    matches.length > 0
      ? matches
      : posts
          .filter((post) => post.visibility === "public")
          .sort((left, right) => right.id - left.id)
          .slice(0, 10)
          .map((post) => ({ id: post.id, title: post.title, author: post.author, at: post.at }));
  return { status: 200, body: { query: term, matches: shown } };`,
  ),
  /** the filtering is right, and the response carries the corpus anyway. */
  debugDump: mutate(
    "return { status: 200, body: { query: term, matches } };",
    "return { status: 200, body: { query: term, matches, debug: posts } };",
  ),
  /** applies the publish rule only to inputs that look like the grader's. */
  grinderSniffer: mutate(
    VISIBILITY_FILTER,
    '.filter((post) => (/^[0-9a-f]{16}$/.test(needle) ? post.visibility === "public" : true))\n',
  ),
  /** withholds correctly and publishes nothing — the vacuous "fix". */
  withholdsEverything: mutate(ENTRY_MAP, ".slice(0, 0)"),
  /** renders nothing at all. */
  rendersNothing: mutate(RENDER_CORRECT, RENDER_EMPTY),
  /** renders, but drops anything whose text looks dangerous. */
  hidesRiskyRows: mutate(RENDER_CORRECT, RENDER_SKIPPING_RISKY),
  /** renders the entries but never the term. */
  swallowsTheTerm: mutate(RENDER_CORRECT, RENDER_WITHOUT_TERM),
} as const;

/** Refuses every input: "nothing broken gets in if nothing gets in". */
const ALWAYS_400 = `export function search() {
  return { status: 400, body: { error: "q_required" } };
}
export function renderResults() {
  return "<p>no</p>";
}
`;

/**
 * Tries to read the container's secrets from inside the participant's code.
 *
 * The `secrets.mjs` import is the one that matters: in the container the feature
 * file sits at `/app/feature/search.mjs`, so `../secrets.mjs` really does
 * resolve to the module that mints the receipts. The absolute path here stands
 * in for that layout, because the suite's scratch directory is not next to it.
 */
const SECRETS_MODULE = join(REPO_ROOT, "stackstack-base", "app", "secrets.mjs");

const SEED_THIEF = `import { readFileSync } from "node:fs";

let stolen = "secrets=unreachable";
try {
  const secrets = await import("file://${SECRETS_MODULE}");
  stolen = "gate=" + secrets.gateToken("drafts_withheld") + " ready=" + secrets.READY_TOKEN;
} catch (error) {
  stolen = "secrets=unreachable:" + (error.code ?? error.message);
}

function peek() {
  const bits = [
    "env=" + (process.env.FLAG_SEED ?? "absent"),
    "envKeys=" + Object.keys(process.env).length,
    stolen,
  ];
  for (const path of ["/proc/self/environ"]) {
    try {
      bits.push(path + "=" + readFileSync(path, "utf8").replace(/\\u0000/g, " "));
    } catch (error) {
      bits.push(path + "=unreadable:" + (error.code ?? error.message));
    }
  }
  return bits.join(" | ");
}

export function search({ query }) {
  return { status: 200, body: { query: String(query ?? "").trim(), matches: [], peek: peek() } };
}
export function renderResults() {
  return "<p>" + peek() + "</p>";
}
`;

/**
 * Records every search term and every probe row it is ever handed, and reports
 * them back when asked for `__report__`.
 *
 * This is the only vantage point from which the freshness of the probe inputs
 * can actually be observed: from inside the code being graded, which is exactly
 * where an implementation that wanted to memorise them would sit.
 */
const INPUT_RECORDER = `const seenQueries = new Set();
const seenRows = new Set();

export function search({ query, posts }) {
  const term = String(query ?? "").trim();
  if (term === "__report__") {
    return {
      status: 200,
      body: { query: term, matches: [], queries: [...seenQueries], rows: [...seenRows] },
    };
  }
  seenQueries.add(term);
  for (const post of posts) {
    if (post.id >= 100000) seenRows.add(post.id + "::" + post.title + "::" + post.body);
  }
  return { status: 200, body: { query: term, matches: [] } };
}
export function renderResults() {
  return "<p></p>";
}
`;

/** A synchronous loop that never returns. */
const HANGS = `export function search() {
  const end = Date.now() + 60000;
  while (Date.now() < end) {}
  return { status: 200, body: { query: "", matches: [] } };
}
export function renderResults() {
  return "<p>x</p>";
}
`;

/** Will not parse. */
const SYNTAX_ERROR = "export function search({ query, posts) { return 1; }\n";

/** Calls back into the app it is being called by. */
const REENTRANT = `export async function search({ query }) {
  try { await fetch("${BOARD}/api/selfcheck"); } catch {}
  try { await fetch("${BOARD}/api/search?q=zz"); } catch {}
  return { status: 200, body: { query: String(query ?? "").trim(), matches: [] } };
}
export function renderResults() {
  return "<p>x</p>";
}
`;

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

let scratch = "";
let featurePath = "";
let overrideDir = "";
let configPath = "";
let server: ReturnType<typeof spawn>;
let writes = 0;

/**
 * Save an implementation the way an editor does.
 *
 * A unique trailing comment keeps the file's size different on every write: the
 * app decides whether to reload from mtime and size, and two same-size writes
 * inside one millisecond would otherwise look like no change at all.
 */
function useFeature(source: string): void {
  writes += 1;
  writeFileSync(featurePath, `${source}\n// fixture ${writes}\n`);
}

async function patchSettings(body: unknown) {
  const response = await fetch(`${BOARD}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return { status: response.status, body: parsed, text };
}

async function get(path: string): Promise<{ status: number; body: any; text: string; headers: Headers }> {
  const response = await fetch(`${BOARD}${path}`);
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: response.status, body, text, headers: response.headers };
}

async function verifyCheckpoint(checkpointId: string, submission: string) {
  const response = await fetch(VERIFY, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ checkpointId, submission, context: { teamId: "t", problemId: "p" } }),
  });
  return { status: response.status, body: (await response.json()) as any };
}

const correctOf = async (checkpointId: string, submission: string) =>
  (await verifyCheckpoint(checkpointId, submission)).body.correct as boolean;

/** Which gates the app reports green right now, after a fresh measurement. */
async function selfcheck(): Promise<Record<string, boolean>> {
  // Patient on purpose: a measurement runs one at a time, and an implementation
  // that calls back into the app can leave a short queue of its own behind.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const report = await get("/api/selfcheck");
    if (report.status === 200) {
      const state: Record<string, boolean> = {};
      for (const check of report.body.checks) state[check.gate] = check.ok;
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("the self-check never became available");
}

const greenGates = async () =>
  Object.entries(await selfcheck())
    .filter(([, ok]) => ok)
    .map(([gate]) => gate)
    .sort();

async function receipts(): Promise<Record<string, string | null>> {
  return (await get("/posture")).body.tokens as Record<string, string | null>;
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), "stackstack-vibe-build-"));
  featurePath = join(scratch, "search.mjs");
  configPath = join(scratch, "app.json");
  overrideDir = join(scratch, "overrides");
  mkdirSync(overrideDir, { recursive: true });
  writeFileSync(configPath, readFileSync(join(PROBLEM_DIR, "local", "config", "app.json")));
  useFeature(STARTER);

  server = spawn("bun", [SERVER], {
    env: {
      ...process.env,
      SCENARIO: "vibe-build",
      FLAG_SEED: SEED,
      APP_CONFIG: configPath,
      APP_FEATURE: featurePath,
      // 上書きの置き場は共有 /tmp ではなくインスタンスごとの scratch。 スイートを並走させても、
      // 前回の実行が残した上書きを拾っても、 互いに汚染しない。
      APP_OVERRIDE_DIR: overrideDir,
      CHALLENGE_PORT: String(CHALLENGE_PORT),
      VERIFY_PORT: String(VERIFY_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Piped and never read fills the OS pipe buffer, at which point the app
  // blocks on its next write and every later test times out with no signal
  // pointing at the cause. Draining costs nothing and removes the trap.
  server.stdout?.resume();
  server.stderr?.resume();

  const deadline = Date.now() + 6_000;
  for (;;) {
    try {
      if ((await fetch(`${BOARD}/healthz`)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error("the board never became healthy");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

afterAll(() => {
  server?.kill();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe("stackstack-vibe-build scoring regulation", () => {
  it("should be a Medium-tier problem worth exactly 200 points", () => {
    expect(metadata.difficulty).toBe(3);
    const total = metadata.scoring.checks.reduce((sum, check) => sum + check.points, 0);
    expect(total).toBe(200);
  });

  it("should spend the Medium tier's whole wrong-answer budget and no more", () => {
    // The validator only enforces a flat `wrongAnswerPenalty`, so for a
    // multi-verify problem the tier's 5% is this suite's job.
    const spent = metadata.scoring.checks.reduce(
      (sum, check) => sum + (check.wrongAnswerPenalty ?? 0),
      0,
    );
    expect(spent).toBe(10);
    for (const check of metadata.scoring.checks) {
      expect(check.wrongAnswerPenalty ?? 0).toBeLessThanOrEqual(check.points);
    }
  });

  it("should keep every hint penalty within the per-checkpoint half", () => {
    for (const check of metadata.scoring.checks) {
      const spent = (check.hints ?? []).reduce((sum, hint) => sum + hint.penalty, 0);
      expect(spent).toBeLessThanOrEqual(check.points / 2);
    }
  });

  it("should keep the whole problem's hint budget at or under half the total", () => {
    const spent = metadata.scoring.checks
      .flatMap((check) => check.hints ?? [])
      .reduce((sum, hint) => sum + hint.penalty, 0);
    expect(spent).toBe(100);
    expect(spent).toBeLessThanOrEqual(100);
  });

  it("should open each checkpoint with a free hint and escalate from there", () => {
    for (const check of metadata.scoring.checks) {
      const penalties = (check.hints ?? []).map((hint) => hint.penalty);
      expect(penalties).toEqual([0, 8, 12]);
    }
  });

  it("should give every hint in the problem a unique id", () => {
    const ids = metadata.scoring.checks.flatMap((check) => (check.hints ?? []).map((h) => h.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("should mirror every checkpoint and hint in the English overlay", () => {
    expect(metadata.i18n.en.checks.map((check) => check.id)).toEqual(
      metadata.scoring.checks.map((check) => check.id),
    );
    for (const check of metadata.scoring.checks) {
      const english = metadata.i18n.en.checks.find((entry) => entry.id === check.id);
      expect(english?.label).toBeTruthy();
      expect((english?.hints ?? []).map((hint) => hint.id)).toEqual(
        (check.hints ?? []).map((hint) => hint.id),
      );
    }
  });

  it("should not name a vulnerability class in any participant-visible label", () => {
    // AGENT.md §10: the label names the symptom or the asset. "How results
    // appear on the page" is fair; the class of bug behind it is not.
    const forbidden = /xss|sqli|csrf|injection|インジェクション|クロスサイト/i;
    for (const check of [...metadata.scoring.checks, ...metadata.i18n.en.checks]) {
      expect(check.label).not.toMatch(forbidden);
    }
    for (const text of [metadata.instructions, metadata.i18n.en.instructions]) {
      expect(text).not.toMatch(forbidden);
    }
  });
});

describe("stackstack-vibe-build requirements are one document", () => {
  it("should serve the nine rules from the app itself", async () => {
    const spec = await get("/api/spec");
    expect(spec.status).toBe(200);
    expect(spec.body.rules.map((rule: { id: string }) => rule.id)).toEqual([
      "R1",
      "R2",
      "R3",
      "R4",
      "R5",
      "R6",
      "R7",
      "R8",
      "R9",
    ]);
    for (const rule of spec.body.rules) {
      expect(rule.ja.length).toBeGreaterThan(10);
      expect(rule.en.length).toBeGreaterThan(10);
    }
    expect(spec.body.aiPolicy.ja).toBeTruthy();
    expect(spec.body.aiPolicy.en).toBeTruthy();
    expect(spec.body.howToVerify.ja).toBeTruthy();
    expect(spec.body.howToVerify.en).toBeTruthy();
  });

  it("should use the same names and limits in the app, the metadata and both READMEs", async () => {
    // A spec that drifts from the docs costs the participant a checkpoint for a
    // reason they cannot see. These are the load-bearing strings.
    const spec = (await get("/api/spec")).text;
    const readmes = [
      readFileSync(join(PROBLEM_DIR, "README.md"), "utf8"),
      readFileSync(join(PROBLEM_DIR, "README.ja.md"), "utf8"),
    ];
    for (const token of ["q_required", "q_too_long", "renderResults", "matches", "visibility", "64", "10"]) {
      expect(spec).toContain(token);
      for (const readme of readmes) expect(readme).toContain(token);
    }
    // The metadata does not restate the rules — it sends the participant to the
    // one copy that cannot drift, which is the running app's.
    const meta = readFileSync(join(PROBLEM_DIR, "metadata.json"), "utf8");
    for (const token of ["/api/spec", "/api/selfcheck", "/editor"]) expect(meta).toContain(token);
    // ...and the result field has exactly one name across all of them.
    for (const document of [spec, ...readmes]) expect(document).not.toContain("body.entries");
  });

  it("should call the feature by the surface the participant edits, never by a path", async () => {
    // The old spec named a checkout file. Editing that file dirtied git status
    // and survived every rebuild — one solve, and no second attempt (#378).
    const spec = await get("/api/spec");
    expect(String(spec.body.feature)).toContain("/editor");
    expect(spec.text).not.toContain("/app/feature");
    expect(spec.text).not.toContain("challenges/stackstack-vibe-build");
  });
});

describe("stackstack-vibe-build with the shipped starter", () => {
  beforeAll(() => useFeature(STARTER));

  it("should load and export both functions, so the first minute is 'not written yet'", async () => {
    const feature = await get("/api/feature");
    expect(feature.status).toBe(200);
    expect(feature.body.loaded).toBe(true);
    expect(feature.body.error).toBeNull();
    expect(feature.body.exports.sort()).toEqual(["renderResults", "search"]);
    expect(feature.body.required.sort()).toEqual(["renderResults", "search"]);
  });

  it("should answer every surface without failing", async () => {
    expect((await get("/api/search?q=board")).status).toBe(200);
    expect((await get("/search?q=board")).status).toBe(200);
    expect((await get("/healthz")).status).toBe(200);
  });

  it("should leave every gate red and every receipt withheld", async () => {
    const state = await selfcheck();
    for (const gate of GATES) expect(state[gate]).toBe(false);
    const posture = await get("/posture");
    for (const gate of GATES) {
      expect(posture.body.gates[gate]).toBe(false);
      expect(posture.body.tokens[gate]).toBeNull();
    }
    expect(posture.body.ready).toBe(false);
  }, 20_000);

  it("should fail every checkpoint, whatever is submitted", async () => {
    // There is nothing to submit: no gate is green, so no receipt exists. The
    // shapes below are the ones a participant would try anyway.
    for (const checkpoint of CHECKPOINTS) {
      for (const submission of ["", " ", "TC{ready_0000000000000000}", `TC{${RECEIPT_OF[checkpoint]}_0000000000000000}`]) {
        expect(await correctOf(checkpoint, submission)).toBe(false);
      }
    }
  }, 60_000);
});

describe("stackstack-vibe-build with an implementation that follows the spec", () => {
  beforeAll(() => useFeature(CORRECT));

  it("should turn every gate green", async () => {
    expect(await greenGates()).toEqual([...GATES].sort());
    const posture = await get("/posture");
    expect(posture.body.ready).toBe(true);
    for (const gate of GATES) {
      expect(posture.body.gates[gate]).toBe(true);
      expect(posture.body.tokens[gate]).toMatch(new RegExp(`^TC\\{${gate}_[0-9a-f]{16}\\}$`));
    }
  }, 20_000);

  it("should accept each checkpoint's own receipt and nothing else", async () => {
    const tokens = await receipts();
    for (const checkpoint of CHECKPOINTS) {
      const own = tokens[RECEIPT_OF[checkpoint] as string] as string;
      expect(await correctOf(checkpoint, own)).toBe(true);
      // Whitespace around a copied value is a copy-paste artefact, not an error.
      expect(await correctOf(checkpoint, ` ${own} `)).toBe(true);
      expect(await correctOf(checkpoint, own.slice(0, -1))).toBe(false);
      expect(await correctOf(checkpoint, `${own}x`)).toBe(false);
    }
  }, 60_000);

  it("should refuse one gate's receipt on another gate's checkpoint", async () => {
    // Every receipt below is a real, currently-valid value harvested from the
    // app: this is the "the earned value must be earned for *this*" pin, not a
    // test that garbage fails.
    const tokens = await receipts();
    for (const checkpoint of CHECKPOINTS) {
      for (const gate of GATES) {
        if (gate === RECEIPT_OF[checkpoint]) continue;
        expect(await correctOf(checkpoint, tokens[gate] as string)).toBe(false);
      }
    }
  }, 120_000);

  it("should refuse the sign-off token of the whole posture on any checkpoint", async () => {
    const posture = await get("/posture");
    const ready = posture.body.readyToken as string;
    expect(ready).toMatch(/^TC\{ready_[0-9a-f]{16}\}$/);
    for (const checkpoint of CHECKPOINTS) {
      expect(await correctOf(checkpoint, ready)).toBe(false);
    }
  }, 60_000);

  it("should serve the search page under a policy that cannot execute anything", async () => {
    const page = await get("/search?q=board");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(page.headers.get("content-type")).toContain("text/html");
  });

  it("should keep the page's own links relative, so a forwarded origin works", async () => {
    const page = await get("/search?q=board");
    expect(page.text).not.toContain("http://127.0.0.1");
    expect(page.text).not.toContain("http://localhost");
  });
});

describe("stackstack-vibe-build receipts are receipts for the current code", () => {
  it("should refuse a receipt harvested while green once the code stops earning it", async () => {
    // The failure this pins: a checkpoint that compares against the right value
    // without re-measuring would still credit a participant who reverted their
    // work after copying the token, and every other test here would stay green.
    useFeature(CORRECT);
    expect(await greenGates()).toEqual([...GATES].sort());
    const harvested = await receipts();

    useFeature(STARTER);
    for (const checkpoint of CHECKPOINTS) {
      const token = harvested[RECEIPT_OF[checkpoint] as string] as string;
      expect(token).not.toBeNull();
      expect(await correctOf(checkpoint, token)).toBe(false);
    }

    useFeature(CORRECT);
    for (const checkpoint of CHECKPOINTS) {
      const token = harvested[RECEIPT_OF[checkpoint] as string] as string;
      expect(await correctOf(checkpoint, token)).toBe(true);
    }
  }, 120_000);

  it("should still score a correct receipt while the measurement queue is saturated", async () => {
    // The scorer and the participant share one measurement queue, bounded at
    // MAX_QUEUED so a feature that calls back into the app cannot pile up work
    // forever. `/api/selfcheck` answers 409 past that bound, which is right --
    // the participant sees the refusal and retries.
    //
    // `/verify` has no such channel: the multi-verify contract carries a
    // boolean, so a declined measurement arrived as `correct: false`,
    // indistinguishable from a wrong receipt and carrying the wrong-answer
    // penalty. A participant would lose points for a queue somebody else's
    // timing created, with nothing in the response saying so.
    //
    // Saturating it needs the slots *held*, not merely requested: eight
    // concurrent self-checks against a fast feature are refused and drain
    // before `/verify` arrives, and a test written that way passes with the bug
    // still present. SLOW_CORRECT keeps each measurement occupied long enough
    // that the queue is genuinely full at the moment scoring runs.
    useFeature(SLOW_CORRECT);
    expect(await greenGates()).toEqual([...GATES].sort());
    const token = (await receipts()).search_answers as string;
    expect(token).not.toBeNull();

    const load = Array.from({ length: 6 }, () => get("/api/selfcheck").catch(() => null));
    // Let the queue fill before scoring, and confirm it really did: at least one
    // of these is refused, which is the state under test.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const scored = await correctOf("search-answers", token);
    const outcomes = await Promise.all(load);
    expect(outcomes.some((r) => r !== null && r.status === 409)).toBe(true);

    expect(scored).toBe(true);
  }, 180_000);

  it("should withhold the receipt the moment the file changes, before anything re-measures", async () => {
    useFeature(CORRECT);
    expect(await greenGates()).toEqual([...GATES].sort());
    expect((await receipts()).drafts_withheld).not.toBeNull();

    useFeature(STARTER);
    // No self-check in between: posture reports what was measured about the file
    // as it is now, and nothing has been measured about this one.
    const posture = await get("/posture");
    for (const gate of GATES) {
      expect(posture.body.gates[gate]).toBe(false);
      expect(posture.body.tokens[gate]).toBeNull();
    }
  }, 30_000);

  it("should leave no probe row behind once a measurement ends", async () => {
    useFeature(CORRECT);
    const idsSeen: number[][] = [];
    for (let run = 0; run < 2; run += 1) {
      await selfcheck();
      const archive = await get("/api/archive");
      idsSeen.push(
        archive.body.entries
          .filter((entry: { id: number }) => entry.id >= 100_000)
          .map((entry: { id: number }) => entry.id),
      );
    }
    expect(idsSeen).toEqual([[], []]);
  }, 30_000);

  it("should not reuse a single search term or archive row between two measurements", async () => {
    // "Remember what passed" has to be worthless, and the claim is about the
    // probe *inputs* — which are only visible from inside the graded code. The
    // recorder below is that vantage point. Without this, a probe tag quietly
    // becoming a constant would break nothing in this suite.
    useFeature(INPUT_RECORDER);

    const report = async () => {
      const response = await get("/api/search?q=__report__");
      expect(response.status).toBe(200);
      return {
        queries: new Set((response.body.queries as string[]).filter((q) => q !== "__report__")),
        rows: new Set(response.body.rows as string[]),
      };
    };

    await selfcheck();
    const first = await report();
    expect(first.queries.size).toBeGreaterThan(4);
    expect(first.rows.size).toBeGreaterThan(20);

    await selfcheck();
    const second = await report();

    // The recorder's `seenQueries` is module-level and the child is not
    // respawned between the two measurements, so the set accumulates:
    // `second` is a superset of `first`. The no-reuse property therefore reads
    // as "the second run added as many terms as the first run used, and reused
    // none of them" -- which is what the two assertions below say.
    //
    // There was a third line here that looked like the no-reuse check and was a
    // tautology: it filtered `second ∩ first` by "not in first", which is empty
    // whatever happens. Asserting `second ∩ first` empty instead would be wrong
    // in the other direction, because accumulation makes that intersection
    // exactly `first`.
    expect([...second.queries].length).toBeGreaterThan(first.queries.size);
    const onlyInSecond = [...second.queries].filter((q) => !first.queries.has(q));
    expect(onlyInSecond.length).toBe(second.queries.size - first.queries.size);
    expect(onlyInSecond.length).toBe(first.queries.size);

    // ...and not one archive row is reused either: ids, titles and bodies are
    // all minted per batch.
    const rowsOnlyInSecond = [...second.rows].filter((row) => !first.rows.has(row));
    expect(rowsOnlyInSecond.length).toBe(first.rows.size);
  }, 60_000);

  it("should always carry freshly generated archive rows, measured or not", async () => {
    // If random-looking rows appeared only while the app was measuring, an
    // implementation could tell it was being graded from the shape of its input.
    useFeature(CORRECT);
    const lots = async () =>
      (await get("/api/archive")).body.entries
        .filter((entry: { id: number }) => entry.id >= 20_000 && entry.id < 30_000)
        .map((entry: { title: string; body: string }) => `${entry.title}::${entry.body}`);
    const before = await lots();
    expect(before.length).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    const after = await lots();
    expect(after.length).toBe(before.length);
    expect(after).not.toEqual(before);
  }, 20_000);
});

describe("stackstack-vibe-build catches the cheap wrong fixes", () => {
  /**
   * Each row is one wrong idea and the gates it must cost. Asserting the *exact*
   * set matters in both directions: a fix that breaks more than it should is a
   * checkpoint that is not independent, and one that breaks less is a hole.
   */
  const table: Array<[keyof typeof FIXTURES | "alwaysRefuses", string, string[]]> = [
    ["noVisibilityFilter", "searches everything it was handed", ["drafts_withheld"]],
    ["cutThenSort", "takes ten and then sorts them", ["search_order"]],
    ["extraField", "returns one field more than asked", ["drafts_withheld", "search_answers"]],
    [
      "matchEverything",
      "ignores the term and returns the corpus",
      ["drafts_withheld", "search_answers", "search_bad_queries", "search_order"],
    ],
    [
      "redactsValues",
      "returns the right ids carrying the wrong text",
      ["drafts_withheld", "results_are_text", "search_answers"],
    ],
    ["skipsLengthCheck", "never checks how long the term is", ["search_bad_queries"]],
    ["wrongErrorName", "refuses under a name of its own invention", ["search_bad_queries"]],
    ["refusesWith200", "names the refusal and answers 200 anyway", ["search_bad_queries"]],
    ["caseSensitive", "compares the term without folding case", ["search_order"]],
    ["offByOneBoundary", "refuses a term of exactly the limit", ["search_bad_queries"]],
    ["showsAllOnNoHit", "shows the latest posts when nothing matched", ["search_order"]],
    ["unescaped", "puts the values straight into the template", ["results_are_text"]],
    [
      "rawInAnAttribute",
      "escapes the text and forgets the attribute beside it",
      ["results_are_text"],
    ],
    [
      "titleOnly",
      "matches on the title and never the body",
      ["drafts_withheld", "results_are_text", "search_bad_queries"],
    ],
    ["strippedTags", "deletes the dangerous characters instead", ["results_are_text"]],
    ["debugDump", "filters correctly and ships the corpus alongside", ["drafts_withheld"]],
    ["grinderSniffer", "applies the rule only to grader-shaped input", ["drafts_withheld"]],
    // Returning nothing withholds perfectly and satisfies nothing: every
    // checkpoint, including the two that grade an absence, requires the public
    // rows back first.
    ["withholdsEverything", "withholds correctly by returning nothing", [...GATES].sort()],
    ["rendersNothing", "renders an empty page", ["results_are_text"]],
    ["hidesRiskyRows", "declines to render anything that looks risky", ["results_are_text"]],
    ["swallowsTheTerm", "never shows the term back to the user", ["results_are_text"]],
    [
      "alwaysRefuses",
      "refuses every input so nothing broken gets in",
      [...GATES].sort(),
    ],
  ];

  for (const [name, description, broken] of table) {
    it(`should fail exactly ${broken.length} gate(s) for an implementation that ${description}`, async () => {
      useFeature(name === "alwaysRefuses" ? ALWAYS_400 : FIXTURES[name]);
      const state = await selfcheck();
      const failing = GATES.filter((gate) => state[gate] !== true).sort();
      expect(failing).toEqual(broken.sort());
    }, 30_000);
  }

  it("should refuse the checkpoint behind every gate a wrong fix broke", async () => {
    // The gate report and the checkpoint verdict are two different code paths.
    useFeature(FIXTURES.debugDump);
    expect(await correctOf("drafts-withheld", "TC{drafts_withheld_0000000000000000}")).toBe(false);
    useFeature(CORRECT);
    await selfcheck();
    const tokens = await receipts();
    useFeature(FIXTURES.debugDump);
    expect(await correctOf("drafts-withheld", tokens.drafts_withheld as string)).toBe(false);
    expect(await correctOf("search-answers", tokens.search_answers as string)).toBe(true);
  }, 60_000);
});

describe("stackstack-vibe-build absence checks stand on a positive one", () => {
  /**
   * The defect this catalog has shipped three times is an absence check that
   * passes against a stub. These four tests are the permanent proof that each
   * one here cannot: the implementation gets the absence exactly right and still
   * fails, because the positive layer underneath it is missing.
   */
  it("should refuse the withholding checkpoint to code that withholds everything", async () => {
    useFeature(FIXTURES.withholdsEverything);
    const state = await selfcheck();
    expect(state.drafts_withheld).toBe(false);
    expect(await correctOf("drafts-withheld", "TC{drafts_withheld_0000000000000000}")).toBe(false);
  }, 30_000);

  it("should refuse the display checkpoint to code that displays nothing", async () => {
    useFeature(FIXTURES.rendersNothing);
    const state = await selfcheck();
    expect(state.results_are_text).toBe(false);
  }, 30_000);

  it("should refuse the display checkpoint to code that drops the risky rows", async () => {
    useFeature(FIXTURES.hidesRiskyRows);
    const state = await selfcheck();
    expect(state.results_are_text).toBe(false);
  }, 30_000);

  it("should refuse the broken-input checkpoint to code that refuses everything", async () => {
    useFeature(ALWAYS_400);
    const state = await selfcheck();
    expect(state.search_bad_queries).toBe(false);
  }, 30_000);

  it("should keep the withholding check independent of its own precondition", async () => {
    // `debugDump` returns exactly the right ids in `matches` — the precondition
    // is satisfied — and still fails, because the withheld rows are elsewhere in
    // the same response. If this ever passes, the checkpoint has collapsed into
    // its precondition and is grading nothing of its own.
    useFeature(FIXTURES.debugDump);
    const report = await get("/api/selfcheck");
    const drafts = report.body.checks.find((c: { gate: string }) => c.gate === "drafts_withheld");
    expect(drafts.ok).toBe(false);
    const answers = report.body.checks.find((c: { gate: string }) => c.gate === "search_answers");
    expect(answers.ok).toBe(true);
  }, 30_000);
});

describe("stackstack-vibe-build self-check is usable and says nothing it should not", () => {
  it("should name the rule that failed and what came back, without naming the answer", async () => {
    useFeature(FIXTURES.cutThenSort);
    const report = await get("/api/selfcheck");
    expect(report.status).toBe(200);
    expect(report.body.allGreen).toBe(false);
    const order = report.body.checks.find((c: { gate: string }) => c.gate === "search_order");
    expect(order.ok).toBe(false);
    expect(order.notes.join(" ")).toContain("R7");
    // A note must never carry a receipt, the seed, or a line of the answer.
    const everything = report.text;
    expect(everything).not.toContain(SEED);
    expect(everything).not.toContain("TC{");
    expect(everything).not.toContain("visibility ===");
  }, 30_000);

  it("should report nothing failing once the implementation is right", async () => {
    useFeature(CORRECT);
    const report = await get("/api/selfcheck");
    expect(report.body.allGreen).toBe(true);
    for (const check of report.body.checks) expect(check.notes).toEqual([]);
  }, 30_000);
});

describe("stackstack-vibe-build runs participant code out of reach of its own secrets", () => {
  it("should give the feature process an empty environment", async () => {
    useFeature(SEED_THIEF);
    const response = await get("/api/search?q=abc");
    expect(response.status).toBe(200);
    const peeked = response.body.peek as string;
    expect(peeked).toContain("env=absent");
    expect(peeked).toContain("envKeys=0");
    // A child process's /proc/self/environ is its own exec-time environment,
    // which is what a worker thread would not have given us.
    expect(peeked).toMatch(/\/proc\/self\/environ=\s*($|\|)/);
  });

  it("should never let the seed reach the participant's code", async () => {
    useFeature(SEED_THIEF);
    const json = await get("/api/search?q=abc");
    const page = await get("/search?q=abc");
    for (const text of [json.text, page.text]) expect(text).not.toContain(SEED);
  });

  it("should not let participant code mint a receipt by importing the app's own module", async () => {
    // In the container the feature file sits beside the app, so this import
    // really does resolve. It reaches a *fresh* copy of the module in a separate
    // process, whose receipt secret was generated there and matches nothing.
    useFeature(CORRECT);
    await selfcheck();
    const real = (await receipts()).drafts_withheld as string;
    expect(real).not.toBeNull();

    useFeature(SEED_THIEF);
    const peeked = (await get("/api/search?q=abc")).body.peek as string;
    expect(peeked).toContain("gate=TC{drafts_withheld_");
    const forged = /gate=(TC\{drafts_withheld_[0-9a-f]{16}\})/.exec(peeked)?.[1] as string;
    expect(forged).toBeTruthy();
    expect(forged).not.toBe(real);
    expect(await correctOf("drafts-withheld", forged)).toBe(false);
  }, 60_000);

  it("should score it as wrong anyway", async () => {
    useFeature(SEED_THIEF);
    const state = await selfcheck();
    for (const gate of GATES) expect(state[gate]).toBe(false);
  }, 30_000);
});

describe("stackstack-vibe-build survives what participant code does to it", () => {
  it("should report a file that will not parse, and keep the app healthy", async () => {
    useFeature(SYNTAX_ERROR);
    const feature = await get("/api/feature");
    expect(feature.body.loaded).toBe(false);
    expect(feature.body.error).toBeTruthy();
    // The container path is not one the participant can open; the error names
    // the one they can.
    expect(feature.body.error).not.toContain(featurePath);

    const search = await get("/api/search?q=a");
    expect(search.status).toBe(503);
    expect(search.body.error).toBe("feature_unloadable");

    // A file being edited is expected state here, not an unhealthy app: a 503
    // on /healthz would let a runner tear the session down mid-keystroke.
    expect((await get("/healthz")).status).toBe(200);
    expect((await get("/api/board")).status).toBe(200);

    const logs = await get("/api/logs");
    expect(
      logs.body.lines.some((line: { message: string }) => line.message.startsWith("feature:")),
    ).toBe(true);
  });

  it("should answer a second time rather than hang after a failed load", async () => {
    // One runtime leaves a module registry that took a failed import in a state
    // where the next import of the same specifier never settles. The app throws
    // the process away instead.
    useFeature(SYNTAX_ERROR);
    const started = Date.now();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await get("/api/feature")).body.loaded).toBe(false);
    }
    expect(Date.now() - started).toBeLessThan(4_000);
  }, 20_000);

  it("should recover without a restart once the file is fixed", async () => {
    useFeature(SYNTAX_ERROR);
    expect((await get("/api/search?q=a")).status).toBe(503);
    useFeature(CORRECT);
    const search = await get("/api/search?q=board");
    expect(search.status).toBe(200);
    expect(Array.isArray(search.body.matches)).toBe(true);
  });

  it("should bound a synchronous infinite loop and keep serving everything else", async () => {
    useFeature(HANGS);
    const state = await selfcheck();
    for (const gate of GATES) expect(state[gate]).toBe(false);
    expect((await get("/healthz")).status).toBe(200);
    expect((await get("/api/board")).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${VERIFY_PORT}/healthz`)).ok).toBe(true);
    useFeature(CORRECT);
    expect((await get("/api/search?q=board")).status).toBe(200);
  }, 60_000);

  it("should not deadlock when the feature calls back into the app", async () => {
    useFeature(REENTRANT);
    const started = Date.now();
    const state = await selfcheck();
    expect(Date.now() - started).toBeLessThan(30_000);
    for (const gate of GATES) expect(state[gate]).toBe(false);
    expect((await get("/api/board")).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${VERIFY_PORT}/healthz`)).ok).toBe(true);
    useFeature(CORRECT);
    // ...and the queue drains, so the participant is not locked out afterwards.
    expect(await greenGates()).toEqual([...GATES].sort());
  }, 90_000);

  it("should survive a request target it cannot even parse", async () => {
    // `GET //` is a protocol-relative reference with no host, which `new URL`
    // rejects. Both servers share one process, so an unhandled throw would end
    // the session over a typo.
    await new Promise<void>((resolve) => {
      const socket = connect(CHALLENGE_PORT, "127.0.0.1", () => {
        socket.write("GET // HTTP/1.1\r\nHost: board.local\r\nConnection: close\r\n\r\n");
      });
      socket.on("close", () => resolve());
      socket.on("error", () => resolve());
      socket.setTimeout(3000, () => {
        socket.destroy();
        resolve();
      });
    });
    expect((await get("/healthz")).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${VERIFY_PORT}/healthz`)).ok).toBe(true);
  });
});

describe("stackstack-vibe-build never damages what the participant made", () => {
  it("should leave the board exactly as it was after being scored repeatedly", async () => {
    useFeature(CORRECT);
    const before = await get("/api/board");
    await fetch(`${BOARD}/api/posts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "you", title: "my own post", body: "keep me" }),
    });
    const mine = (await get("/api/board")).body.posts;

    for (let run = 0; run < 3; run += 1) await selfcheck();
    for (const checkpoint of CHECKPOINTS) await correctOf(checkpoint, "nope");

    const after = await get("/api/board");
    expect(after.body.posts).toEqual(mine);
    expect(after.body.posts.length).toBe(before.body.posts.length + 1);
    expect(
      after.body.posts.some((post: { title: string }) => post.title === "my own post"),
    ).toBe(true);
  }, 90_000);

  it("should put the archive back to the same size after a measurement", async () => {
    useFeature(CORRECT);
    const before = (await get("/api/archive")).body.count as number;
    await selfcheck();
    const after = (await get("/api/archive")).body.count as number;
    expect(after).toBe(before);
  }, 30_000);

  it("should never publish a withheld archive row on the public surface", async () => {
    const archive = await get("/api/archive");
    for (const entry of archive.body.entries) expect(entry.visibility).toBe("public");
    // ...and the corpus a participant's own function is handed is bigger than
    // that, which is the whole comparison this problem asks them to make.
    useFeature(`export function search({ posts }) {
  return { status: 200, body: { query: "", matches: [], size: posts.length } };
}
export function renderResults() { return ""; }
`);
    const seen = (await get("/api/search?q=x")).body.size as number;
    expect(seen).toBeGreaterThan(archive.body.count as number);
  });
});

describe("stackstack-vibe-build checkpoint wiring", () => {
  it("should define a handler for exactly the checkpoints metadata declares", async () => {
    for (const check of metadata.scoring.checks) {
      const response = await verifyCheckpoint(check.id, "");
      expect(response.status).toBe(200);
      expect(response.body.checkpointId).toBe(check.id);
    }
    const scenario = readFileSync(SCENARIO_FILE, "utf8");
    const block = scenario.slice(scenario.indexOf("export const checks = {"));
    const handlers = [...block.matchAll(/^ {2}"([a-z][a-z0-9-]*)":/gm)].map((m) => m[1] as string);
    expect(handlers.sort()).toEqual(metadata.scoring.checks.map((check) => check.id).sort());
  }, 60_000);

  it("should fail closed on a checkpoint id it does not know", async () => {
    const response = await verifyCheckpoint("no-such-checkpoint", "anything");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("unknown_checkpoint");
  });

  it("should fail closed on an inherited property name, not call it", async () => {
    for (const inherited of ["constructor", "toString", "valueOf", "__proto__"]) {
      const response = await verifyCheckpoint(inherited, "anything");
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("unknown_checkpoint");
    }
  });

  it("should expose one gate per checkpoint and no gate without one", async () => {
    const posture = await get("/posture");
    expect(Object.keys(posture.body.gates).sort()).toEqual([...GATES].sort());
    expect(Object.keys(posture.body.tokens).sort()).toEqual([...GATES].sort());
    expect(Object.values(RECEIPT_OF).sort()).toEqual([...GATES].sort());
  });

  it("should not let a scenario route shadow one of the board's own", async () => {
    // Redeclaring a base route is a boot failure, so the app being up is the
    // proof; this pins the surfaces apart so a future rename cannot collide.
    expect((await get("/api/board")).body.serial).toMatch(/^SS-[0-9a-f]{8}$/);
    expect((await get("/api/nope")).status).toBe(404);
  });
});

describe("stackstack-vibe-build editor and settings API", () => {
  beforeAll(() => useFeature(STARTER));

  it("should serve a self-contained editor page that never names a path", async () => {
    const page = await get("/editor");
    expect(page.status).toBe(200);
    expect(page.text).toContain("api/settings");
    expect(page.text).toContain("api/selfcheck");
    expect(page.text).not.toContain("/app/");
    expect(page.text).not.toContain("challenges/stackstack-vibe-build");
    // 自己完結: 外部の script/style/フォントを一切引かない (loopback と転送ポートの両方で
    // 同じに動くことがこの板の前提)。
    expect(page.text).not.toMatch(/src="https?:\/\//);
    expect(page.text).not.toMatch(/href="https?:\/\//);
  });

  it("should take an implementation through the API, run it, and reset to the starter", async () => {
    // The participant loop of #378: broken starter → save through the API with
    // no restart → discard → the starter is back. The mounted file never
    // changes, so a rebuilt container starts from the same place.
    const fileBefore = readFileSync(featurePath, "utf8");

    const current = await get("/api/settings");
    expect(current.status).toBe(200);
    expect(current.body.settings.source).toBe(fileBefore);

    const junkKey = await patchSettings({ sauce: "typo" });
    expect(junkKey.status).toBe(400);
    const junkType = await patchSettings({ source: 42 });
    expect(junkType.status).toBe(400);

    const saved = await patchSettings({ source: `${CORRECT}\n` });
    expect(saved.status).toBe(200);
    const feature = await get("/api/feature");
    expect(feature.body.loaded).toBe(true);
    const state = await selfcheck();
    expect(Object.values(state).every((gate) => gate === true)).toBe(true);
    expect(readFileSync(featurePath, "utf8")).toBe(fileBefore);

    const reset = await fetch(`${BOARD}/api/settings`, { method: "DELETE" });
    expect(reset.status).toBe(200);
    expect((await get("/api/settings")).body.settings.source).toBe(fileBefore);
    const back = await selfcheck();
    expect(Object.values(back).every((gate) => gate === true)).toBe(false);
  });
});

describe("stackstack-vibe-build wiring", () => {
  const composeDir = join(PROBLEM_DIR, "local");
  const compose = parseYaml(readFileSync(join(composeDir, "docker-compose.yml"), "utf8")) as {
    services: Record<
      string,
      {
        build: { context: string; dockerfile: string };
        environment: Record<string, string>;
        volumes: string[];
        ports: string[];
      }
    >;
  };
  const service = Object.values(compose.services)[0] as (typeof compose.services)[string];

  it("should publish the challenge endpoints' port, on loopback only", () => {
    for (const url of Object.values(metadata.runtime.challengeEndpoints)) {
      expect(service.ports).toContain(`127.0.0.1:${new URL(url).port}:8080`);
    }
    for (const published of service.ports) expect(published.startsWith("127.0.0.1:")).toBe(true);
  });

  it("should publish the verify port on loopback only", () => {
    expect(service.ports).toContain(`127.0.0.1:${new URL(metadata.runtime.verifyUrl).port}:8081`);
  });

  it("should declare exactly the ports it publishes", () => {
    const published = [
      ...new Set(service.ports.map((entry) => Number(entry.split(":")[1]))),
    ].sort((a, b) => a - b);
    const declared = metadata.exposedPorts.map((entry) => entry.port).sort((a, b) => a - b);
    expect(declared).toEqual(published);
  });

  it("should build the shared base image rather than a copy of it", () => {
    expect(service.build.context).toBe("../../../stackstack-base");
    expect(existsSync(join(composeDir, service.build.context, service.build.dockerfile))).toBe(true);
    expect(existsSync(join(composeDir, service.build.context, "app", "server.mjs"))).toBe(true);
  });

  it("should select the scenario whose checkpoint handlers metadata declares", () => {
    expect(service.environment.SCENARIO).toBe("vibe-build");
    expect(
      existsSync(join(composeDir, service.build.context, "app", "scenarios", "vibe-build.mjs")),
    ).toBe(true);
  });

  it("should mount the participant's config and feature directories read-only", () => {
    expect(service.volumes).toEqual(["./config:/app/config:ro", "./feature:/app/feature:ro"]);
    expect(existsSync(join(composeDir, "config", "app.json"))).toBe(true);
    expect(existsSync(join(composeDir, "feature", "search.mjs"))).toBe(true);
  });

  it("should carry no path hint for anyone to resurrect in copy (#378)", () => {
    // The participant writes their implementation at /editor and it is stored
    // through the API, so the compose file must not ship a "path to open".
    expect(service.environment.FEATURE_HINT).toBeUndefined();
    expect(service.environment.CONFIG_HINT).toBeUndefined();
    for (const inThisRepo of [
      "challenges/stackstack-vibe-build/local/feature/search.mjs",
      "challenges/stackstack-vibe-build/local/config/app.json",
    ]) {
      expect(existsSync(join(REPO_ROOT, inThisRepo))).toBe(true);
    }
  });

  it("should steer every participant-facing doc to the editor, never to the checkout file", () => {
    for (const name of ["README.md", "README.ja.md", "metadata.json"]) {
      const text = readFileSync(join(PROBLEM_DIR, name), "utf8");
      expect(text).not.toContain("challenges/stackstack-vibe-build/local/");
      expect(text).toContain("/editor");
    }
  });

  it("should ship a starter that loads, exports both functions, and satisfies nothing", () => {
    // Checked as text here; the behaviour is asserted against the running app in
    // "with the shipped starter" above. A starter that is broken rather than
    // unimplemented would make the participant's first minute about the wrong
    // problem.
    expect(STARTER).toContain("export function search");
    expect(STARTER).toContain("export function renderResults");
    // No answer smuggled in as a starting point: no publish rule, no escaping,
    // no ordering.
    expect(STARTER).not.toContain('=== "public"');
    expect(STARTER).not.toContain("&lt;");
    expect(STARTER).not.toContain("sort(");
    expect(STARTER).not.toContain("q_required");
  });

  it("should keep the shipped starter out of this suite's edits", () => {
    // The suite writes to a scratch copy. If this ever fails, a solution has
    // been committed over the starter.
    expect(readFileSync(join(PROBLEM_DIR, "local", "feature", "search.mjs"), "utf8")).toBe(STARTER);
  });
});
