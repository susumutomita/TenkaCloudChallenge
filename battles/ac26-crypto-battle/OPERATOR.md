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
in `SCHEMA.json`) so that a later PR can wrap these exports into a plugin file
directly, with no reshaping. That SDK package is **not** a dependency here --
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
trusted side (the platform dispatcher Lambda that will own the coordination
plugin in PR3). A participant never receives a `CryptoBattleState` directly;
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
  greps its import statements to keep this true; PR3's coordination plugin
  will run this exact function on the trusted dispatcher, unchanged.

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

## Implementation roadmap (Issue #486)

| PR  | Scope                                                                 | Status  |
| --- | ---------------------------------------------------------------------- | ------- |
| PR1 | Pure game model: types, Shamir + Lagrange reference implementation, LEAK / HUNT / ROTATE reducer, unit + adversarial tests | done |
| PR2 | PROVE op + its Fiat-Shamir Schnorr verifier                            | **done (this PR)** |
| PR3 | Coordination-plugin wiring (`interTeamCoordination.plugin`, dispatcher integration) | not started |
| PR4 | Portal UI (`dashboard.slots`: Contract Queue / My Vault / Public Ledger panels) | not started |

`metadata.json` declares no `scoring`, `endpoints`, or `interTeamCoordination`
block -- those are meaningless (and, for `interTeamCoordination.plugin`,
`scripts/validate-problems.ts` would reject a path that does not exist yet)
until PR3 gives the reducer a real host to run inside. `status: "draft"` and
`visibility: "public"` follow this catalog's convention for a problem that is
real content but not yet playtested end-to-end (see other `battles/*/metadata.json`
with `status: "draft"`, e.g. `agent-approval-gameday`, `stackstack-gameday`).

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
for exactly this kind of per-event tuning without touching the defaults.

## Known gaps (by design, not oversight)

- **No participant-facing PROVE tool yet.** `schnorr-prover.ts`'s
  `createProof` is the tool a participant script would call, but there is no
  CLI wrapper or portal button to run it from -- that surface arrives with
  PR4's UI (the same gap LEAK/HUNT/ROTATE already have; see "No live
  coordination plugin, no portal UI" below).
- **No compute-budget economy for ROTATE.** PR1 represents ROTATE's cost as
  a cooldown (`rotateCooldownMs`) plus voiding the team's own in-flight
  Contract Queue (see "ROTATE's time cost" above) -- not a metered compute
  budget. Issue #486 mentions a fuller compute-economy treatment as a
  PR3/PR6-era idea; nothing here blocks that from replacing or augmenting
  the cooldown/expiry pair later.
- **No live coordination plugin, no portal UI.** The reducer is fully
  testable and deterministic today (`bun test` under `game/`), but nothing
  currently calls it from a running match -- that wiring is PR3 (dispatcher
  integration) and PR4 (participant-facing panels).
- **`template.yaml` has no scoring surface.** Because scoring is
  coordination-plugin-driven (PR3), `metadata.json` intentionally omits
  `scoring` for now; there is nothing yet for a CFn Output or an
  `endpoints[]` entry to expose.
