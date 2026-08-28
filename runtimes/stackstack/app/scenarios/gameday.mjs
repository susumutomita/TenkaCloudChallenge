import { participantPosts } from "../board.mjs";
import { readConfig } from "../config.mjs";
import { log, recentLines } from "../log.mjs";
import { posture } from "../posture.mjs";
import { BOARD_SERIAL, gateToken } from "../secrets.mjs";

/**
 * The gameday scenario: the whole StackStack family run as one continuous
 * 90- or 120-minute event, on one board, with one story.
 *
 * ## What this module is, and is not
 *
 * It is a COMPOSITION. Every gate, every probe, every decision function it
 * scores is imported from the single-problem scenario next to it and used as the
 * imported object — never copied. A later fix to `defend.mjs` or `ship.mjs`
 * reaches this event without anybody remembering that it should. The provenance
 * of every scored fact is computed at boot by identity comparison against each
 * module's own `gates` export and published on `GET /gameday/state`, so "we
 * import rather than reimplement" is a machine-checked claim rather than a
 * sentence in a README.
 *
 * It is NOT a second implementation of anything, and it is NOT an edit to the
 * shared board. Nothing under `runtimes/stackstack/app/` changes; this file only
 * adds itself.
 *
 * ## Why local play rather than the AWS `battles/stackstack`
 *
 * `battles/stackstack` is a CloudFormation `phased-polling` Battle: an EC2 host
 * serving `/meta` and `/score`, probed by the platform. A JavaScript scenario
 * module cannot execute there, so "reuse each single Challenge's attack,
 * verification and scoring logic" would have to mean re-expressing six gate
 * families and six probe families in that host's own language — a second
 * implementation with no shared test suite, drifting from this directory the
 * first time either side is edited, and unverifiable without a live AWS account.
 * The existing AWS Battle is left exactly as it is. The two share a board
 * concept and a name family; they do not share code, and the README says so.
 *
 * ## What had to be re-expressed, and why
 *
 * **The receipt layer.** `gateToken(name)` is keyed on the gate name alone, and
 * three of the imported modules each declare a gate literally named
 * `service_intact` — their receipts would be the same string inside one process.
 * So this scenario mints its own receipts under `gameday_*` names and never
 * re-uses a constituent's receipt value. The MEASUREMENT behind every receipt is
 * imported; only the naming is new.
 *
 * **Any predicate upstream that has drifted to a constant.** Six modules are
 * maintained separately, and a gate that says `() => false` still type-checks,
 * still appears in a provenance map, and still reads like a measurement — while
 * being exactly the vacuous pass this catalog forbids. Every scored predicate is
 * therefore run against a tripwire context at boot (`auditVacuity`), the ones
 * that never look at their own state are published by name on
 * `GET /gameday/state`, and the ones this scenario has had to work around are
 * listed with their reason in `REEXPRESSED`. Nothing is silently substituted:
 * an entry there is a defect somebody upstream has to fix.
 *
 * ## The two files both called access.json
 *
 * `safe-exposure.mjs` and `defend.mjs` both read `ACCESS_POLICY`, with different
 * defaults and incompatible document schemas. Running them in one process means
 * that variable can only be right for one of them. Rather than making the
 * participant (and the test suite) live with that, this module resolves the two
 * paths from two variables of its own and scopes `ACCESS_POLICY` around each
 * dynamic import — see `importWithAccessPolicy` below. It is the only clever
 * thing in this file and it is here to remove a footgun, not to add one.
 */

// ---------------------------------------------------------------------------
// the two access documents, resolved before the modules that read them
// ---------------------------------------------------------------------------

/** The portal's access document (safe-exposure's file). */
const EXPOSURE_POLICY = process.env.GAMEDAY_EXPOSURE_POLICY ?? "/app/access/access.json";

/** The drafts desk's access document (defend's file). A different schema entirely. */
const DESK_POLICY = process.env.GAMEDAY_DESK_POLICY ?? "/app/policy/access.json";

/**
 * Import a scenario module with `ACCESS_POLICY` pinned to the path that module
 * should read, then put the variable back the way it was.
 *
 * Both modules capture their path in a module-level `const` at evaluation time,
 * and a dynamic import evaluates the module exactly once, at the point it is
 * awaited — so pinning the variable around the await is enough, and the two
 * modules end up holding two different paths. Anything else in the process sees
 * the environment unchanged.
 */
async function importWithAccessPolicy(specifier, path) {
  const previous = process.env.ACCESS_POLICY;
  process.env.ACCESS_POLICY = path;
  try {
    return await import(specifier);
  } finally {
    if (previous === undefined) delete process.env.ACCESS_POLICY;
    else process.env.ACCESS_POLICY = previous;
  }
}

const onboarding = await import("./onboarding.mjs");
const ship = await import("./ship.mjs");
const vibeBuild = await import("./vibe-build.mjs");
const safeExposure = await importWithAccessPolicy("./safe-exposure.mjs", EXPOSURE_POLICY);
const opsSecrets = await import("./secrets.mjs");
const observability = await import("./observability.mjs");
const defend = await importWithAccessPolicy("./defend.mjs", DESK_POLICY);

const MODULES = {
  onboarding,
  ship,
  vibe: vibeBuild,
  exposure: safeExposure,
  ops: opsSecrets,
  relay: observability,
  defend,
};

// ---------------------------------------------------------------------------
// the schedule
// ---------------------------------------------------------------------------

const CHALLENGE_PORT = Number(process.env.CHALLENGE_PORT ?? 8080);
const ORIGIN = `http://127.0.0.1:${CHALLENGE_PORT}`;

/**
 * The event's length, in minutes. Exactly two settings are supported and an
 * unrecognised one is a boot failure rather than a silent fall back to 90: an
 * organiser discovering forty minutes in that their 120-minute event is running
 * a 90-minute schedule is a worse outcome than a container that refuses to
 * start.
 */
const MINUTES = Number(process.env.STACKSTACK_GAMEDAY_MINUTES ?? 90);

/**
 * What the duration switch changes: when each phase opens, and how long the
 * sign-off hold is. What it does not change: the gates, the probe sets, the
 * error budget, or any threshold. A 120-minute run is not an easier run — it is
 * a run with more room to diagnose and a longer hold to prove it stuck. This is
 * the rule `defend.mjs` already states about its own tunables.
 */
const PLANS = {
  90: { build: 8, ship: 20, expose: 30, attack: 42, incident: 55, stabilize: 70, hold: 5 },
  120: { build: 10, ship: 26, expose: 40, attack: 56, incident: 74, stabilize: 95, hold: 8 },
};

if (!Object.hasOwn(PLANS, String(MINUTES))) {
  console.error(
    `STACKSTACK_GAMEDAY_MINUTES must be 90 or 120, got "${process.env.STACKSTACK_GAMEDAY_MINUTES}"`,
  );
  process.exit(1);
}

const PLAN = PLANS[String(MINUTES)];

/** Clamp a tunable the same way `defend.mjs` does, so a hostile value cannot make the event trivial. */
function tuned(name, fallback, low, high) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(high, Math.max(low, raw));
}

