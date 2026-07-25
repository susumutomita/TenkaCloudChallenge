/**
 * [#212] Scaffold a course-aligned local-play challenge.
 *
 * `bun run new challenges <id> --from ac26-bridge-experiment` already copies the
 * directory. What it cannot do is renumber the four things that are wrong the
 * moment a course challenge is copied:
 *
 *   1. the published ports (two challenges on the same port cannot run together);
 *   2. `track.order` and `chapter` (position in the curriculum map);
 *   3. `courseAlignment.week` / `role` (which week, and how close to the official
 *      exercise) — required by the validator for this track;
 *   4. the compose service name and the Makefile's `SERVICE`.
 *
 * Getting any of those wrong fails late: a port clash appears only when two labs
 * run at once, and a missing alignment appears only in `bun run validate`. So this
 * command does them all at scaffold time and leaves the author with prose to write
 * rather than wiring to remember.
 *
 * Usage:
 *   bun run new-course-challenge <trackId> <id> --week <n> --role <role> --order <n>
 *                                              [--chapter "Week 3 / Group Law"]
 *   bun run new-course-challenge advanced-cryptography-2026 ac26-w3-field-inverse \
 *     --week 3 --role mechanism --order 310
 *
 * After it runs, the challenge is a *draft skeleton*, not a challenge: the fixtures,
 * checkpoints, hidden cases, mutations, and prose are all still to be written. See
 * docs/curricula/<trackId>/TEMPLATE.md for the order to do that in.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { scaffoldProblem } from "./new-problem";

const REPO_ROOT = new URL("..", import.meta.url).pathname;

/**
 * Which course a track is bound to. Mirrors `TRACK_COURSE_BINDING` in
 * validate-problems.ts: the validator rejects a mismatch, so scaffolding a
 * combination it would reject is worth refusing here instead.
 */
const TRACK_COURSE_BINDING: Readonly<
  Record<string, { courseId: string; edition: string; sample: string }>
> = {
  "advanced-cryptography-2026": {
    courseId: "advanced-cryptography-program",
    edition: "2026",
    sample: "ac26-bridge-experiment",
  },
};

/** Same vocabulary as `courseAlignment.role` in SCHEMA.json. */
const ROLES = ["diagnostic", "mechanism", "assignment-companion", "transfer", "synthesis"] as const;

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Base of the AC26 port block. 18080/18081, 18100/18101, and 18200/18201 are taken
 * by existing challenges, so the track starts above all of them.
 */
const PORT_BASE = 18300;

interface CourseArgs {
  readonly trackId: string;
  readonly id: string;
  readonly week: number;
  readonly role: string;
  readonly order: number;
  readonly chapter: string;
  readonly from: string;
}

/** `18300 + track.order`, and that plus one for /verify. */
export function portsFor(order: number): { challenge: number; verify: number } {
  const challenge = PORT_BASE + order;
  return { challenge, verify: challenge + 1 };
}

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function parseCourseArgs(argv: readonly string[]): CourseArgs | { readonly error: string } {
  const positional = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
  const [trackId, id] = positional;

  const binding = trackId ? TRACK_COURSE_BINDING[trackId] : undefined;
  if (!binding) {
    const known = Object.keys(TRACK_COURSE_BINDING).join(", ");
    return { error: `unknown track "${trackId ?? ""}". Bound tracks: ${known}` };
  }
  if (!id || !ID_RE.test(id)) {
    return { error: `id must be lowercase kebab-case (got ${id ?? "nothing"})` };
  }

  const week = Number(flag(argv, "week"));
  if (!Number.isInteger(week) || week < 1) {
    return { error: "--week must be an integer >= 1 (course weeks are 1-based)" };
  }

  const role = flag(argv, "role") ?? "";
  if (!ROLES.includes(role as (typeof ROLES)[number])) {
    return { error: `--role must be one of: ${ROLES.join(", ")} (got ${role || "nothing"})` };
  }

  const order = Number(flag(argv, "order"));
  if (!Number.isInteger(order) || order < 10 || order % 10 !== 0) {
    // Ports are derived from order, so a non-multiple of ten can collide with a
    // neighbour that is only one apart.
    return { error: "--order must be a positive multiple of 10 (it also derives the ports)" };
  }

  return {
    trackId,
    id,
    week,
    role,
    order,
    chapter: flag(argv, "chapter") ?? `Week ${week} / TODO`,
    from: flag(argv, "from") ?? binding.sample,
  };
}

/**
 * Two placeholder checkpoints, because `multi-verify` requires at least two and
 * ASSESSMENT.md requires at least two distinct evidence kinds. The names say which
 * kind each slot is for, so the skeleton pushes toward observe/predict + construct
 * rather than two variants of "did the test pass".
 */
