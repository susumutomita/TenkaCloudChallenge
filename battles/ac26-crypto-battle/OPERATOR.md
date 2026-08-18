# Operator notes -- ac26-crypto-battle

Organizer-facing architecture and implementation status for Issue #486
(PROVE / LEAK / HUNT -- Advanced Cryptography Battle). Participant-facing
rules live in `README.md` / `README.ja.md`; this file is the implementation
map and does not need to stay spoiler-free.

## Architecture

The Battle is a **pure game model**, not per-team AWS infrastructure. All of
the match's state -- team secrets, shares, the Contract Queue, the Public
Ledger, scores -- lives in a single `CryptoBattleState` value, produced and
transformed by plain functions in [`game/src/reducer.ts`](./game/src/reducer.ts):

```
initialState(ctx, config?)          -> CryptoBattleState
validateOp(state, teamId, op)       -> { ok: true } | { ok: false, error }
applyOp(state, teamId, op)          -> CryptoBattleState   (validated ops only)
tick(state, eventNowMs)             -> CryptoBattleState
projectForTeam(state, teamId)       -> CryptoBattleProjection
```

This shape is deliberate: it matches what a `@tenkacloud/coordination-plugin-sdk`
CoordinationPlugin needs (see ADR-028's description of `interTeamCoordination`
in `SCHEMA.json`), which is exactly why `coordination/crypto-battle.ts` (PR3)
could wrap these exports into a plugin file directly, with no reshaping. That
SDK package is **not** a dependency of `game/` --
TenkaCloudChallenge owns problem content, not platform packages (see this
repo's `AGENTS.md`), and importing it would violate that boundary. Nothing
under `game/src/` imports anything outside this package.

**Why `template.yaml` deploys almost nothing.** Because match state is
coordination-plugin state (owned by the platform dispatcher, one row per
event/tenant), not a per-team CloudFormation stack, there is no game
infrastructure for a team's own stack to hold. `template.yaml` currently
grants only the standard `ParticipantViewerRole` access baseline every
problem in this catalog ships (see e.g. `challenges/hello-world/template.yaml`)
and creates no other resource -- this is not a PR1 stub to be replaced later,
it is the actual minimal shape this Battle needs. If a future PR decides the
Battle benefits from some per-team AWS surface after all (e.g. a dashboard
data source), that is a deliberate addition, not a gap being filled in.

**Trust boundary.** `TeamState` (in `game/src/types.ts`) holds real
cryptographic material -- `secret` and every current `Share`, leaked or not.
This is safe only because the whole `game/` package runs exclusively on the
trusted side (the platform dispatcher Lambda, via `coordination/crypto-battle.ts`
since PR3). A participant never receives a `CryptoBattleState` directly;
`projectForTeam` is the only sanctioned read path, and it redacts every team
but the caller's down to a public score/generation summary (see
`adversarial.test.ts`'s "adversarial 5" for the test that pins this).

**Purity contract.** Nothing under `game/src/` reads `Date.now()`,
`Math.random()`, or any other ambient source. All "randomness" (secrets,
Shamir polynomial coefficients, the Contract issuance schedule) is derived
deterministically from a caller-supplied seed string via SHA-256 counter
streams (`game/src/prng.ts`); the only "time" any function sees is `tick`'s
explicit `eventNowMs` argument. `applyOp` and `tick` never mutate the state
they are given -- every update is built via `{ ...state, ... }` /
`[...array, ...]`. See `adversarial.test.ts`'s tests 7 and 8 for the tests
that pin both properties.

**ROTATE's time cost is more than the cooldown.** `applyRotate` marks every
still-`"open"` contract addressed to the rotating team as `"expired"` in the
same state transition that advances the generation. Without this, a team
could rotate away from an exposed generation and then LEAK a contract that
was issued *before* the rotate -- publishing a fresh, post-rotate share for
free, on a Contract Queue entry that cost nothing to earn. Voiding the
pre-rotate queue makes ROTATE cost something concrete beyond the cooldown: a
team that rotates has to let its in-flight Contract Queue go and wait for new
contracts under the new generation, exactly as Issue #486 frames ROTATE
carrying a real time cost, not just a timer. Rotate also re-derives the
team's Schnorr public commitment (see below) in the same transition, so a
pre-rotate PROVE proof stops verifying exactly when a pre-rotate LEAK share
stops reconstructing anything real.

## PROVE's Schnorr proof (Issue #486 PR2)

PROVE is a Fiat-Shamir-transformed, non-interactive **Schnorr proof of
knowledge**, fixed to one statement: "team T knows the witness behind the
public commitment `Y_{T,g} = g^w mod p` for its current generation `g`."
The scheme is split across five small modules under `game/src/`, each with a
single job:

- [`group.ts`](./game/src/group.ts) -- RFC 3526 Group 14 (2048-bit safe-prime
  MODP group) constants, verified against Node's own `crypto.getDiffieHellman("modp14")`
  plus a from-scratch Miller-Rabin check rather than hand-transcribed from the
  RFC text (a single wrong hex digit in a 512-digit constant would not fail
  loudly). Uses generator `g = 4` (not RFC 3526's own `g = 2`) to land
  unconditionally in the order-`q` quadratic-residue subgroup -- see the
  module's header for the squaring argument.
- [`schnorr-witness.ts`](./game/src/schnorr-witness.ts) -- `deriveWitness(secret, generation, teamId)`
  and `derivePublicCommitment(...)`. **The witness is a SHA-256 hash of the
  secret, never the secret itself.** The Shamir secret lives in a 61-bit
  field (`field.ts`'s `P`); using it as a discrete-log exponent directly
  (`Y = g^secret`) would let baby-step giant-step recover it in ~2^31 group
  operations -- a successful PROVE would then itself leak the secret it was
  supposed to protect. Hashing first turns "recover secret from Y" into a
  SHA-256 preimage search over that same 61-bit space, which is not
  feasible within a match.
- [`schnorr-transcript.ts`](./game/src/schnorr-transcript.ts) -- the shared
  Fiat-Shamir challenge computation, domain-separated (`ac26-crypto-battle/prove/v1`)
  and length-prefixed on every variable-length field (teamId, contractId,
  the domain string itself), following `challenges/ac26-w3-schnorr/local/reference/schnorr.py`'s
  `challenge_preimage` convention -- without length-prefixing, `("ab","cd")`
  and `("a","bcd")` would hash to the same challenge.
- [`schnorr-prover.ts`](./game/src/schnorr-prover.ts) -- `createProof(secret, generation, teamId, contractId, group)`,
  participant-facing tooling (needs only a team's own already-visible
  secret). Nonce `k` is RFC-6979-style deterministic (hashed from the
  witness + statement), never `Date.now()` / `Math.random()`.
- [`schnorr-verifier.ts`](./game/src/schnorr-verifier.ts) -- `verifyProof(publicCommitmentY, proof, statement, group)`,
  the trusted verifier `reducer.ts`'s `validateOp` calls from its `"prove"`
  branch. **This module never imports a secret, `deriveWitness`, or
  `schnorr-prover.ts`** -- it only ever sees public inputs (a public
  commitment already stored in `state.publicCommitments`, and the proof a
  team submitted). `schnorr.test.ts`'s module-separation test statically
  greps its import statements to keep this true; `coordination/crypto-battle.ts`
  (PR3) runs this exact function on the trusted dispatcher, unchanged.

`CryptoBattleState.publicCommitments: Record<teamId, string>` holds every
team's current-generation `Y`, derived once at `initialState` and
re-derived on every `applyRotate` (see above). It lives at the state's top
level rather than inside `TeamState` specifically so it reads as
unambiguously public, unlike everything else `TeamState` holds --
`projectForTeam` passes it through unredacted to every team.

**Replay/reuse is prevented structurally, not by a separate guard list.** A
successful PROVE marks its Contract `"completed"`, so resubmitting the same
proof hits the same "not open" rejection LEAK's replay already relies on. A
proof built for one Contract fails Fiat-Shamir verification against a
different one, because `contractId` is bound into the challenge. A proof
built before a ROTATE fails after one, because the `Y` it is checked
against changes (see above) -- there is no separate "used proofs" set to
keep in sync.

**A successful PROVE still posts to the Public Ledger -- as an audit
artifact, not a leak.** `applyOp`'s `"prove"` branch appends a
`ProofArtifact { teamId, generation, contractId, commitment, response,
postedAtMs }` -- never a share value, never the secret or witness. Issue
#486's trusted-verification minimum bar asks for a replayable transcript /
audit evidence; recording the (public, harmless) commitment/response pair
is what makes a PROVE completion independently re-checkable after the fact,
the same way a LEAK's revealed share is independently re-checkable, without
the transcript itself teaching an observer anything about the secret
(`schnorr.test.ts` / `prove.test.ts` pin this with a serialized-JSON
substring check, same style as `adversarial.test.ts`'s "adversarial 5").

**Scoring parity is structural, not a separate rule to keep in sync.**
`applyProve` pays exactly `contract.points` -- the same field `applyLeak`
reads -- with no separate "PROVE bonus" term. Issue #486's Scoring MUST
("PROVE と LEAK の同一 Contract の基本得点は原則同じ", "PROVE 自体への教育
ボーナスを付けない") falls out of reusing the field rather than needing an
explicit equality check anywhere.

## Coordination plugin wiring (Issue #486 PR3)

`coordination/crypto-battle.ts` is a **thin wrapper**, not a reimplementation:
it forwards `game/src/reducer.ts`'s `initialState` / `validateOp` / `applyOp`
/ `tick` / `projectForTeam` straight through `defineCoordinationPlugin`, with
no reshaping and no logic duplicated between `game/src` and `coordination/`.
`metadata.json`'s `interTeamCoordination.plugin` points at it.

**How the platform actually loads this file** (investigated read-only against
the TenkaCloud checkout, since that repo owns the dispatcher):

- At CDK synth time, `TenkaCloud/infrastructure/lib/utils/bundle-coordination-plugins.ts`
  esbuild-`buildSync`s the declared plugin entry with
  `{ bundle: true, format: "esm", platform: "node" }`. `bundle: true` resolves
  and inlines every relative import the entry file makes, however deep --
  confirmed locally by pointing the identical esbuild config at this file's
  whole `game/src` import graph (`reducer.ts` -> `fixtures.ts` / `field.ts` /
  `group.ts` / `schnorr-witness.ts` / `schnorr-verifier.ts` -> `prng.ts` /
  `schnorr-transcript.ts` / ...): it bundles cleanly into one ~21.6 KB ESM
  file, no resolution errors. That is why `crypto-battle.ts` imports
  `../game/src/reducer.ts` directly (a relative import reaching a sibling
  directory within this same problem, not vendoring a copy) instead of
  hand-copying the reducer's logic the way
  `battles/microservice-migration-battle/coordination/router.ts` and
  TenkaCloud's own `packs/reference-coordination-battle/.../sector-control.ts`
  are self-contained -- those two simply never had a sibling game package to
  reuse, they are not evidence of a single-file requirement.
- The bare `@tenkacloud/coordination-plugin-sdk` import resolves because
  `problems/` is a git submodule *inside* the TenkaCloud checkout
  (`TenkaCloud/.gitmodules`), so this file's real on-disk path at bundle time
  is `TenkaCloud/problems/battles/ac26-crypto-battle/coordination/crypto-battle.ts`.
  esbuild's bare-specifier resolution walks up parent directories'
  `node_modules` from there, past the submodule boundary (a filesystem walk
  does not stop at a `.git` boundary), and lands on
  `TenkaCloud/node_modules/@tenkacloud/coordination-plugin-sdk` -- a
  bun/npm workspace symlink to `TenkaCloud/packages/coordination-plugin-sdk`
  (`TenkaCloud/package.json`'s `workspaces: ["infrastructure", "apps/*",
  "packages/*"]`). This is the same mechanism `router.ts` already relies on.
- `platform: "node"` leaves Node built-ins external instead of bundling or
  erroring on them -- confirmed locally (esbuild 0.23.1): a probe file
  importing `node:crypto`'s `createHash` under the identical `buildSync`
  config keeps `import { createHash } from "node:crypto"` in the output. That
  matters because `game/src/prng.ts` and `game/src/schnorr-witness.ts` both
  import `createHash` from `node:crypto` for their SHA-256 derivations. The
  bundled `.mjs` is later `import()`-ed by
  `TenkaCloud/infrastructure/lib/problem-deploy/handlers/coordination-dispatcher-handler/index.ts`,
  a `hono/aws-lambda` app running on the Node.js AWS Lambda runtime, and that
  same handler's `s3-plugin-importer.ts` already imports `createHash` /
  `timingSafeEqual` from `node:crypto` itself (to verify the downloaded
  bundle's digest before `import()`-ing it) -- i.e. the dispatcher's own
  trusted-side code already depends on `node:crypto` being available in that
  Lambda, so this plugin doing the same needs no special-casing and **no
  pure-JS SHA-256 vendoring** was needed.
- `coordination-plugin-loader.ts`'s `isCoordinationPlugin` (participant
  handler, TenkaCloud side) only checks the default export structurally has
  `initialState` / `validateOp` / `applyOp` / `projectForTeam` functions
  (`tick` optional) -- exactly the five hooks forwarded.

**Typecheck.** `battles/` is outside the repo root `tsconfig.json`'s scope, so
`game/tsconfig.json`'s `include` was extended to also cover
`../coordination/**/*.ts`, and a local, types-only ambient declaration
(`coordination/coordination-plugin-sdk.d.ts`, explicitly commented as a stub
that must stay in sync with TenkaCloud's real
`packages/coordination-plugin-sdk/src/index.ts`) lets `bun run typecheck`
resolve the bare `@tenkacloud/coordination-plugin-sdk` import without this
repo depending on that package. `game/src/coordination-plugin.test.ts` stubs
the same SDK surface at runtime via `bun:test`'s `mock.module` (loaded before
a dynamic `import()` of the plugin, since `mock.module` must run before the
mocked specifier is first imported) and drives the plugin's default export
through `dispatchOp` / `runTick` (the SDK's own validate-then-apply / tick
composition, mocked with real -- not dead -- reimplementations) across a full
2-team `tick -> leak -> prove -> hunt` match, an eventId-determinism check, a
JSON round-trip check, and a wire-shaped HUNT check (see "Wire safety" below).

**Seed.** `initialState`'s seed is `ctx.eventId` -- `reducer.ts`'s
`initialState` already sets `seed: ctx.eventId` directly, so this needed no
change in `game/src` and nothing extra in the plugin wrapper.

**Wire safety: `CryptoBattleOp` / `CryptoBattleState` must survive JSON
end-to-end** (Issue #486 PR3 independent review, High #1 + #2). PR3's first
draft carried `TeamState.secret`, `TeamState.shares[].value`,
`CryptoBattleConfig.prime`, and the hunt op's `recoveredSecret` as raw
`bigint` -- which cannot cross either boundary this plugin actually sits
between:

- **Op in.** TenkaCloud's `CoordinationOpBodySchema` is `{ op: z.unknown() }`
  (`participant-handler/schemas.ts`) -- the dispatcher does zero shape
  validation before `dispatchOp` hands `op` straight to this plugin's
  `validateOp`. A JSON body can never contain a `bigint`, so a hunt op's
  `recoveredSecret` arrives as a `string` (or, from a buggy/malicious client,
  a `number` or something else entirely) -- never a `bigint` `validateOp`
  could safely `mod()` against without checking first.
- **State across calls.** The dispatcher persists `CryptoBattleState` between
  every op/tick (Turso: `JSON.stringify` throws outright on a `bigint`;
  DynamoDB: a round-trip through `Number` silently loses precision above
  2^53-1, well under both `field.ts`'s 61-bit `P` and this package's
  2048-bit Schnorr group elements).

Fix: `CryptoBattleOp`'s `recoveredSecret` and every bigint field reachable
from `CryptoBattleState` (`TeamState.secret`, the new `StoredShare.value`,
`CryptoBattleConfig.prime`) are now stringified decimals -- the same
convention `SchnorrProof` / `ShareArtifact` / `ProofArtifact` /
`publicCommitments` already used from PR1/PR2 (see types.ts's "JSON-SAFETY
INVARIANT" doc comment). `reducer.ts` converts at the boundary
(`BigInt(...)` in, `.toString()` out); `game/src`'s pure crypto modules
(`field.ts`, `shamir.ts`, `group.ts`, `schnorr-*.ts`, `prng.ts`,
`fixtures.ts`) are untouched and keep working in `bigint` internally.
`validateOp`'s "hunt" branch parses the untrusted `recoveredSecret` string
through `schnorr-verifier.ts`'s `parseCanonicalDecimal` (now exported and
shared, rather than duplicated) -- the exact `/^\d{1,700}$/` gate PROVE's
proof fields already went through -- and rejects a malformed value with
`{ ok: false }` instead of throwing. `parseCanonicalDecimal` itself now takes
`unknown`, not `string`, and explicitly checks `typeof value === "string"`
first: without that, `RegExp.test()`'s implicit `ToString` coercion would
have silently accepted a JSON *number* as if it were the equivalent decimal
string, exactly the wire-type confusion this fix closes.
`coordination-plugin.test.ts`'s "state survives a JSON round-trip" and "HUNT
works with recoveredSecret in its real wire shape" tests pin both halves of
this down directly.

## Portal UI wiring (Issue #486 PR4)

`metadata.json`'s `dashboard.slots` names 3 files under `portal/`, following
`battles/microservice-migration-battle/portal/*.tsx`'s precedent and the
`@tenkacloud/portal-plugin-sdk` contract exactly (see
`portal/portal-plugin-sdk.d.ts`'s header for the same "types-only ambient
stub" treatment `coordination/coordination-plugin-sdk.d.ts` already gets):

```
StatusPanel.tsx        Score / Time / Phase header + 3 lanes (Contract Queue / My Vault / Public Ledger)
RegistrationPanel.tsx  4 op submission forms: LEAK / PROVE / HUNT / ROTATE
HelpDrawer.tsx          static 1-screen rules reference (no coordinationClient needed)
```

**Data flow.** `StatusPanel.tsx` and `RegistrationPanel.tsx` both poll
`props.coordinationClient.getProjection()` every 30s
(`portal/coordination.ts`'s `usePolledProjection` -- ADR-014 / polling-over-SSE,
no SSE/WebSocket, same cadence microservice-migration-battle's `StatusPanel`
uses) and narrow the SDK's `unknown` projection to this problem's own
`CryptoBattleProjection` via that same module's `isCryptoBattleProjection`.
Factoring the polling + narrowing into one shared, non-`.tsx` module (so the
participant-portal plugin loader's `portal/*.tsx`-only glob never mistakes it
for a 4th slot) means there is exactly one place that has to get the 30s
cadence and the narrowing right, instead of two copies drifting.
`props.coordinationClient` undefined -- coordination unwired for this
deployment/session -- fail-closes both panels to a short notice; unlike
microservice-migration-battle's StatusPanel (which still has `props.endpoints`
to fall back to), every field either panel here renders comes from the one
projection, so there is no partial content to show without a client.

**RegistrationPanel never computes crypto on the participant's behalf.**
PROVE needs a `SchnorrProof { commitment, response }`; HUNT needs a
`recoveredSecret`. Both are built locally by the participant (via
`game/src/schnorr-prover.ts`'s `createProof` / `game/src/shamir.ts`'s
`reconstruct`, or an equivalent tool they write) and only pasted into the
form. This is Issue #486's actual design, not a missing convenience feature:
PROVE's local proof construction and HUNT's local Lagrange reconstruction
*are* those two moves' compute cost -- a portal button that ran either
computation for you would erase it. `RegistrationPanel.tsx`'s 4 `submit*`
helpers (`submitLeak` / `submitProve` / `submitHunt` / `submitRotate`) only
ever forward already-built values into the `CryptoBattleOp` shape
`game/src/types.ts` declares.

**"Does not leak the answer" (Issue #486 UI principle).** The Public Ledger
lane renders raw `PublicArtifact` fields (teamId / generation / shareIndex /
value for a LEAK, or teamId / generation / commitment / response for a
PROVE) and nothing else -- no "threshold reached", no "N of M shares
exposed", no computed exploitability verdict. `CryptoBattleProjection` does
not even carry `config.threshold`, which structurally rules out the panel
computing such a verdict even by accident. The same principle applies to My
Vault: it is a plain data readout (secret / shares / generation / rotate
cooldown), never an automated "you are at risk" judgement.
`game/src/portal.test.ts`'s "does not leak the answer" test renders the
Public Ledger with a fabricated projection that deliberately leaks exactly
`DEFAULT_CONFIG.threshold`-many shares for one team, then greps the rendered
output for exactly this class of string.

**Error handling (Issue #486's 3-way split).** `RegistrationPanel.tsx`'s
`describeOutcome` branches every `PortalCoordinationOutcome`: `rejected` ->
`validateOp`'s error string shown as-is (a cryptographic failure or game-rule
rejection); `unavailable` / `conflict` / `unauthorized` -> a generic
infra-retry message; `not_configured` -> the same fail-closed framing as no
`coordinationClient` at all.

**Typecheck: the same "battles/ is outside the repo root tsconfig" problem
PR3 solved for `coordination/`, plus one more wrinkle.** `game/tsconfig.json`'s
`include` was extended to also cover `../portal/**/*.tsx` (and `.ts`), the
same reasoning as `../coordination/**/*.ts` (see that section above).
`portal/*.tsx` additionally needed `"jsx": "react-jsx"` on that same
tsconfig, and `game/package.json` gained `react` / `react-dom` /
`@types/react` / `@types/react-dom` as devDependencies purely so `tsc
--noEmit` and `game/src/portal.test.ts` (which renders the plugins via
`react-dom/server`) have something to check against -- `game/src` itself
still imports neither, and the real runtime is TenkaCloud's own
`apps/participant-portal` React tree, exactly as `coordination/crypto-battle.ts`
is a thin wrapper the platform dispatcher actually loads, not this repo's
runtime.

The one new wrinkle PR3's precedent did not have: `game/tsconfig.json`
type-checks `portal/*.tsx` as part of the SAME project as `game/src/*.ts`,
but Node-style module resolution is per-FILE-location, not per-project --
`portal/` is a *sibling* of `game/` (not a descendant), so a bare `import
... from "react"` in `portal/StatusPanel.tsx` cannot walk up to
`game/node_modules/react` the way `game/src/*.ts` files can. Two small,
purpose-built fixes, verified empirically (see `game/tsconfig.json`'s and
`portal/tsconfig.json`'s own comments for the alternatives tried and
rejected first -- a `"react/*"` glob path entry, and a
`battles/ac26-crypto-battle/package.json` workspace root hoping for shared
`node_modules`, neither actually worked):

- `game/tsconfig.json` gained a `"paths"` map from `react` / `react-dom` /
  their subpaths to `node_modules/@types/react(-dom)` -- `tsc -p` applies
  ONE project's `compilerOptions` to every included file regardless of its
  physical location, so this is what lets it resolve `portal/*.tsx`'s
  `import ... from "react"` to real declaration files instead of erroring.
- `portal/tsconfig.json` (new; module-resolution-only, not a second
  typecheck project) gained the same map, pointed at
  `../game/node_modules/react(-dom)` instead. This is for `bun test`'s
  SEPARATE runtime resolution: Bun (like Node) picks the *nearest*
  tsconfig.json by walking up from each imported file's own directory, so
  without this file, `portal/coordination.ts`'s `import ... from "react"`
  would fall through to the *repository root's* tsconfig.json (no such
  mapping) when `game/src/portal.test.ts` imports it transitively at
  runtime -- confirmed by reproducing exactly that failure first.

## Vertical playtest & replay (Issue #486 PR5)

Three new `game/src/` modules, plus one purely-additive `CryptoBattleState`
field:

- [`playtest.ts`](./game/src/playtest.ts) -- `runScript(script)` replays a
  plain-data `PlaytestScript` (an ordered `tick` / op `Step[]` fixture,
  optionally carrying a scaled-down config override) against a fresh
  `initialState`, and returns a `PlaytestResult { finalState, timeline,
  violations }`. A step's declared `expect` ("ok" | "rejected") that does
  not match `validateOp`'s actual verdict lands in `violations`, never
  thrown -- a scripted fixture's job is to DOCUMENT reducer behavior
  (including "this fixture drifted out of sync with a reducer change"), not
  crash the process observing it. This file also exports the op-builder
  helpers a script author (or, in production, a participant's own tooling)
  uses to construct ops in the first place: `buildProveOp` takes only a
  `VaultProjection` (a team's own vault, from `projectForTeam`);
  `buildHuntOp` takes only a `CryptoBattleProjection` (never a
  `CryptoBattleState`) plus public game-rule constants (`prime` /
  `threshold` -- `CryptoBattleProjection` deliberately omits `config`, see
  the Portal UI wiring section above), Lagrange-interpolating a target's
  secret purely from `projection.publicLedger`. `buildHuntOp` structurally
  cannot reach `state.teams[targetTeamId].secret`, because it is never
  handed anything that has it -- this is the concrete e2e claim the
  vertical-playtest fixture makes: the attacking team's HUNT is built from
  public information only, the same boundary a real participant's own
  tooling would be limited to.
- [`vertical-playtest-fixture.ts`](./game/src/vertical-playtest-fixture.ts) --
  `buildVerticalPlaytestScript()` composes the ONE concrete, deterministic
  2-team (`alpha` / `bravo`), 25-min `PlaytestScript` both
  `vertical-playtest.test.ts` and `replay.test.ts` depend on (living here,
  not inside either `*.test.ts` file, is what lets `replay.test.ts` build
  its replay from "the vertical playtest's actual final state" without one
  test file importing -- and thereby re-registering -- another test file's
  `describe`/`test` blocks). It drives the real, schedule-derived contract
  cadence (via `tick`), not synthetic injected contracts, narrating: tick ->
  alpha LEAKs + bravo PROVEs contemporaneously until alpha crosses
  `threshold` distinct leaked shares -> bravo HUNTs (built from public
  information only) -> alpha ROTATEs -> two rejected stale-generation HUNT
  attempts -> match end -> every op kind rejected. See
  `vertical-playtest.test.ts`'s header for the full mapping onto Issue
  #486's 10-item vertical-slice MUST list, and the "Tuning notes" section
  below for what this run's actual numbers were.
- [`replay.ts`](./game/src/replay.ts) -- `buildReplay(state)` reconstructs a
  time-ordered `ReplayEvent[]` (leak / prove / hunt-success / rotate /
  phase-change, each with a `{ ja, en }` summary) from a FULL, trusted-side
  `CryptoBattleState` -- unlike `projectForTeam`, it deliberately does not
  redact team-vs-team, because a post-match debrief's entire point is to
  show what happened across every team. **This is exactly why it must never
  be wired into the live participant portal** (`portal/StatusPanel.tsx`
  etc.) -- doing so would violate the "does not leak the answer" principle
  the Portal UI wiring section above describes; `replay.ts`'s own header
  says so explicitly. `keyMoments(replay, state)` then annotates that
  timeline with the two causal moments Issue #486's debrief section asks
  for: which specific LEAK crossed `threshold`, and how many leaked shares
  each ROTATE invalidated. Neither function ever reads a team's `secret` or
  an un-leaked share value, even though `state` technically has both --
  `replay.test.ts`'s secret-non-leakage test pins this the same way
  `prove.test.ts` / `adversarial.test.ts` pin the equivalent property for
  `projectForTeam`. This module's header also documents, in detail, what a
  replay CANNOT reconstruct from `state` alone (failed HUNT/LEAK/PROVE
  attempts leave zero trace anywhere; only the most recent ROTATE per team
  survives) -- do not add code elsewhere that assumes those are recoverable.
- **`CryptoBattleState.huntLog` (new, purely additive).** Issue #486's
  debrief example is literally "58:01 Team B HUNT success" -- a timestamp --
  but the pre-existing `successfulHunts: string[]` replay-guard field (PR1)
  deliberately carries only the `JSON.stringify([attacker, target,
  generation])` KEY, no `atMs`, because a replay guard only ever needs to
  answer "has this triple already succeeded", not "when". `applyHunt` now
  ALSO appends `{ attackerTeamId, targetTeamId, generation, atMs }` to a new
  `huntLog` array, purely so `replay.ts` can be honest about hunt timing
  instead of omitting it. `validateOp`'s replay guard still reads only
  `successfulHunts`, unchanged -- `huntLog` is read-only audit trail, never
  consulted for any game-rule decision. JSON-safety is preserved (every
  field is already a string/number, see types.ts's "JSON-SAFETY INVARIANT"
  header); `initialState` seeds it `[]`, `coordination-plugin.test.ts`'s
  JSON-round-trip test covers it automatically (no bigint anywhere in it to
  begin with).

## Implementation roadmap (Issue #486)

| PR  | Scope                                                                 | Status  |
| --- | ---------------------------------------------------------------------- | ------- |
| PR1 | Pure game model: types, Shamir + Lagrange reference implementation, LEAK / HUNT / ROTATE reducer, unit + adversarial tests | done |
| PR2 | PROVE op + its Fiat-Shamir Schnorr verifier                            | done |
| PR3 | Coordination-plugin wiring (`interTeamCoordination.plugin`, dispatcher integration) | done |
| PR4 | Portal UI (`dashboard.slots`: Contract Queue / My Vault / Public Ledger panels) | done |
| PR5 | 2-team, 25-min scripted vertical playtest + replay/debrief reconstruction | **done -- scripted part only, see "Tuning notes" below** |

`metadata.json` declares `interTeamCoordination` (PR3) and now `dashboard.slots`
(this PR) but still no `scoring` / `endpoints` block -- this Battle's scoring
lives entirely inside the coordination plugin's own state (`TeamState.score`,
updated by `applyOp`), not the probe/flag-based `scoring` schema those keys
describe; there is still nothing for a CFn Output or an `endpoints[]` entry to
expose. `status: "draft"` and `visibility: "public"` remain unchanged from
PR1-PR3 -- following this catalog's convention for a problem that is real,
end-to-end content but not yet playtested live (see other
`battles/*/metadata.json` with `status: "draft"`, e.g. `agent-approval-gameday`,
`stackstack-gameday`); flipping to `"ready"` is an operator call after a real
playtest, not something this PR's code change implies on its own.

## Config / balance knobs

`DEFAULT_CONFIG` in `game/src/reducer.ts` (mirrored by
`CryptoBattleConfig` in `game/src/types.ts`) holds every tunable:

- `prime` -- the field modulus (default: the Mersenne prime 2^61 - 1).
- `threshold` / `shareCount` -- Shamir (t, n) parameters (default 3-of-5).
- `matchDurationMs`, `phaseBoundaries` -- match length and the
  build -> pressure -> endgame phase transitions.
- `contractIntervalMs`, `contractTtlMs` -- how often Contracts are issued per
  team, and how long an unclaimed one stays open.
- `rushContractTtlMs` -- how long a "rush" contract stays open, shorter than
  `contractTtlMs` so `scores.rushContract`'s extra points are genuinely
  time-pressured rather than a same-deadline flat bonus.
- `rotateCooldownMs` -- minimum gap between two ROTATE ops for one team.
- `scores.{contract,rushContract,huntBonus,huntPenalty}` -- point values.

These are Issue #486's playtest seed values, not a locked-in balance spec.
Expect them to move once this Battle gets an actual playtest, the same way
other Battles tune `phases[].afterMinutes` / `disruptions[]` timings after
running live. `initialState(ctx, configOverride)` accepts a partial override
for exactly this kind of per-event tuning -- but note the SDK's
`CoordinationPlugin.initialState(ctx)` contract takes only `ctx` (see PR3's
"Coordination plugin wiring" section above), so the dispatcher never actually
supplies `configOverride` today; the plugin always runs with `DEFAULT_CONFIG`
until the SDK's `initialState` contract grows a config parameter. Per-event
tuning therefore currently means changing `DEFAULT_CONFIG` itself, not a
per-match override.

## Tuning notes (from scripted vertical playtest, Issue #486 PR5)

`game/src/vertical-playtest-fixture.ts`'s `buildVerticalPlaytestScript()`
composes one deterministic, 2-team (`alpha` / `bravo`), 25-min scripted
match -- `game/src/vertical-playtest.test.ts` replays it via
`game/src/playtest.ts`'s `runScript` and asserts Issue #486's 10-item
"MVP / Vertical Slice" MUST list against it; `game/src/replay.test.ts`
builds a `game/src/replay.ts` debrief timeline from that same run's final
state. This section records what the numbers from that ONE scripted run
actually were, and -- more importantly -- what a scripted run like this can
and cannot tell an operator about balance.

### Config scaling

`VERTICAL_CONFIG` scales `DEFAULT_CONFIG` down for a 25-min slice, roughly
proportional to `DEFAULT_CONFIG`'s 90-min build (25/90 ~= 0.28) for the
match-length/phase-boundary knobs, but **not** proportional for
`contractIntervalMs`:

| knob | `DEFAULT_CONFIG` (90 min) | `VERTICAL_CONFIG` (25 min) | scaling |
| --- | --- | --- | --- |
| `matchDurationMs` | 90 min | 25 min | ~0.28x (proportional) |
| `buildToPressureMs` | 30 min | 8 min | ~0.27x (proportional) |
| `pressureToEndgameMs` | 60 min | 18 min | ~0.30x (proportional) |
| `contractIntervalMs` | 2 min (0.5 contracts/min) | 1 min (1 contract/min) | **2x denser**, not proportional |
| `contractTtlMs` | 5 min | 4 min | ~0.8x (deliberately generous, not proportional) |
| `rushContractTtlMs` | 2.5 min | 2 min | ~0.8x, same reasoning |
| `rotateCooldownMs` | 3 min | 3 min | unchanged |
| `threshold` / `shareCount` / `scores.*` | 3-of-5 / 10/20/20/10 | unchanged | unchanged (the math and scoring rules being tested are not time-scaled, only the clock is) |

`contractIntervalMs` is deliberately halved (not scaled by ~0.28) so a
25-min slice does not feel sparse relative to the full 90-min match's
cadence -- doubling contract density was a scripted-fixture authoring
choice to keep both teams busy inside a short script, not a claim about
what the *real* 90-min cadence should be. `contractTtlMs` /
`rushContractTtlMs` are cut less aggressively than the clock itself (0.8x,
not 0.28x) so a contract issued near the compressed match's end still has a
realistic chance to be actioned before it expires.

### What the one scripted run actually produced

With `EVENT_ID = "vertical-playtest-486-pr5"`, `TEAMS = ["alpha", "bravo"]`:

- **25 contract batches issued per team** over the 25-min match
  (`contractIntervalMs` = 1 min => one batch/team/min).
- **alpha** (LEAK path) completed exactly 3 contracts before the script
  moved on to the HUNT/ROTATE beats -- all 3 happened to be `"standard"`
  kind (10 pts each) in this run's derived schedule, for **30 points**
  before the HUNT penalty.
- **bravo** (PROVE path) completed exactly 3 contracts in the same window --
  the FIRST one happened to be `"rush"` kind (20 pts) in this run's derived
  schedule, the other two `"standard"` (10 pts each), for **40 points**
  before the HUNT bonus. (`deriveContractPlan`'s rush roll is an
  independent ~1-in-5 chance per team/sequence-index -- a different seed
  would very plausibly give both teams the same kind mix; this run's mixed
  outcome is itself a useful illustration that rush timing is NOT
  synchronized between teams.)
- **HUNT** fired at t=2:00 (bravo reconstructed alpha's generation-1 secret
  from exactly `threshold` = 3 public ledger shares): alpha 30 -> 20
  (-10 `huntPenalty`), bravo 40 -> 60 (+20 `huntBonus`). **Final score:
  alpha 20, bravo 60.**
- A single successful HUNT was worth a **30-point net swing** between the
  two teams in this run -- roughly 2x a "standard" contract's own value (10
  pts) or 1x a "rush" contract's (20 pts). At this run's actual contract mix
  (`~12` pts/contract average, weighting the observed 1-rush-in-6 ratio),
  one HUNT was worth close to **2.5 average contracts'** worth of score
  swing in a single op. Whether that feels like "a satisfying big play" or
  "one hunt undoes 2-3 minutes of honest work" is exactly the kind of
  judgment call this repo's AGENTS.md reserves for a real playtest, not a
  script.
- After the HUNT + ROTATE beats (by t=3:00), the script stops taking
  further LEAK/PROVE actions and jumps straight to match end -- **19 of 25
  contracts per team ended `"expired"`, 6 of 25 stayed `"open"`** at match
  end. **This is a scripted-fixture authoring artifact, not a balance
  finding**: the script stops acting once it has demonstrated every MUST
  item once, it is not attempting to play optimally or continuously the way
  a real team would. Do not read "25 idle minutes" out of this number --
  see the Playtest Gates discussion below for why Gate 2 specifically
  cannot be checked this way.

### Mapping to Issue #486's Playtest Gates

| Gate | Scripted playtest can verify? | Notes |
| --- | --- | --- |
| **Gate 1** (5-min rule explainability) | No | Requires an actual first-time human hearing the rules; nothing here measures comprehension. |
| **Gate 2** (no structural idle) | No | The scripted fixture itself goes idle after t=3:00 by design (see above) -- that is the OPPOSITE of evidence either way about whether the real 90-min cadence keeps a real team busy. Only a live run with humans making continuous choices can check this. |
| **Gate 3** (skill expression / not pure typing speed) | No | Requires comparing outcomes across players of different cryptographic understanding; a deterministic script has no notion of player skill. |
| **Gate 4** (comeback path without pure randomness) | Partially | The reducer's rules structurally support a HUNT-based comeback (this script demonstrates one team gaining a 30-point swing via HUNT after falling behind on raw contract count) -- but whether that path FEELS reachable/fair to a trailing human team, and whether it happens often enough across many matches to be a real gate-pass, needs live data across multiple sessions. |
| **Gate 5** (replay explainability) | **Yes, for what this scripted run covers.** `replay.test.ts` confirms `buildReplay` / `keyMoments` can point at the exact LEAK that crossed the threshold and the exact ROTATE that invalidated it, in both languages, from state alone. |

**A scripted playtest is not a substitute for a real playtest.** This PR
satisfies PR5's own checklist (20-30 min scripted fixture; end-to-end
LEAK -> threshold -> HUNT; PROVE path; ROTATE path; replay; tuning notes)
and demonstrates 9 of Issue #486's 10 vertical-slice MUST items
mechanically (see `vertical-playtest.test.ts`'s header for the full
mapping; MUST 10, the UI-level "advance / hunt / defend" tension, has no
UI or human decision point in a scripted fixture and is explicitly left
unverified there). It does **not** satisfy Issue #486's Definition of Done
item "初見 playtest を最低 2 回実施し、balance 調整を記録する" -- that
item remains open, tracked here rather than silently marked done: this
section documents what a script CAN observe (concrete numbers, structural
properties, replay fidelity), not what only a room full of first-time
players can (comprehension, engagement, felt fairness). PR6 ("90-min
battle tuning") is where `contractIntervalMs` / phase timings / score
balance / HUNT expected value get tuned against that real data, once it
exists.

## Known gaps (by design, not oversight)

- **No participant-facing PROVE tool ships in this repo.** `schnorr-prover.ts`'s
  `createProof` is the tool a participant script would call, but there is no
  CLI wrapper published from this repo. This is deliberate, not a gap PR4
  closes: see "Portal UI wiring (Issue #486 PR4)" below on why
  `RegistrationPanel.tsx` never builds a proof (or a HUNT `recoveredSecret`)
  on the participant's behalf.
- **No compute-budget economy for ROTATE.** PR1 represents ROTATE's cost as
  a cooldown (`rotateCooldownMs`) plus voiding the team's own in-flight
  Contract Queue (see "ROTATE's time cost" above) -- not a metered compute
  budget. Issue #486 mentions a fuller compute-economy treatment as a later
  idea; nothing here blocks that from replacing or augmenting the
  cooldown/expiry pair later.
- **`template.yaml` has no scoring surface.** Scoring is coordination-plugin-
  driven (`TeamState.score`, inside the plugin's own state) rather than the
  probe/flag-based `scoring` schema, so `metadata.json` intentionally omits
  `scoring` / `endpoints`; there is nothing for a CFn Output or an
  `endpoints[]` entry to expose.
- **HUNT cannot succeed in production yet -- TenkaCloud's `ctx.teamIds` is
  only the requesting team, not the full event roster** (Issue #486 PR3
  independent review, Medium #3; cross-repo, cannot be fixed from this
  repo). `TenkaCloud/infrastructure/lib/problem-deploy/handlers/participant-handler/coordination-handler.ts:139`
  builds `ctx: { eventId: item.eventId, teamIds: [item.teamId] }` -- a
  single-element array, always just the calling team -- when resolving a
  request's `CoordinationScope`; that file's own comment at line 121
  already flags this as provisional ("`ctx.teamIds` は現状 requester 自身のみ。
  full event roster の解決は importer 配線と同 increment で拡張する"). Since this
  plugin's `initialState` builds one `TeamState` per `ctx.teamIds` entry
  (see `game/src/reducer.ts`), a live match's `state.teams` would in
  practice only ever contain the requesting team -- `validateOp`'s "hunt"
  branch's `state.teams[op.targetTeamId]` lookup can never resolve to a real
  target team, so every HUNT is rejected with "unknown target team" against
  the live dispatcher, independent of whether the recovered secret is
  correct. `game/src/coordination-plugin.test.ts` and `game/src` unit tests
  are unaffected (they construct `ctx.teamIds` directly, the way a full
  roster resolver eventually will), so this gap is invisible to `bun test`
  -- it only shows up once TenkaCloud's roster resolution ships. Tracked
  upstream: [TenkaCloud#3053](https://github.com/susumutomita/TenkaCloud/issues/3053).
  No code change is possible on this side; this Battle's HUNT/LEAK/PROVE/
  ROTATE loop is otherwise fully wired and ready as soon as that lands.