/**
 * Rehearsal only. `SCALE` divides every wall-clock interval in the plan, so this
 * problem's own suite can drive a full 90-minute event in a few seconds. It is
 * named in the README rather than hidden, exactly like `DEFEND_HOLD_MS`.
 */
const SCALE = tuned("STACKSTACK_GAMEDAY_SCALE", 1, 1, 100_000);
const TICK_MS = Math.round(tuned("STACKSTACK_GAMEDAY_TICK_MS", 2_000, 20, 60_000));

const minutesToMs = (minutes) => Math.max(1, Math.round((minutes * 60_000) / SCALE));

/** How often the scorer asks the search surface to re-measure itself. */
const MEASURE_EVERY_TICKS = 5;

/**
 * The availability contract, and the thing that makes "take it down and fix it
 * in peace" lose.
 *
 * A per-tick product of availability and security already removes any *reward*
 * for being dark, but a product alone imposes no cost that survives to the
 * scoreboard: the platform records checkpoint verdicts, not the integral. So the
 * degradation a run accumulates is kept as two monotone counters and read back
 * as a predicate at verdict time. Once a service has been observed working it is
 * committed, and every later tick it is not working is spent out of this budget.
 * Nothing clears the counters.
 */
const ERROR_BUDGET = 0.05;

const PHASES = ["join", "build", "ship", "expose", "attack", "incident", "stabilize"];
const phaseIndex = (name) => PHASES.indexOf(name);

// ---------------------------------------------------------------------------
// the reused facts
// ---------------------------------------------------------------------------

/**
 * Every scored predicate, and the posture namespace it is supposed to read.
 *
 * All but one are the imported function object rather than a copy of it, so a
 * later fix to a source module reaches this event without anybody remembering
 * that it should. The exception is declared in `REEXPRESSED` below with its
 * reason, and it is subject to the same vacuity audit as the imports.
 */
const FACT = {
  joinOpen: onboarding.gates.posts_open,
  joinWrote: onboarding.gates.post_created,

  vibeAnswers: vibeBuild.gates.search_answers,
  vibeWithheld: vibeBuild.gates.drafts_withheld,

  shipServing: ship.gates.site_serving,
  shipSingle: ship.gates.single_release,
  shipRotation: ship.gates.survives_key_rotation,

  exposeSealed: safeExposure.gates.admin_sealed,
  exposeScoped: safeExposure.gates.drafts_scoped,
  exposeService: safeExposure.gates.service_intact,

  deskService: defend.gates.service_intact,
  deskReads: defend.gates.reads_held,
  deskPublishes: defend.gates.publishes_held,

  relayTraffic: observability.gates.traffic_seen,
  relayLogged: observability.gates.failures_logged,
  relayHonest: observability.gates.health_honest,
  relayClean: observability.gates.credential_out_of_logs,

  opsRevoked: opsSecrets.gates.legacy_revoked,
  opsLeast: opsSecrets.gates.least_privilege,
  opsService: opsSecrets.gates.service_intact,
};

/** Which posture namespace each scored predicate is supposed to read. */
const READS = {
  joinOpen: null,
  joinWrote: null,
  vibeAnswers: "vibe",
  vibeWithheld: "vibe",
  shipServing: "ship",
  shipSingle: "ship",
  shipRotation: "ship",
  exposeSealed: "exposure",
  exposeScoped: "exposure",
  exposeService: "exposure",
  deskService: "defend",
  deskReads: "defend",
  deskPublishes: "defend",
  relayTraffic: "relay",
  relayLogged: "relay",
  relayHonest: "relay",
  relayClean: "relay",
  opsRevoked: "ops",
  opsLeast: "ops",
  opsService: "ops",
};

/**
 * Every predicate this scenario scores that is NOT the imported object, with the
 * reason. An empty map is the goal; a populated one is a defect report about a
 * sibling module, kept where a reader will see it rather than in a comment.
 */
const REEXPRESSED = {};

/**
 * Where a predicate came from, decided by object identity against each module's
 * own `gates` export.
 *
 * This is one of the two standing guards the composition needs: if somebody
 * later replaces an imported predicate with a hand-written one that looks
 * equivalent, its provenance turns into `gameday` and the suite fails. A comment
 * claiming reuse cannot do that.
 */
function provenanceOf(predicate) {
  for (const [namespace, module] of Object.entries(MODULES)) {
    for (const [name, candidate] of Object.entries(module.gates ?? {})) {
      if (candidate === predicate) return `${namespace}.${name}`;
    }
  }
  return "gameday";
}

const PROVENANCE = Object.fromEntries(
  Object.entries(FACT).map(([name, predicate]) => [name, provenanceOf(predicate)]),
);

/**
 * The second standing guard: does each scored predicate actually consult the
 * state it claims to be about?
 *
 * Composition makes this a live hazard rather than a theoretical one. Six
 * modules are maintained separately, and a gate that has drifted to a constant —
 * `() => true` or `() => false` — still type-checks, still appears in a
 * provenance map, and still reads like a measurement. Scored here, it would be
 * exactly the vacuous pass this catalog forbids.
 *
 * So each predicate is run once against the live context with its own namespace
 * replaced by an object that throws on any property read. A predicate that
 * consults its state raises; one that answers anyway never looked, and is
 * reported by name on `GET /gameday/state`. Nothing is silently substituted:
 * a constant that reaches this list is a defect somebody has to fix, not
 * something for a scenario to paper over.
 */
const TRIPWIRE = new Proxy(
  {},
  {
    get() {
      throw new Error("gameday-vacuity-tripwire");
    },
    has() {
      throw new Error("gameday-vacuity-tripwire");
    },
  },
);

function auditVacuity(context) {
  const vacuous = [];
  for (const [name, predicate] of Object.entries(FACT)) {
    const namespace = READS[name];
    // Onboarding's two read the board's shared context rather than a namespace
    // of their own, so there is nothing to swap out; they are covered by the
    // Join behaviour the suite drives instead.
    if (namespace === null) continue;
    try {
      predicate({ ...context, [namespace]: TRIPWIRE });
      vacuous.push(`${name} (${PROVENANCE[name]})`);
    } catch {
      // It looked. That is all this is asking.
    }
  }
  return vacuous;
}

// ---------------------------------------------------------------------------
// routes: the merge, and the boot-time collision check
// ---------------------------------------------------------------------------

/** The board's own surface. Redeclaring one of these is a boot failure in `server.mjs`. */
const BASE_ROUTES = [
  "GET /",
  "GET /healthz",
  "GET /api/board",
  "GET /api/logs",
  "GET /posture",
  "POST /api/posts",
];

const CONTRIBUTORS = [
  ["ship", ship.routes ?? {}],
  ["vibe", vibeBuild.routes ?? {}],
  ["exposure", safeExposure.routes ?? {}],
  ["ops", opsSecrets.routes ?? {}],
  ["relay", observability.routes ?? {}],
  ["defend", defend.routes ?? {}],
];

const routeOwner = new Map();
const duplicateRoutes = [];
const baseCollisions = [];

for (const [namespace, table] of CONTRIBUTORS) {
  for (const route of Object.keys(table)) {
    if (BASE_ROUTES.includes(route)) baseCollisions.push(`${namespace}:${route}`);
    const owner = routeOwner.get(route);
    if (owner !== undefined) duplicateRoutes.push(`${route} (${owner} and ${namespace})`);
    else routeOwner.set(route, namespace);
  }
}