const TODO_CHECKS = [
  {
    id: "todo-observe",
    label: "TODO: 学習者が観察する現象を表す label (答えや脆弱性名は書かない)",
    points: 40,
    wrongAnswerPenalty: 2,
    hints: [
      { id: "todo-observe-1", content: "TODO: どこを見るか (approach)", penalty: 0 },
      { id: "todo-observe-2", content: "TODO: 絞り込み方", penalty: 4 },
      { id: "todo-observe-3", content: "TODO: 最後の手段の具体解", penalty: 9 },
    ],
  },
  {
    id: "todo-construct",
    label: "TODO: 実装できたことを表す label",
    points: 60,
    wrongAnswerPenalty: 1,
    hints: [
      { id: "todo-construct-1", content: "TODO: どこを見るか (approach)", penalty: 0 },
      { id: "todo-construct-2", content: "TODO: 絞り込み方", penalty: 4 },
      { id: "todo-construct-3", content: "TODO: 最後の手段の具体解", penalty: 9 },
    ],
  },
];

/**
 * Rewrite the sample's metadata into a draft skeleton for a new course challenge.
 *
 * Prose is blanked rather than carried over: a copied writeup that ships under a
 * new id is worse than an empty one, because it reads as authored.
 */
export function rewriteCourseMetadata(raw: string, args: CourseArgs): string {
  const meta = JSON.parse(raw) as Record<string, unknown>;
  const binding = TRACK_COURSE_BINDING[args.trackId];
  const ports = portsFor(args.order);

  meta.id = args.id;
  meta.name = `TODO: ${args.id}`;
  meta.status = "draft";
  meta.shortDescription = "TODO: カタログに出る 1 行説明 (参加者向け・ネタバレ禁止)";
  meta.description = "TODO: [管理者/作者向け] 設計意図と checkpoint ごとの狙い。ネタバレ可。";
  meta.instructions = "TODO: [競技者向け] 状況・ゴール・採点。ネタバレ厳禁。";
  meta.writeup = "TODO: 解禁後の解説。何が起きていたか、なぜそうなるか、どう一般化するか。";
  meta.learningGoals = ["TODO: 学習目標 1", "TODO: 学習目標 2"];

  meta.track = { id: args.trackId, order: args.order, chapter: args.chapter };
  meta.courseAlignment = {
    courseId: binding.courseId,
    edition: binding.edition,
    week: args.week,
    role: args.role,
    spoilerPolicy: "independent-reimplementation",
    // `sources` は意図的に引き継がない。 pin は「この版を読んだ」という記録なので、
    // copy 元の pin を継ぐと読んでいない版について読んだと言うことになる。
    // 教材を実際に読んでから追記する (未公開週は kind: "placeholder")。
  };

  meta.exposedPorts = [
    { port: ports.challenge, name: "Challenge surface" },
    { port: ports.verify, name: "/verify (loopback scorer)" },
  ];
  meta.runtime = {
    ...(meta.runtime as Record<string, unknown>),
    challengeEndpoints: { Challenge: `http://127.0.0.1:${ports.challenge}` },
    verifyUrl: `http://127.0.0.1:${ports.verify}/verify`,
  };

  // Checkpoints are the design work; a copied set would be scored against fixtures
  // this challenge does not have.
  meta.scoring = { kind: "multi-verify", checks: structuredClone(TODO_CHECKS) };

  // Education-graph node ids are registered once for the whole catalog, and
  // relations resolve against that catalog-wide registry (scripts/knowledge-graph.ts).
  // So a copied `concept.*` / `misconception.*` / `audience.*` node is a duplicate
  // declaration, not a shared reference. The skeleton therefore declares only the
  // two problem-scoped kinds and leaves the shared kinds to be *referenced*:
  // declare a concept in the challenge that introduces it, and point at it from
  // later challenges with a `covers` or `requires` relation. See TEMPLATE.md.
  meta.nodes = {
    learning_objectives: [
      { id: `lo.${args.id}.todo`, description: "TODO: 学習目標 (観察できる能力で書く)" },
    ],
    assessment_criteria: [
      { id: `assessment.${args.id}.todo`, description: "TODO: 達成を判定できる観察可能な条件" },
    ],
  };
  meta.relations = [
    { type: "teaches", source: `problem.${args.id}`, target: `lo.${args.id}.todo` },
    { type: "assesses", source: `problem.${args.id}`, target: `assessment.${args.id}.todo` },
    {
      type: "related_to",
      source: `assessment.${args.id}.todo`,
      target: `lo.${args.id}.todo`,
    },
  ];

  const i18n = meta.i18n as { en?: Record<string, unknown> } | undefined;
  if (i18n?.en) {
    i18n.en = {
      ...i18n.en,
      name: `TODO: ${args.id}`,
      shortDescription: "TODO: one-line catalog description (participant-facing, no spoilers)",
      description: "TODO: [maintainers and authors] design intent per checkpoint. Spoilers allowed.",
      instructions: "TODO: [participant-facing] situation, goal, scoring. No spoilers.",
      writeup: "TODO: post-release explanation: what happened, why, how it generalizes.",
      learningGoals: ["TODO: learning goal 1", "TODO: learning goal 2"],
      checks: TODO_CHECKS.map((check) => ({
        id: check.id,
        label: "TODO: the phenomenon the learner observes (never the answer)",
        hints: check.hints.map((hint) => ({ id: hint.id, content: "TODO" })),
      })),
    };
  }

  return `${JSON.stringify(meta, null, 2)}\n`;
}

