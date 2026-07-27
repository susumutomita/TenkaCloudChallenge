# StackStack GameDay — A Whole Day, In One Run

> **Status: `draft`.** The composition works and is covered end to end by
> `scripts/stackstack-gameday.test.ts`, which drives the real app over real HTTP
> with no Docker and no AWS. What has **not** happened yet is a human playtest at
> full length and one real `make local` run. See
> [What is still unverified](#what-is-still-unverified).

TenkaCloud, the morning of your fourth day. The previous SRE is gone. The CTO
stands by your desk with a coffee and says: *"today I want you to keep your hands
on the board all day."*

The internal message board gets a search feature, a public entrance, and a
customer. Traffic never stops. Partway through, writes stop arriving downstream
while the dashboard stays green and nothing pages. Late in the day, the quarterly
signing-key rotation runs exactly as scheduled.

Two things are measured, all day: **that you did not take it down**, and **that
you did not leave it open**. Neither on its own is full marks.

## What this is

The seven StackStack single problems — onboarding, vibe-build, ship,
safe-exposure, defend, observability, secrets — run as **one continuous 90- or
120-minute event on one application**, with one story and one clock.

It is delivered as an AWS-free local-play container (AGENT.md §13). One command:

```bash
make local PROBLEM=stackstack-gameday                            # 90 minutes
STACKSTACK_GAMEDAY_MINUTES=120 make local PROBLEM=stackstack-gameday   # 120 minutes
```

Then open <http://127.0.0.1:18080/gameday> — the event console — and
<http://127.0.0.1:18080/> for the board itself.

## It composes; it does not reimplement

`SCENARIO=gameday` is a single file, `stackstack-base/app/scenarios/gameday.mjs`,
which **imports** the six single-problem scenario modules and merges their
routes, their posture contexts and their gates.

Every scored predicate is the function object taken from that module's own
`gates` export. Not a copy of it — the object itself. The provenance of each one
is decided at boot by identity comparison and published on
`GET /gameday/state` under `composition.facts`:

```json
{ "deskReads": "defend.reads_held", "shipRotation": "ship.survives_key_rotation",
  "relayClean": "relay.credential_out_of_logs", "vibeWithheld": "gameday", … }
```

The test suite asserts that map. If somebody later replaces an imported predicate
with a hand-written one that looks equivalent, its provenance turns into
`gameday` and CI fails — which a comment claiming reuse cannot do. A fix to
`defend.mjs` or `ship.mjs` therefore reaches this event without anybody
remembering that it should.

Three things came along whole with the imports and are worth naming, because they
are the expensive parts of each source problem:

- `defend.mjs`'s **drill** — its own timer sending real loopback HTTP every
  round, judged against its private `intendedAllow`, with rotating draft ids.
- `safe-exposure.mjs`'s **`handle()`** — the one decision path both the socket
  and the gates go through, and its five probe groups.
- `vibe-build.mjs`'s **child-process harness** — the participant's code still
  runs in a separate process spawned with `env: {}`, so it cannot mint receipts
  or read `FLAG_SEED`. The suite re-pins that property after composition rather
  than assuming it survived.

### What had to be re-expressed, and why

**The receipt layer.** `gateToken(name)` is keyed on the gate name alone, and
three of the imported modules each declare a gate literally called
`service_intact` — inside one process their receipts would be the same string. So
the GameDay mints its own receipts under `gameday_*` names and never reuses a
constituent's receipt value. Every measurement behind a receipt is imported; only
the naming is new.

**One predicate, `vibeWithheld`.** `vibe-build.mjs` currently exports
`gates.drafts_withheld` as `() => true`, so it reports green whatever the feature
file does. Importing that predicate would put a vacuous pass at the centre of the
security fraction. The GameDay reads the *measured* value out of
`vibe-build`'s own `postureContext()` instead — the measurement is still entirely
that module's — and the defect is reported upstream rather than patched here,
because this scenario does not edit its siblings.

### Why the AWS `battles/stackstack` was not extended instead

`battles/stackstack` is a CloudFormation `phased-polling` Battle: an EC2 host
serving `/meta` and `/score`, probed by the platform's health-check Lambda. A
JavaScript scenario module cannot execute there.

"Reuse each single problem's attack, verification and scoring logic" would
therefore have to mean re-expressing six gate families and six probe families in
that host's own language and its `vibe-status` scripts. Concretely: six gate
reimplementations, six probe reimplementations, approximately zero lines actually
shared, no shared test suite, drift the first time either side is edited, and no
way to verify any of it without a live AWS account.

**The existing Battle is untouched.** The two share a board as a subject and a
name family. They do not share code, and this README says so rather than implying
a portability that does not exist.

## The seven phases

| phase | what happens | the file you touch | opens when (90 / 120 min) |
| --- | --- | --- | --- |
| **Join** | reach the board, open it for posts, write one | `local/config/app.json` | t = 0, always |
| **Build** | the archive search returns only what may be returned | `local/feature/search.mjs` | Join's facts, or 8 / 10 min |
| **Ship** | the published entrance answers; the release plane is tidy | `local/release/release.json` | Build's gate, or 20 / 26 min |
| **Expose** | the customer gets the board, and only what they should | `local/access/access.json` | Ship's gate, or 30 / 40 min |
| **Attack** | the drafts desk holds under continuous adversarial traffic | `local/policy/access.json` | Expose's gate, or 42 / 56 min |
| **Incident** | the lost writes become visible; the health check tells the truth | `local/relay/relay.json` | the relay dropped a write, or 55 / 74 min |
| **Stabilize** | everything opened during the day is closed again | `local/ops/ops.json` (+ relay, release) | 70 / 95 min |

Every phase after Join has **both** a condition and a time, whichever comes
first: a fast team is never held back by the clock, and a stuck team still gets
to see the rest of the event.

**The time conditions are not decoration.** A phase's gate is false until its
phase opens, so `/posture` withholds the receipt and a checkpoint cannot be banked
early — even by a team whose underlying facts happen to be green already.

## How scoring works

### The tick

Every `TICK_MS` (2000 by default) the scorer computes two fractions.

**A — availability and normal use** (six probes):

| probe | how it is measured |
| --- | --- |
| the board is readable | real `GET /api/board`, and it returns its own serial |
| the published entrance answers | real `GET /site/healthz`, carrying `ship.mjs`'s own scorer header |
| search returns the shape of a result | real `GET /api/search?q=…` through the participant's code |
| the drafts desk is serving legitimate users | `defend`'s drill's own window counters |
| the nightly job passes as configured | `secrets`' own `digestHealthy` |
| the customer can open the incident page | `safeExposure.decide` on the participant's document (from Incident) |

**S — security** (six facts, each an imported gate): desk authorization; portal
authentication and authorization; what the public archive surface may publish;
how wide the ops credential's permissions are; whether a credential is sitting on
a surface this app serves; whether the release holds a reference to the signing
key or a copy of it.

### A × S, not A + S

One tick's contribution is the **product**. A tick with A = 0 is worth zero
whatever S is — perfect security is worth literally nothing while the service is
dark.

That is the property a sum does not have. Under `wA·A + wS·S`, a team that shuts
the desk off still banks the whole security half every tick, so shutting down
becomes a *rational* move for the security score. Under a product it is never
worth anything, and the blunt shutdowns are each individually measured:
`enabled: false` on the desk answers 503, which the drill counts as `broken`
rather than `heldByPolicy`; deleting the live release takes `/site` to 503;
emptying `healthCheckProbes` fails observability's third counterfactual world.

### Why "stop the service to fix it, then come back" still loses

A product removes the *reward* for being dark. It imposes no cost that survives
to the scoreboard — the continuous number lives inside the container, and the
platform records only the eight checkpoint verdicts. Left there, going dark would
be a free planning tool: work without adversarial pressure, come back clean for
the last ten minutes.

So degradation is kept as **two monotone counters and read back as a predicate at
verdict time**:

- A path that has ever been green is **committed**. From then on, every tick
  increments its `armedTicks`, and every tick it is not green increments its
  `degradedTicks`. Neither ever decreases, and nothing clears them.
- `degradedTicks <= 0.05 × armedTicks` is a **required conjunct of every phase
  check after Join, and of the sign-off**. No restart and no later repair gives
  it back.

A team that answers 503 everywhere from minute 20 to minute 75 has spent about
sixty percent of its allowance-bearing time degraded, against a five percent
budget. They cannot pass a single phase check afterwards, however clean they are
at the end.

A path is committed only once it has been *observed working*, which is what makes
this fair: nobody is charged for the fifteen minutes before they had anything to
serve. What it charges for is taking away something you had.

### Why "keep it up and leave the vulnerability" also loses

Any failing security fact makes S < 1, so `perfectSince` never starts. The
sign-off re-measures at verdict time that A and S have **both** been whole,
without one tick's interruption, for the whole hold (5 minutes at 90; 8 at 120).
One thing left open means the timer never runs once.

Collecting the receipt early and breaking something afterwards does not work
either: `/posture` emits a gate's receipt only while that gate is true.

Full marks require A = S = 1 **simultaneously and continuously**, which is what
"hold availability and security at the same time" means — expressed as a
condition in code rather than a sentence in a README.

### The eight checkpoints

| id | points | what it grades |
| --- | --- | --- |
| `join` | 60 | the board's serial |
| `build` | 140 | search answers **and** withholds |
| `ship` | 140 | the entrance served **and** exactly one live release |
| `expose` | 140 | admin sealed **and** drafts scoped **and** the service intact |
| `attack` | 160 | reads held **and** publishes held **and** the desk still serving |
| `incident` | 140 | traffic seen **and** failures logged **and** the health check honest |
| `stabilize` | 160 | credential closed **and** permissions narrow **and** the job passing **and** the log clean **and** the release surviving rotation |
| `signoff` | 260 | all of the above at once, held, inside the budget |

Battles are exempt from the Challenge tier point table (SCORING.md §4). Every
closure fact is paired with its module's own service fact — the "correctness
precondition before any absence check" discipline those modules already hold,
imported. Nothing here can be farmed by switching something off.

**The first point is deliberately the cheapest.** `join` is one page load: no
config edit, no write. Every team scores within a few minutes, including one that
is stuck on everything else — "a first score inside fifteen minutes" is a floor,
not an average.

## The three chains

A chain is a decision made in one phase that arrives as a consequence in a later
one. Nothing is injected; every one of these is caused by the participant.

### 1. Ship → Stabilize — the pasted key

Pasting the key value into `release.json` **passes** the health gate, because that
gate only asks whether the candidate can sign with the key the store holds *right
now*, and a fresh copy can. `site_serving` goes green and the Ship checkpoint can
be banked with it — deliberately, so the chain fires against the leaders and not
only against teams already behind. `survives_key_rotation` is false meanwhile, and
the shipyard console says so, without anything having happened yet.

At the start of Stabilize the **scheduled quarterly rotation** runs. The pasted
key is no longer accepted, `/site` falls to 503, the availability probe goes red,
the hold resets, and the allowance starts draining until the release is changed to
`{"fromSecret": "board-signing-key"}` and redeployed. A team that shipped a
reference notices nothing.

The rotation is announced on the board from minute one and in the Ship brief. It
is scheduled maintenance a correct release survives, not injected failure — and
it is idempotent by construction: the store's version at the moment Stabilize
opened is recorded, and the rotation runs only while the store is still at that
version, so a retried tick or a participant who rotated it themselves leaves the
store exactly one version further on, never two.

### 2. Expose → Incident — the surface that did not exist yet

`access.json` governs **everything** under `/portal` — including surfaces that did
not exist when it was written. During Incident, the customer starts polling
`GET /portal/incident`.

None of safe-exposure's probe groups touch that path, so nothing about it is
implied by the Expose gates. A deny-by-default document — the shortest shape that
satisfies `admin_sealed` and `drafts_scoped` — shuts the customer out. An
allow-by-default one leaves the page open with no key at all. Both are wrong in
opposite directions, and both are one ordered rule to fix.

The decision is `safeExposure.decide` itself, on the participant's real file, and
the route `GET /portal/incident` goes through the same function — one decision
path, no synthesized second one. The probe is **displayed but unscored from the
Expose phase onward** and named in the Expose brief ("the document governs
surfaces that do not exist yet"), so it can never arrive as a surprise; a careful
team pre-empts it, which is the chain having taught its lesson rather than the
chain failing to fire.

### 3. Incident → Stabilize — the log you had to turn on

The Incident phase cannot be diagnosed without turning the relay's log on, and the
moment it is on it starts carrying the credential — on `GET /api/logs`, which
needs no key. The team's own fix for one phase costs them a security fact they
had before.

`masked` does not pass: the match is on a prefix, and blanking the tail leaves
enough in the line to be worth rotating over. `minimal` does not pass: it removes
the fields the investigation needs along with the secret. One setting passes. And
the lines already written keep what they were written with, which is why the real
answer is to rotate the credential rather than to edit history.

## Switching 90 ↔ 120 minutes

One variable:

```bash
STACKSTACK_GAMEDAY_MINUTES=120 make local PROBLEM=stackstack-gameday
```

It accepts exactly `90` or `120`; anything else is a **boot failure**, because an
organiser discovering forty minutes in that their 120-minute event is running the
90-minute schedule has no way to recover.

| | 90 | 120 |
| --- | --- | --- |
| Build / Ship / Expose opens at | 8 / 20 / 30 min | 10 / 26 / 40 min |
| Attack / Incident / Stabilize opens at | 42 / 55 / 70 min | 56 / 74 / 95 min |
| sign-off hold | 5 min | 8 min |

**What it does not change: the requirements.** Same gates, same probe sets, same
`A × S`, same 5% error budget, same thresholds. A 120-minute run is not an easier
run — it is a run with more room to diagnose and a longer hold to prove it stuck.
That is the rule `defend.mjs` already states about its own tunables. Join is
available at t = 0 in both, so the first-score guarantee is identical.

For rehearsal and for the test suite there is also `STACKSTACK_GAMEDAY_SCALE`,
which divides every wall-clock interval so a full event walks in seconds, and
`STACKSTACK_GAMEDAY_TICK_MS`. Both are clamped the same way `defend.mjs` clamps
its own, so a hostile value cannot make the event trivially passable, and both are
named here rather than hidden.

## Per-team, per-phase results

`GET /gameday/results` returns, for one run: when each phase opened, when its
facts first went green, whether they were green at the end, the fact-by-fact
breakdown, every probe's committed and degraded tick counts, the security facts,
and the continuous score.

It is an **operational record, not an anti-cheat mechanism**: `FLAG_SEED` arrives
in the environment and the participant owns the machine, so anything this
container signs is forgeable by them. The authoritative seam stays the
platform-recorded `/verify` verdicts, whose receipts come from a per-boot secret
that is not derivable. An organiser collects one payload per team at the end.

## What this deliberately does not do

- **Platform-side continuous scoring.** `endpoints[].default.from` is an enum of
  `cfn-output` only, so a container problem has no URL the platform's scoring
  engine can probe. The continuous number lives in the container and reaches the
  platform only as the eight checkpoint verdicts. Making it platform-visible needs
  a parallel schema and platform change, which is not a catalog PR's to invent
  (AGENT.md, "Extending the platform contract").
- **`phases[]` / `disruptions[]` in metadata.** `phases[].effect` accepts only
  `scorePathOverride` and `switchPlatformToDegraded`, both bound to
  `phased-polling`. Declaring them would promise machinery that does not exist
  (AGENT.md §11). The phases are enforced by the container, and the key rotation
  is announced scheduled maintenance rather than platform fault injection.
- **Cross-team aggregation or a live leaderboard.** Local play is one container per
  player with no central server.
- **More than eight scored checkpoints.** The schema and the local runner cap
  `multi-verify` at 8, and all eight are used.
- **Source-address blocking.** Every probe arrives on loopback from the same
  process, so an answer that was never testable is never scored as a defence
  (inherited from `defend.mjs`).

## What is still unverified

- **Finishing inside 90 minutes is an estimate, not a measurement.** Each phase
  ships a starter that is one diagnosis and one edit from correct, which puts each
  at roughly 8–12 minutes and the run at 70–85 — comfortable at 120, tight at 90.
  No full playtest has been run. If it overruns, the honest fix is to lower a
  phase's requirement (for example, Build requiring only `drafts_withheld`), not
  to loosen the sign-off.
- **One real `make local` run.** The suite drives the real app over real HTTP
  under Bun with no Docker and no AWS; the compose file itself is covered only by
  `bun run validate` and the local-play manifest checks.
- **A long soak.** Six modules resident means two background timers, a spawned
  child process and the scorer's own loop — roughly a dozen loopback requests per
  second inside one process for up to two hours. The suite asserts the process is
  still healthy, `faults` is still empty, and the relay's log lines have survived a
  busy Attack phase after a compressed full run, but that is a compressed run.

## Cost

Zero. No AWS account, no cloud resources, no network egress. One container, both
ports bound to `127.0.0.1`. Teardown is `make local-down`.

## Running the suite

```bash
bun test scripts/stackstack-gameday.test.ts
bun run validate
```

The suite starts the real `stackstack-base/app/server.mjs` under Bun with
`SCENARIO=gameday`, a compressed clock and temporary participant files, and drives
it over HTTP: create, run, both "must not score full marks" rules, all three
chains, the phase-unlock withholding, the one-shot rotation, finish and teardown.