// Two scenarios claiming one route would mean whichever spread last wins and the
// other module's surface silently disappears — found by whoever debugged it
// next, which is the wrong person at the wrong time. Same discipline as
// `server.mjs`'s base-route guard, applied one layer up.
if (duplicateRoutes.length > 0 || baseCollisions.length > 0) {
  console.error(
    `gameday route composition is not sound: duplicates=[${duplicateRoutes.join(", ")}] baseCollisions=[${baseCollisions.join(", ")}]`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// the story
// ---------------------------------------------------------------------------

export const seedPosts = [
  {
    author: "cto",
    title: "今日は 1 日、 板から手を離さないでください",
    body: "AI Builder が作った掲示板を、 今日じゅうに社外にも出せる状態まで持っていきます。 前任の SRE はもういません。 途中で検索を足し、 公開側の入口を開け、 星野デザインにも渡し、 その間ずっと外からのアクセスは続きます。 順番と時刻は板の作戦卓 (GET /gameday) に出しておきます。",
    at: "2026-04-10T08:30:00.000Z",
  },
  {
    author: "sre-predecessor",
    title: "引き継ぎ: 設定はぜんぶファイル 1 枚ずつです",
    body: "板の設定、 検索の実装、 リリース、 公開範囲、 下書きの方針、 relay、 ops の権限。 それぞれ 1 枚ずつ、 あなたのチェックアウトに置いてあります。 どれも保存すればすぐ効きます。 再起動は要りません。 どのファイルがどれかは作戦卓に出ます。",
    at: "2026-04-10T08:45:00.000Z",
  },
  {
    author: "ops",
    title: "お知らせ: 署名鍵の定期入れ替え",
    body: "四半期ごとの決まりで、 公開側の署名鍵はイベント終盤に自動で入れ替わります。 入れ替えは予定された作業で、 障害ではありません。 入れ替えても止まらない出し方をしておいてください。",
    at: "2026-04-10T08:50:00.000Z",
  },
];

/**
 * One brief per phase. Each names the SYMPTOM and the goal, and never the rule,
 * the class of defect, or the file line that fixes it — the same contract the
 * single problems hold themselves to.
 */
const BRIEFS = {
  join: {
    title: "参加 — 板に着く",
    body: "板はもう動いています。 まず開いて、 板の serial を控えてください。 それが最初の 1 点です。 続けて投稿の受付を開き、 自分で 1 件書いてください ── そこから先の工程はその 2 つが済んでから開きます。",
  },
  build: {
    title: "作る — 過去ログの検索",
    body: "アーカイブの検索がもう載っています。 前任者が置いていったままで、 動いてはいます。 動いていることと、 出してよいものだけを出していることは別の話です。 GET /api/selfcheck が採点と同じ検査を回します。",
  },
  ship: {
    title: "出す — 公開側の入口を開ける",
    body: "板を公開側の入口から見える状態にしてください。 リリース基盤は GET /shipyard。 記録が散らかったままだと締まりません。 それと、 四半期の鍵入れ替えが今日の終盤に予定されています。",
  },
  expose: {
    title: "公開範囲 — 星野デザインに渡す",
    body: "先方にも同じ板を使ってもらいます。 管理画面と各自の下書きは外に出さないこと。 監視は止めないこと。 access.json は portal 以下のすべてを管轄します ── まだ存在しない画面も含めて。 名前を書いていないものは通りません。",
  },
  attack: {
    title: "攻撃を受けながら — 下書きの机",
    body: "下書き機能に、 通ってはいけないリクエストが継続的に届いています。 板は止められません。 通ってはいけないものを 1 件も通さず、 正規の利用者を 1 人も止めないこと。 実測の内訳は GET /api/drill。",
  },
  incident: {
    title: "障害 — 書いたのに届いていない",
    body: "投稿は板に残るのに、 下流に届いていないものがあります。 ダッシュボードは緑のままで、 監視は一度も鳴っていません。 まず分かるようにしてください。 それと今日から、 星野デザインの担当者が障害ページ (portal/incident) を見に来ます。",
  },
  stabilize: {
    title: "立て直す — 開いたものを閉じる",
    body: "調査のために開けたものが、 開けたままになっていないか確かめてください。 ops の権限も、 公開された資格情報も同じです。 署名鍵の定期入れ替えはこの時間帯に走ります。 最後は、 全部そろった状態を崩さずに保つこと。",
  },
};

// ---------------------------------------------------------------------------
// the incident status page — the one surface this scenario owns
// ---------------------------------------------------------------------------

const INCIDENT_PATH = "/portal/incident";

/** The customer the CTO onboarded: a real principal, in another tenant, not an admin. */
const CUSTOMER =
  safeExposure.accounts.find((account) => account.tenant !== "tenka") ?? safeExposure.accounts[0];

/**
 * Identification only, through safe-exposure's own principal resolution.
 *
 * `resolvePrincipal` is private to that module, so the key-to-account mapping is
 * asked for through the one route that answers it, with an allow-everything
 * document supplied for that single call. Authorization is decided separately,
 * below, against the participant's real file. Recomputing the key derivation
 * here instead would be a second copy of a secret derivation, which is the
 * shape of drift this family exists to avoid.
 */
const IDENTIFY_ONLY = { ok: true, policy: { defaultEffect: "allow", rules: [] }, problems: [] };

function principalOf(authorization) {
  if (typeof authorization !== "string" || authorization.trim() === "") return null;
  const answer = safeExposure.handle({
    method: "GET",
    path: "/portal/me",
    authorization,
    policy: IDENTIFY_ONLY,
    record: false,
  });
  return answer.status === 200 ? (answer.body.principal ?? null) : null;
}

/**
 * How the participant's access document answers a request for the incident page.
 *
 * One decision function (`safeExposure.decide`), one document (`readPolicy`),
 * two callers: this, and the route below. There is no second, synthesized
 * decision path that could drift away from what a real request gets — the same
 * rule safe-exposure holds itself to between its gates and its socket.
 *
 * `safe-exposure`'s own probe groups never touch this path, so nothing in
 * `service_intact` says anything about it. That is the point: an access document
 * governs surfaces that did not exist when it was written.
 */
function incidentVerdict() {
  const loaded = safeExposure.readPolicy();
  if (!loaded.ok) {
    return {
      ok: false,
      customer: "policy_error",
      anonymous: "policy_error",
      note: "公開範囲の設定が読み込めていません",
    };
  }
  const ask = (principal) =>
    safeExposure.decide(loaded.policy, {
      method: "GET",
      path: INCIDENT_PATH,
      principal,
      object: null,
    });
  const customer = ask(CUSTOMER);
  const anonymous = ask(null);
  const ok = customer.effect === "allow" && anonymous.effect !== "allow";
  return {
    ok,
    customer: customer.effect,
    customerDecidedBy: customer.ruleId,
    anonymous: anonymous.effect,
    anonymousDecidedBy: anonymous.ruleId,
    note: ok
      ? "先方は障害ページを開けて、 表に出てはいません"
      : customer.effect !== "allow"
        ? "星野デザインの担当者からの障害ページへのリクエストが断られています"
        : "障害ページが鍵なしでも開きます",
  };
}

// ---------------------------------------------------------------------------
// the scorer's own state
// ---------------------------------------------------------------------------

/**
 * The availability probe set.
 *
 * `opensAt` is the phase from which a probe's verdict counts toward the score.
 * Every probe is reported from the moment it exists, so nothing arrives as a
 * surprise; the monitoring vendor's page is reported from Expose and scored from
 * Incident, which is exactly when the story says they onboard.
 */
const PROBES = {
  board: {
    opensAt: "join",
    label: "板が読める",
    symptom: "板が応答していません",
  },
  site: {
    opensAt: "join",
    label: "公開側の入口が応答する",
    symptom: "公開側の入口が 200 を返していません",
  },
  search: {
    opensAt: "join",
    label: "検索が応答する",
    symptom: "検索が結果の形を返していません",
  },
  desk: {
    opensAt: "join",
    label: "下書きの机が正規の利用者に応えている",
    symptom: "正規の利用者の操作が止まっています",
  },
  ops: {
    opensAt: "join",
    label: "夜間ジョブがいまの設定で通る",
    symptom: "夜間ジョブがいまの設定で通っていません",
  },
  monitor: {
    opensAt: "incident",
    label: "先方が障害ページを開ける",
    symptom: "障害ページの見え方が約束と違います",
  },
};

const probeState = {};
for (const [name, spec] of Object.entries(PROBES)) {
  probeState[name] = {
    ...spec,
    green: false,
    armed: false,
    armedTicks: 0,
    degradedTicks: 0,
    note: "まだ計測していません",
  };
}

const unlockedAt = {};
const ledger = {};
for (const name of PHASES) {
  ledger[name] = { openedAtMs: null, factsGreenAtMs: null, greenNow: false, earnedAtMs: null };
}

let startedAt = null;
let ticks = 0;
let integralMs = 0;
let scoredMs = 0;
let perfectSince = null;
let lastAvailability = 0;
let lastSecurity = 0;
let rotationState = "pending";
let rotationVersionAtOpen = null;
let stopped = false;

const now = () => Date.now();
const elapsedMs = () => (startedAt === null ? 0 : now() - startedAt);
const holdMs = () => minutesToMs(PLAN.hold);

// ---------------------------------------------------------------------------
// the merged context
// ---------------------------------------------------------------------------

/**
 * Every module's own `postureContext()`, merged.
 *
 * It needs no adapter because each one namespaces its whole return value under a
 * single key (`ship` / `vibe` / `exposure` / `ops` / `relay` / `defend`) and
 * every predicate reads only its own key. That is the property that makes this
 * composition possible at all, and `GET /gameday/state` publishes the namespace
 * list so a seventh module joining later cannot quietly break it.
 *
 * `observed` is shadowed with an empty set on purpose. The scorer sends real
 * requests to the board and to the search surface, and `server.mjs` records
 * every route it serves — so a gate written over `observed` would be satisfied
 * by the act of scoring. None of this event's gates reads it, and an empty set
 * is how that stays true if somebody adds one.
 */
function mergedContext() {
  const config = readConfig();
  return {
    observed: new Set(),
    config: config.value,
    configOk: config.ok,
    participantPosts: participantPosts(),
    ...ship.postureContext(),
    ...vibeBuild.postureContext(),
    ...safeExposure.postureContext(),
    ...opsSecrets.postureContext(),
    ...observability.postureContext(),
    ...defend.postureContext(),
  };
}

const NAMESPACES = ["ship", "vibe", "exposure", "ops", "relay", "defend"];

// ---------------------------------------------------------------------------
// the phase facts
// ---------------------------------------------------------------------------

const joinFacts = (context) => FACT.joinOpen(context) && FACT.joinWrote(context);
const buildFacts = (context) => FACT.vibeAnswers(context) && FACT.vibeWithheld(context);
const shipFacts = (context) => FACT.shipServing(context) && FACT.shipSingle(context);
const exposeFacts = (context) =>
  FACT.exposeSealed(context) && FACT.exposeScoped(context) && FACT.exposeService(context);
const attackFacts = (context) =>
  FACT.deskService(context) && FACT.deskReads(context) && FACT.deskPublishes(context);
const incidentFacts = (context) =>
  FACT.relayTraffic(context) && FACT.relayLogged(context) && FACT.relayHonest(context);
const stabilizeFacts = (context) =>
  FACT.opsRevoked(context) &&
  FACT.opsLeast(context) &&
  FACT.opsService(context) &&
  FACT.relayClean(context) &&
  logInvestigationIntact() &&
  FACT.shipRotation(context);

const PHASE_FACTS = {
  join: joinFacts,
  build: buildFacts,
  ship: shipFacts,
  expose: exposeFacts,
  attack: attackFacts,
  incident: incidentFacts,
  stabilize: stabilizeFacts,
};

/**
 * When each phase opens.
 *
 * Every phase after Join has BOTH a condition and a time, whichever comes first:
 * a team that solves fast is never held back by the clock, and a team that is
 * stuck on one phase still gets to see the rest of the event. The time half is
 * not decoration — a phase's gate is false before its phase opens, so `/posture`
 * withholds the receipt and the checkpoint cannot be banked early.
 */
function unlockCondition(name, context) {
  const at = (minutes) => elapsedMs() >= minutesToMs(minutes);
  if (name === "join") return true;
  if (name === "build") return joinFacts(context) || at(PLAN.build);
  if (name === "ship") return buildFacts(context) || at(PLAN.ship);
  if (name === "expose") return shipFacts(context) || at(PLAN.expose);
  if (name === "attack") return exposeFacts(context) || at(PLAN.attack);
  if (name === "incident") return context.relay.dropped > 0 || at(PLAN.incident);
  return at(PLAN.stabilize);
}

/** Once a phase is open it stays open: an event that closed a phase again would be a trap. */
function refreshUnlocks(context) {
  for (const name of PHASES) {
    if (unlockedAt[name] !== undefined) continue;
    if (!unlockCondition(name, context)) continue;
    unlockedAt[name] = elapsedMs();
    ledger[name].openedAtMs = unlockedAt[name];
    log("info", `gameday: phase ${name} is open`);
  }
}

const isOpen = (name) => unlockedAt[name] !== undefined;

const currentPhase = () => {
  let latest = "join";
  for (const name of PHASES) if (isOpen(name)) latest = name;
  return latest;
};

// ---------------------------------------------------------------------------
// the availability probes
// ---------------------------------------------------------------------------

async function askJson(path, headers = {}) {
  try {
    const response = await fetch(`${ORIGIN}${path}`, { headers });
    const text = await response.text();
    let body = {};
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
    return { status: response.status, body };
  } catch {
    return null;
  }
}

/**
 * The board itself. A real request to the real listener, so this says "the app
 * answered", not "a data structure looks right".
 */
async function probeBoard() {
  const answer = await askJson("/api/board");
  if (answer === null) return { green: false, note: "板に接続できませんでした" };
  if (answer.status !== 200) return { green: false, note: `板が ${answer.status} を返しました` };
  if (answer.body.serial !== BOARD_SERIAL) {
    return { green: false, note: "板が自分の serial を返していません" };
  }
  return { green: true, note: "ok" };
}

/**
 * The published site.
 *
 * It carries `ship.mjs`'s own scorer header, so this probe is excluded from the
 * "somebody other than the scorer asked and it answered" record that
 * `site_serving` is built on. Without the header, scoring would raise that gate
 * on the participant's behalf every tick — a vacuous pass introduced by
 * composition, into a gate whose author built machinery specifically to prevent
 * it.
 */
async function probeSite() {
  const answer = await askJson("/site/healthz", { "x-shipyard-scorer": "1" });
  if (answer === null) return { green: false, note: "公開側に接続できませんでした" };
  if (answer.status !== 200) {
    return { green: false, note: `公開側が ${answer.status} ${answer.body.error ?? ""}`.trim() };
  }
  return { green: true, note: "ok" };
}

const SEARCH_TERM = "板";

async function probeSearch() {
  const answer = await askJson(`/api/search?q=${encodeURIComponent(SEARCH_TERM)}`);
  if (answer === null) return { green: false, note: "検索に接続できませんでした" };
  if (answer.status !== 200) {
    return { green: false, note: `検索が ${answer.status} ${answer.body.error ?? ""}`.trim() };
  }
  if (typeof answer.body.query !== "string" || !Array.isArray(answer.body.matches)) {
    return { green: false, note: "検索の応答が結果の形になっていません" };
  }
  return { green: true, note: "ok" };
}

/**
 * The three facts that are already measured continuously by the module that owns
 * them. The scorer reads their verdicts rather than re-sending their traffic —
 * that is the reuse seam, and it is also why this loop is cheap.
 */
function probeFromContext(context, predicateName) {
  if (predicateName === "desk") {
    return context.defend.serviceIntact === true
      ? { green: true, note: "ok" }
      : { green: false, note: PROBES.desk.symptom };
  }
  if (predicateName === "ops") {
    return context.ops.digestHealthy === true
      ? { green: true, note: "ok" }
      : { green: false, note: PROBES.ops.symptom };
  }
  const verdict = incidentVerdict();
  return { green: verdict.ok, note: verdict.note };
}

async function runProbes(context, board) {
  const results = {
    board,
    site: await probeSite(),
    search: await probeSearch(),
    desk: probeFromContext(context, "desk"),
    ops: probeFromContext(context, "ops"),
    monitor: probeFromContext(context, "monitor"),
  };
  for (const [name, result] of Object.entries(results)) {
    const state = probeState[name];
    state.green = result.green;
    state.note = result.note;
  }
  return results;
}

/**
 * A probe is committed once it has been observed working, and not before.
 *
 * That is what an availability contract means: a service you have never brought
 * up owes nothing, and a service you brought up and then took away owes the
 * whole time it was gone. It also removes the only way the error budget could be
 * unfair — a team is never charged for the fifteen minutes before they had
 * anything to serve.
 */
function updateArming() {
  const phase = phaseIndex(currentPhase());
  for (const state of Object.values(probeState)) {
    if (phase < phaseIndex(state.opensAt)) continue;
    if (!state.armed) {
      if (!state.green) continue;
      state.armed = true;
    }
    state.armedTicks += 1;
    if (!state.green) state.degradedTicks += 1;
  }
}

function availability() {
  const armed = Object.values(probeState).filter((state) => state.armed);
  if (armed.length === 0) return 0;
  return armed.filter((state) => state.green).length / armed.length;
}

function budget() {
  let armed = 0;
  let degraded = 0;
  for (const state of Object.values(probeState)) {
    armed += state.armedTicks;
    degraded += state.degradedTicks;
  }
  return { armedTicks: armed, degradedTicks: degraded, allowed: armed * ERROR_BUDGET, ok: degraded <= armed * ERROR_BUDGET };
}

// ---------------------------------------------------------------------------
// the security fraction
// ---------------------------------------------------------------------------

/**
 * Six facts, every one of them an imported gate. Authorization on the desk,
 * authentication and authorization on the portal, what the public archive
 * surface is allowed to publish, how wide the ops credential's permissions are,
 * whether a secret is sitting on a surface this app serves, and whether the
 * release holds a reference or a copy.
 */
function securityFacts(context) {
  return {
    "desk-authz": FACT.deskReads(context) && FACT.deskPublishes(context),
    "portal-authn": FACT.exposeSealed(context) && FACT.exposeScoped(context),
    "archive-scope": FACT.vibeWithheld(context),
    permissions: FACT.opsRevoked(context) && FACT.opsLeast(context),
    "log-hygiene": FACT.relayClean(context) && logInvestigationIntact(),
    "release-binding": FACT.shipRotation(context),
  };
}

/**
 * The half of `observability.mjs`'s log lesson that lives in its checkpoint
 * rather than in its gate, obtained by importing the checkpoint rather than by
 * restating what it asks for.
 *
 * `gates.credential_out_of_logs` says the log is on, carrying both outcomes, and
 * not carrying the credential — which a setting that cuts every line down to an
 * id also satisfies, having thrown the investigation away with the secret. The
 * rest of that lesson is precondition B inside the `leak-shut` checkpoint: the
 * lines must still name the shard, its code, the target and the epoch.
 *
 * That handler takes a submission, so it is used the way a participant uses it —
 * with the receipt the relay itself writes into the log, and only while the
 * setting that produces that receipt is the one in force. Nothing about the
 * condition is restated here; a change to precondition B upstream arrives with
 * the import.
 */
const SAFE_TOKEN_PATTERN = /safe-token=([0-9a-f]+)/;

function safeTokenFromLog() {
  for (const line of recentLines(500)) {
    const found = SAFE_TOKEN_PATTERN.exec(line.message);
    if (found !== null) return found[1];
  }
  return null;
}

function logInvestigationIntact() {
  const token = safeTokenFromLog();
  if (token === null) return false;
  return observability.checks["leak-shut"](token) === true;
}

const fractionOf = (facts) => {
  const values = Object.values(facts);
  return values.filter(Boolean).length / values.length;
};

// ---------------------------------------------------------------------------
// the scheduled key rotation
// ---------------------------------------------------------------------------

async function currentKeyVersion() {
  const answer = await askJson("/shipyard/secrets");
  if (answer === null || answer.status !== 200) return null;
  const entry = Array.isArray(answer.body.secrets) ? answer.body.secrets[0] : undefined;
  return entry === undefined ? null : entry.version;
}

/**
 * The quarterly key rotation, performed once, when Stabilize opens.
 *
 * It is scheduled maintenance a correctly built release is supposed to survive —
 * announced on the board from the first minute and in the Ship brief — and not a
 * fault this platform injects. It is idempotent by construction rather than by
 * a flag: the version the store held when Stabilize opened is recorded, and the
 * rotation runs only while the store is still at that version. A retried tick, a
 * duplicated call, or a participant who rotated the key themselves all leave the
 * store exactly one version further on, never two.
 */
async function maybeRotate() {
  if (rotationState === "done" || !isOpen("stabilize")) return;
  if (rotationVersionAtOpen === null) {
    rotationVersionAtOpen = await currentKeyVersion();
    if (rotationVersionAtOpen === null) return;
  }
  const version = await currentKeyVersion();
  if (version === null) return;
  if (version !== rotationVersionAtOpen) {
    rotationState = "done";
    log("info", "gameday: 署名鍵はすでに入れ替わっています (定期作業は不要)");
    return;
  }
  const response = await fetch(`${ORIGIN}/shipyard/secrets/rotate`, { method: "POST" }).catch(
    () => null,
  );
  if (response === null) return;
  await response.text();
  rotationState = "done";
  log("info", "gameday: 予定されていた署名鍵の入れ替えを実施しました");
}

// ---------------------------------------------------------------------------
// the tick
// ---------------------------------------------------------------------------

/**
 * Ask the search surface to re-measure itself.
 *
 * `vibe-build`'s posture is a report of the last measurement, keyed on the
 * feature file's stamp, and the only public way to drive that measurement is the
 * self-check route the participant uses. So the scorer uses the same one, on a
 * slower cadence than the tick — the measurement spawns a batch of probe
 * requests through the participant's own code, and running it every two seconds
 * would be the dominant cost in the container.
 */
async function remeasureSearch() {
  try {
    await fetch(`${ORIGIN}/api/selfcheck`);
  } catch {
    // Not listening yet, or busy. The next cycle will pick it up; a scorer that
    // logged this would be the loudest thing in a log other phases depend on.
  }
}

async function tick() {
  if (stopped) return;
  try {
    ticks += 1;
    const context = mergedContext();

    const board = await probeBoard();
    if (startedAt === null) {
      // The event starts when the board is up, not when this module was
      // imported: `server.mjs` calls listen() after the import, so the first
      // ticks would otherwise charge a team for the app's own boot.
      if (!board.green) return;
      startedAt = now();
      log("info", `gameday: ${MINUTES} 分のイベントを開始しました`);
    }

    if (ticks % MEASURE_EVERY_TICKS === 1) await remeasureSearch();

    refreshUnlocks(context);
    await runProbes(context, board);
    updateArming();
    await maybeRotate();

    const facts = securityFacts(context);
    const a = availability();
    const s = fractionOf(facts);
    lastAvailability = a;
    lastSecurity = s;
    integralMs += a * s * TICK_MS;
    scoredMs += TICK_MS;

    if (a >= 1 && s >= 1) {
      if (perfectSince === null) perfectSince = now();
    } else {
      perfectSince = null;
    }

    for (const name of PHASES) {
      const entry = ledger[name];
      const green = isOpen(name) && PHASE_FACTS[name](context);
      entry.greenNow = green;
      if (green && entry.factsGreenAtMs === null) entry.factsGreenAtMs = elapsedMs();
    }
  } catch (error) {
    // A scorer that died quietly would freeze every number at its last value and
    // leave the participant with no way to know. Say so, and keep going.
    log("error", `gameday tick failed: ${error.message}`);
  } finally {
    if (!stopped) setTimeout(tick, TICK_MS).unref?.();
  }
}

setTimeout(tick, Math.min(TICK_MS, 100)).unref?.();

// ---------------------------------------------------------------------------
// posture
// ---------------------------------------------------------------------------

export const gateTokens = true;

/**
 * The scorer's own state, as a snapshot the gate predicates can read.
 *
 * Nothing here re-runs a probe: `/posture` is a GET and stays one. The
 * availability fraction is the last completed tick's, at most one tick old; the
 * hold and the error budget are read fresh from counters that only ever
 * increase, which is what makes them safe to grade a verdict on.
 */
function scorerSnapshot() {
  const spent = budget();
  const hold = holdMs();
  const heldFor = perfectSince === null ? 0 : now() - perfectSince;
  return {
    minutes: MINUTES,
    elapsedMs: elapsedMs(),
    unlocked: Object.fromEntries(PHASES.map((name) => [name, isOpen(name)])),
    availability: lastAvailability,
    security: lastSecurity,
    withinBudget: spent.ok,
    budget: spent,
    holdMs: hold,
    heldForMs: heldFor,
    holdSatisfied: perfectSince !== null && heldFor >= hold,
  };
}

export function postureContext() {
  return { ...mergedContext(), gameday: scorerSnapshot() };
}

/**
 * Eight gates: one per phase, and the sign-off.
 *
 * Every phase gate is the conjunction of the phase being open, the facts its
 * source problem measures, and the run still being inside its availability
 * budget. The closure half is never graded on its own — `expose` carries
 * safe-exposure's `service_intact`, `attack` carries defend's, `stabilize`
 * carries the ops job's — which is the "correctness precondition before any
 * absence check" discipline those modules already hold, imported.
 */
export const gates = {
  gameday_join: (context) => context.gameday.unlocked.join === true && joinFacts(context),

  gameday_build: (context) =>
    context.gameday.unlocked.build === true &&
    context.gameday.withinBudget === true &&
    buildFacts(context),

  gameday_ship: (context) =>
    context.gameday.unlocked.ship === true &&
    context.gameday.withinBudget === true &&
    shipFacts(context),

  gameday_expose: (context) =>
    context.gameday.unlocked.expose === true &&
    context.gameday.withinBudget === true &&
    exposeFacts(context),

  gameday_attack: (context) =>
    context.gameday.unlocked.attack === true &&
    context.gameday.withinBudget === true &&
    attackFacts(context),

  gameday_incident: (context) =>
    context.gameday.unlocked.incident === true &&
    context.gameday.withinBudget === true &&
    incidentFacts(context),

  gameday_stabilize: (context) =>
    context.gameday.unlocked.stabilize === true &&
    context.gameday.withinBudget === true &&
    stabilizeFacts(context),

  /**
   * The sign-off, and the only place in this event where "at the same time" is
   * expressed as a condition rather than as a sentence.
   *
   * Every phase's facts hold right now; availability and security have BOTH been
   * whole, without one tick's interruption, for the whole hold (any tick where
   * either was short resets it); and the run is inside its availability budget,
   * which no restart and no later repair can give back. A team that stopped the
   * service to fix a security problem fails the budget. A team that stayed up
   * and left a defect fails the hold, because security was never whole.
   */
  gameday_signoff: (context) =>
    context.gameday.withinBudget === true &&
    context.gameday.holdSatisfied === true &&
    PHASES.every((name) => context.gameday.unlocked[name] === true && PHASE_FACTS[name](context)),
};

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------

const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, status, body) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

const FILES = {
  board: process.env.CONFIG_HINT ?? "config/app.json",
  search: process.env.FEATURE_HINT ?? "feature/search.mjs",
  release: process.env.RELEASE_HINT ?? "release/release.json",
  portal: process.env.ACCESS_HINT ?? EXPOSURE_POLICY,
  desk: process.env.POLICY_HINT ?? DESK_POLICY,
  relay: process.env.RELAY_HINT ?? "relay/relay.json",
  ops: process.env.OPS_HINT ?? "ops/ops.json",
};

const PHASE_FILES = {
  join: ["board"],
  build: ["search"],
  ship: ["release"],
  expose: ["portal"],
  attack: ["desk"],
  incident: ["relay", "portal"],
  stabilize: ["ops", "relay", "release"],
};

function eventState() {
  const context = mergedContext();
  const snapshot = scorerSnapshot();
  const facts = securityFacts(context);
  return {
    event: {
      minutes: MINUTES,
      scale: SCALE,
      tickMs: TICK_MS,
      startedAt: startedAt === null ? null : new Date(startedAt).toISOString(),
      elapsedMs: snapshot.elapsedMs,
      phase: currentPhase(),
      schedule: Object.fromEntries(
        PHASES.map((name) => [
          name,
          {
            openedAtMs: ledger[name].openedAtMs,
            atMinutes: name === "join" ? 0 : PLAN[name],
            atMs: name === "join" ? 0 : minutesToMs(PLAN[name]),
            open: isOpen(name),
          },
        ]),
      ),
      files: FILES,
    },
    availability: {
      share: snapshot.availability,
      budget: snapshot.budget,
      withinBudget: snapshot.withinBudget,
      probes: Object.entries(probeState).map(([name, state]) => ({
        name,
        label: state.label,
        opensAt: state.opensAt,
        scored: phaseIndex(currentPhase()) >= phaseIndex(state.opensAt),
        armed: state.armed,
        green: state.green,
        note: state.note,
        armedTicks: state.armedTicks,
        degradedTicks: state.degradedTicks,
      })),
    },
    security: { share: fractionOf(facts), facts },
    score: {
      integralMs: Math.round(integralMs),
      scoredMs,
      share: scoredMs === 0 ? 0 : integralMs / scoredMs,
      holdMs: snapshot.holdMs,
      heldForMs: snapshot.heldForMs,
      holdSatisfied: snapshot.holdSatisfied,
    },
    phases: PHASES.map((name) => ({
      name,
      open: isOpen(name),
      openedAtMs: ledger[name].openedAtMs,
      factsGreenAtMs: ledger[name].factsGreenAtMs,
      greenNow: isOpen(name) && PHASE_FACTS[name](context),
      files: PHASE_FILES[name].map((key) => FILES[key]),
    })),
    incidentPage: incidentVerdict(),
    /**
     * The composition, published rather than asserted in prose. `duplicates` and
     * `baseCollisions` are empty or this container did not boot; `facts` is the
     * provenance of every scored predicate, decided by identity against each
     * module's own `gates` export.
     */
    composition: {
      namespaces: NAMESPACES,
      contributors: CONTRIBUTORS.map(([namespace, table]) => ({
        namespace,
        routes: Object.keys(table).length,
      })),
      routes: {
        total: routeOwner.size,
        duplicates: duplicateRoutes,
        baseCollisions,
      },
      facts: PROVENANCE,
      reexpressed: REEXPRESSED,
      // Empty is the goal. A name here is a scored predicate that answered
      // without consulting the state it is about — the shape of vacuous pass
      // that composition makes easy and that nothing else would report.
      vacuousScoredFacts: auditVacuity(context),
      accessDocuments: { portal: EXPOSURE_POLICY, desk: DESK_POLICY },
    },
  };
}

function consolePage() {
  const state = eventState();
  const phase = state.event.phase;
  const brief = BRIEFS[phase];
  const phaseRows = state.phases
    .map(
      (entry) => `<tr><td><code>${escapeHtml(entry.name)}</code></td>
    <td>${entry.open ? "開いています" : `${Math.round((entry.name === "join" ? 0 : PLAN[entry.name]))} 分後、 または条件成立で`}</td>
    <td>${entry.greenNow ? "緑" : "まだ"}</td>
    <td><code>${escapeHtml(entry.files.join(" / "))}</code></td></tr>`,
    )
    .join("\n");
  const probeRows = state.availability.probes
    .map(
      (probe) => `<tr><td>${escapeHtml(probe.label)}</td>
    <td>${probe.scored ? (probe.armed ? "採点中" : "まだ一度も緑になっていません") : `${escapeHtml(probe.opensAt)} から採点`}</td>
    <td>${probe.green ? "緑" : "赤"}</td>
    <td>${escapeHtml(probe.note)}</td></tr>`,
    )
    .join("\n");
  const factRows = Object.entries(state.security.facts)
    .map(
      ([name, ok]) =>
        `<tr><td><code>${escapeHtml(name)}</code></td><td>${ok ? "緑" : "赤"}</td><td><code>${escapeHtml(String(PROVENANCE[name] ?? ""))}</code></td></tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="ja"><head><meta name="color-scheme" content="light dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>StackStack GameDay 作戦卓</title></head>
<body style="font-family:system-ui;max-width:60rem;margin:2.5rem auto;line-height:1.7;padding:0 1rem">
<h1>StackStack GameDay 作戦卓</h1>
<p>board serial: <code>${escapeHtml(BOARD_SERIAL)}</code> / 予定時間 <code>${MINUTES}</code> 分 / 経過 <code>${Math.round(state.event.elapsedMs / 1000)}</code> 秒</p>

<h2>いまの局面: ${escapeHtml(brief.title)}</h2>
<p>${escapeHtml(brief.body)}</p>

<h2>工程</h2>
<table border="1" cellpadding="6" cellspacing="0"><tr><th>工程</th><th>開く条件</th><th>状態</th><th>触るファイル</th></tr>
${phaseRows}</table>

<h2>止めていないか (可用性)</h2>
<p>いまの割合 <code>${state.availability.share.toFixed(2)}</code> /
 使った猶予 <code>${state.availability.budget.degradedTicks}</code> ticks
 (許容 <code>${state.availability.budget.allowed.toFixed(1)}</code>) →
 <strong>${state.availability.withinBudget ? "まだ範囲内です" : "使い切りました"}</strong></p>
<p>一度でも緑になった経路は、 そこから先ずっと採点されます。 落とした時間は戻りません。</p>
<table border="1" cellpadding="6" cellspacing="0"><tr><th>経路</th><th>採点</th><th>いま</th><th>症状</th></tr>
${probeRows}</table>

<h2>閉じているか (安全性)</h2>
<p>いまの割合 <code>${state.security.share.toFixed(2)}</code></p>
<table border="1" cellpadding="6" cellspacing="0"><tr><th>事実</th><th>状態</th><th>実測しているモジュール</th></tr>
${factRows}</table>

<h2>いまの点</h2>
<p>連続点 <code>${state.score.integralMs}</code> / 満点比 <code>${state.score.share.toFixed(3)}</code></p>
<p>両方そろってから <code>${Math.round(state.score.heldForMs / 1000)}</code> 秒
 (合格印に必要 <code>${Math.round(state.score.holdMs / 1000)}</code> 秒)。
 どちらかが欠けた瞬間に 0 に戻ります。</p>

<h2>この卓から見られるもの</h2>
<pre>GET gameday          この画面
GET gameday/state    いまの状態 (JSON、 上と同じもの)
GET gameday/score    連続点だけ
GET gameday/results  チームごと・工程ごとの結果 (終了後に回収するもの)
GET posture          8 つの gate と受領証
GET portal/incident  障害ページ (公開範囲の設定が判定します)</pre>
</body></html>`;
}

/** What the customer is shown on the incident page. Symptoms and counts, never a rule. */
function incidentSummary() {
  const context = mergedContext();
  return {
    phase: currentPhase(),
    archive: { delivered: context.relay.archived, missing: context.relay.dropped },
    published: probeState.site.green,
    board: probeState.board.green,
    note: "板への書き込みは受け付けています。 下流への反映が遅れている場合があります。",
  };
}

export const routes = {
  ...ship.routes,
  ...vibeBuild.routes,
  ...safeExposure.routes,
  ...opsSecrets.routes,
  ...observability.routes,
  ...defend.routes,

  "GET /gameday": (request, response) => {
    request.resume();
    return sendHtml(response, 200, consolePage());
  },

  "GET /gameday/state": (request, response) => {
    request.resume();
    return sendJson(response, 200, eventState());
  },

  "GET /gameday/score": (request, response) => {
    request.resume();
    const snapshot = scorerSnapshot();
    return sendJson(response, 200, {
      availability: snapshot.availability,
      security: snapshot.security,
      integralMs: Math.round(integralMs),
      scoredMs,
      share: scoredMs === 0 ? 0 : integralMs / scoredMs,
      withinBudget: snapshot.withinBudget,
      budget: snapshot.budget,
      holdMs: snapshot.holdMs,
      heldForMs: snapshot.heldForMs,
      holdSatisfied: snapshot.holdSatisfied,
    });
  },

  /**
   * The per-phase record an organiser collects at the end.
   *
   * It is an operational record and not an anti-cheat mechanism: the participant
   * owns the machine, so anything this container signs is forgeable by them. The
   * authoritative seam stays the platform-recorded `/verify` verdicts, whose
   * receipts come from a per-boot secret that is not derivable.
   */
  "GET /gameday/results": (request, response) => {
    request.resume();
    const context = mergedContext();
    const snapshot = scorerSnapshot();
    return sendJson(response, 200, {
      event: {
        minutes: MINUTES,
        scale: SCALE,
        boardSerial: BOARD_SERIAL,
        startedAt: startedAt === null ? null : new Date(startedAt).toISOString(),
        elapsedMs: snapshot.elapsedMs,
        finished: snapshot.elapsedMs >= minutesToMs(MINUTES),
      },
      phases: PHASES.map((name) => ({
        phase: name,
        openedAtMs: ledger[name].openedAtMs,
        factsFirstGreenAtMs: ledger[name].factsGreenAtMs,
        greenAtEnd: isOpen(name) && PHASE_FACTS[name](context),
        facts: phaseFactBreakdown(name, context),
      })),
      availability: {
        budget: snapshot.budget,
        withinBudget: snapshot.withinBudget,
        probes: Object.entries(probeState).map(([name, state]) => ({
          name,
          armed: state.armed,
          armedTicks: state.armedTicks,
          degradedTicks: state.degradedTicks,
          greenAtEnd: state.green,
        })),
      },
      security: securityFacts(context),
      score: {
        integralMs: Math.round(integralMs),
        scoredMs,
        share: scoredMs === 0 ? 0 : integralMs / scoredMs,
        holdSatisfied: snapshot.holdSatisfied,
      },
    });
  },

  /**
   * The customer's incident status page.
   *
   * Governed by the participant's own access document through
   * `safeExposure.decide` — the same function, on the same file, that every
   * `/portal/*` request goes through. `safe-exposure`'s probe groups do not
   * touch this path, so nothing about it is implied by the Expose phase's gates:
   * an access document has to be right about surfaces that did not exist when it
   * was written, and this is where that is measured.
   */
  "GET /portal/incident": (request, response) => {
    request.resume();
    const loaded = safeExposure.readPolicy();
    if (!loaded.ok) {
      return sendJson(response, 503, { error: "policy_error", detail: loaded.problems });
    }
    const principal = principalOf(request.headers.authorization);
    const decision = safeExposure.decide(loaded.policy, {
      method: "GET",
      path: INCIDENT_PATH,
      principal,
      object: null,
    });
    if (decision.effect !== "allow") {
      return sendJson(response, principal === null ? 401 : 403, {
        error: principal === null ? "unauthenticated" : "forbidden",
        decidedBy: decision.ruleId,
      });
    }
    return sendJson(response, 200, { incident: incidentSummary(), decidedBy: decision.ruleId });
  },
};

function phaseFactBreakdown(name, context) {
  if (name === "join") return { posts_open: FACT.joinOpen(context), post_created: FACT.joinWrote(context) };
  if (name === "build") {
    return { search_answers: FACT.vibeAnswers(context), drafts_withheld: FACT.vibeWithheld(context) };
  }
  if (name === "ship") {
    return { site_serving: FACT.shipServing(context), single_release: FACT.shipSingle(context) };
  }
  if (name === "expose") {
    return {
      admin_sealed: FACT.exposeSealed(context),
      drafts_scoped: FACT.exposeScoped(context),
      service_intact: FACT.exposeService(context),
    };
  }
  if (name === "attack") {
    return {
      service_intact: FACT.deskService(context),
      reads_held: FACT.deskReads(context),
      publishes_held: FACT.deskPublishes(context),
    };
  }
  if (name === "incident") {
    return {
      traffic_seen: FACT.relayTraffic(context),
      failures_logged: FACT.relayLogged(context),
      health_honest: FACT.relayHonest(context),
    };
  }
  return {
    legacy_revoked: FACT.opsRevoked(context),
    least_privilege: FACT.opsLeast(context),
    service_intact: FACT.opsService(context),
    credential_out_of_logs: FACT.relayClean(context),
    log_investigation_intact: logInvestigationIntact(),
    survives_key_rotation: FACT.shipRotation(context),
  };
}

// ---------------------------------------------------------------------------
// checkpoints
// ---------------------------------------------------------------------------

const matches = (submission, expected) => submission.trim() === expected;

/** Re-measure everything at verdict time rather than trusting a value seen earlier. */
const measure = () => posture({ gates, gateTokens: true }, postureContext());

/**
 * A phase checkpoint.
 *
 * Two things are required and neither of them is the submission: the phase gate
 * must be true *right now* — which carries the phase being open, its source
 * problem's facts, and the run still being inside its availability budget — and
 * only then is the receipt compared. `/posture` emits that receipt only while
 * the same gate is true, so it cannot be collected early and cashed after
 * something was broken.
 */
function phaseCheck(gate) {
  return (submission) => {
    const state = measure();
    if (state.gates[gate] !== true) return false;
    return matches(submission, gateToken(gate));
  };
}

export const checks = {
  /**
   * The cheapest check in the event, and deliberately the first.
   *
   * It is the board's serial, printed on the board's own front page: one page
   * load, no config edit, no write. Every team scores inside the first few
   * minutes, including a team that is stuck on everything else — which is what
   * "a first score within fifteen minutes" has to mean if it is a floor rather
   * than an average. The handler is `onboarding.mjs`'s own, imported, so the
   * shakedown problem and this event grade arrival identically.
   */
  join: onboarding.checks["board-open"],

  build: phaseCheck("gameday_build"),
  ship: phaseCheck("gameday_ship"),
  expose: phaseCheck("gameday_expose"),
  attack: phaseCheck("gameday_attack"),
  incident: phaseCheck("gameday_incident"),
  stabilize: phaseCheck("gameday_stabilize"),
  signoff: phaseCheck("gameday_signoff"),
};

/** Test hook: stop the scorer's loop so a suite can tear a run down deterministically. */
export function stopScorer() {
  stopped = true;
}