export function rewriteCompose(
  raw: string,
  { id, ports }: { id: string; ports: { challenge: number; verify: number } },
): string {
  const sample = TRACK_COURSE_BINDING["advanced-cryptography-2026"].sample;
  const samplePorts = portsFor(10);
  return raw
    .replaceAll(String(samplePorts.challenge), String(ports.challenge))
    .replaceAll(String(samplePorts.verify), String(ports.verify))
    .replaceAll(sample, id);
}

export function rewriteMakefile(raw: string, { id }: { id: string }): string {
  const sample = TRACK_COURSE_BINDING["advanced-cryptography-2026"].sample;
  return raw.replaceAll(sample, id);
}

function reindex(log: (m: string) => void): void {
  for (const [script, extra] of [
    ["scripts/build-index.ts", []],
    ["scripts/estimate-cost.ts", ["--write"]],
  ] as const) {
    const result = spawnSync("bun", ["run", script, ...extra], { cwd: REPO_ROOT, stdio: "inherit" });
    if (result.status !== 0) log(`[new-course-challenge] WARN ${script} exited ${result.status}`);
  }
}

function main(): void {
  const parsed = parseCourseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(`[new-course-challenge] ${parsed.error}`);
    console.error(
      "Usage: bun run new-course-challenge <trackId> <id> --week <n> --role <role> --order <n> [--chapter '...']",
    );
    process.exit(1);
  }

  let dest: string;
  try {
    dest = scaffoldProblem({ category: "challenges", id: parsed.id, from: parsed.from });
  } catch (error) {
    console.error(`[new-course-challenge] ${(error as Error).message}`);
    process.exit(1);
  }

  const ports = portsFor(parsed.order);
  const rewrites: Array<[string, (raw: string) => string]> = [
    ["metadata.json", (raw) => rewriteCourseMetadata(raw, parsed)],
    ["local/docker-compose.yml", (raw) => rewriteCompose(raw, { id: parsed.id, ports })],
    ["local/Makefile", (raw) => rewriteMakefile(raw, { id: parsed.id })],
  ];
  for (const [relative, rewrite] of rewrites) {
    const path = join(dest, relative);
    writeFileSync(path, rewrite(readFileSync(path, "utf8")));
  }

  console.log(
    [
      `[new-course-challenge] created challenges/${parsed.id} (from ${parsed.from}).`,
      `  track      ${parsed.trackId} order ${parsed.order} — ${parsed.chapter}`,
      `  alignment  week ${parsed.week}, role ${parsed.role}`,
      `  ports      ${ports.challenge} (challenge) / ${ports.verify} (/verify)`,
      "",
      "This is a skeleton, not a challenge. In order:",
      `  1. docs/curricula/${parsed.trackId}/TEMPLATE.md — read it before writing fixtures`,
      "  2. local/app/fixtures.py   — seed-derived parameters, public + hidden cases",
      "  3. local/app/verifier.py   — one handler per checkpoint",
      "  4. local/app/mutations.py  — the wrong implementations the hidden cases must kill",
      "  5. local/app/selftest.py   — assert the fixtures are well-formed for every seed",
      "  6. metadata.json           — checkpoints, hints, graph nodes, prose (both languages)",
      `  7. Add the row to docs/curricula/${parsed.trackId}/curriculum.md`,
      "  8. Read the course material, then record the pin in courseAlignment.sources",
      "  9. bun run validate && bun run course:drift",
      "",
      'Leave status "draft" until every checkpoint is closable and mutations pass.',
    ].join("\n"),
  );

  reindex(console.log);
}

if (import.meta.main) main();
