# ac26-crypto-battle operator runbook

This file contains only the current operating contract. Implementation history
belongs in Git and Issues, not in the runbook.

## Runtime boundary

```text
Participant Portal
  └─ team-bound coordination client
       └─ TenkaCloud dispatcher (auth, persistence, optimistic lock)
            └─ coordination/crypto-battle.ts
                 └─ game/src/reducer.ts
```

`coordination/crypto-battle.ts` is a thin adapter. Game meaning lives in the
pure reducer: `initialState`, `tick`, `validateOp`, `applyOp`, and
`projectForTeam`. The Challenge repository does not import TenkaCloud runtime
packages into the game model.

## Data separation

| Data | Stored where | Browser visibility |
| --- | --- | --- |
| match secret | separate TenkaCloud coordination secret record | never projected |
| match state seed | trusted match state | never projected |
| each team's current secret and shares | trusted match state | owning team only, through `vault` |
| another team's un-leaked shares | trusted match state | never projected |
| open Orders | trusted match state | owning team only |
| LEAK / PROVE / FHE / MPC artifacts | public ledger | every team |
| MPC private input and masks | derived while projecting the owning team | owning team only |

The only supported read path is `projectForTeam`. Do not hand state directly to
Portal code or create another projection helper.

### Match seed

Production initialization must receive `CoordinationContext.matchSecret` from
TenkaCloud. `eventId` is public routing data and must not seed hidden values.

For unit tests and local preview only, absence of `matchSecret` produces the
explicit marker `local-play-not-secret:<eventId>`. This fallback is
deterministic and intentionally not secret. A real event that reaches it is a
platform wiring defect.

The fixed `MATCH_SECRET` in `vertical-playtest-fixture.ts` is test data. Do not
copy a live match secret into a fixture, replay, log, response, or debrief.

## Match lifecycle

1. TenkaCloud mints the match secret before first state creation.
2. `initialState` creates team secrets, shares, sudoku solutions with their public puzzles, and the Order plan.
3. `tick` advances time, phases, expiry, and Order issuance.
4. `validateOp` rejects malformed, stale, unauthorized, or incorrect moves.
5. `applyOp` changes state only after validation.
6. `projectForTeam` returns the team's vault and Orders plus the public ledger.
7. Reset/delete removes both state and the separate match-secret record.

All state and operations must remain JSON-safe. Large field and group values
cross the state/op boundary as decimal strings, never JavaScript numbers or
raw `bigint`.

### Upgrading across a schema version

The plugin declares `stateSchemaVersion` (3 since the sudoku PROVE) and a
`migrateState` that lifts older rows on first touch. One case is refused on
purpose: a v2 row whose ledger still holds an unspent nonce-reuse HUNT (two
Schnorr transcripts sharing a commitment on a team's current generation, and
an attacker that has not collected on it). v3 has no move that attack maps
onto, and dropping it silently would change the match's scoring mid-run. The
platform leaves such a row untouched, so finish that match on the plugin that
made it, or reset it, before deploying the upgrade. Upgrade between events,
not during one.

## Participant surface

The default surface is deliberately staged:

1. read the always-visible problem explanation above the board; the compact
   “Read the guided explanation (optional)” control opens a walkthrough only on request;
2. pick one ORDER and choose the action it accepts;
3. for sudoku PROVE, select a relabelling table and fill four holes beside
   twelve worked cells; all four digit substitutions are exercised once;
4. open tactics or the full reference when needed.

The tutorial starts collapsed on every visit, including the waiting room. It
never gates or automatically interrupts play, and can be closed in place. It
uses only fixed practice data; changing team or deployment resets practice.

The optional explanation has ten scenes: remainder, additive sharing, indexed
sharing, reconstruction, exposure, MPC, ZK, FHE, Caesar, commit-reveal. Each
scene can be read without answering; Next is never gated by correctness. An
optional one-digit field checks understanding, and a separate control shows
the fixed result and reason. There is no practice score, fake Contract, or
fake Ledger. The numbered sharing example explains the candidate secrets and
why the private-number terms cancel without requiring a second disclosure.

Free concept explanations are separate from practice. They start as compact
controls in the top topic disclosure and beside each calculation form, use fixed one-digit
examples, and show unsolved expressions from only the current team's projected
Order operands. No hint purchase or tutorial completion is needed. FHE is
labelled an addition model with separate per-input keys; the ZK explanation
states that this game trusts a judge holding the solution.

The sudoku scaffold is an explicit participant aid: it applies the selected
table to twelve cells of the owning team's solution. Four answers remain empty,
and the trusted judge still checks the complete submitted grid. Tables used in
the same generation remain selectable with a reuse warning, preserving the
misuse that sudoku HUNT teaches. The Portal must not fill these four answers,
compute a HUNT answer, announce that a target is exploitable, or show another
team's private material.

## Local UI harness

```bash
cd battles/ac26-crypto-battle/dev
bun install --frozen-lockfile
bun test
bun run typecheck
bun run dev                 # http://localhost:5644
```

The harness uses the real reducer and Portal components, but fake auth and
in-memory persistence. It is suitable for responsive UI and interaction checks;
it is not evidence for tenant isolation, persistence, or deployed Portal E2E.

## Game and security checks

```bash
cd battles/ac26-crypto-battle/game
bun install --frozen-lockfile
bun test
bun run typecheck
```

The suite covers reducer behavior, JSON round-trips, method/order compatibility,
sudoku-relabelling verification, Shamir reconstruction, FHE/MPC behavior,
reused-relabelling HUNT, team projections, deterministic replay, and the vertical playtest.

From the TenkaCloudChallenge root, also run:

```bash
make install
make agent-gate
```

## Tuning

`DEFAULT_CONFIG` in `game/src/reducer.ts` owns match duration, phase boundaries,
Order cadence, batch size and TTLs, ROTATE cooldown, threshold/share count, and
the score values that apply to every Order.

### Field size and HUNT attempt limits

Treat `config.prime`, `config.maxHuntAttemptsPerTarget`, and
`config.scores.wrongHunt` as coupled settings. The match defaults are `97`,
`3`, and `8`; `scores.huntBonus` is `25`. This is a teaching field, not a
cryptographic security parameter. Smaller numbers make hand calculation easier
and blind guessing easier too. Never lower the prime or raise the attempt cap
without checking the scoring tradeoff at the same time.

For each override, check that the prime exceeds `shareCount`, the attempt cap
is smaller than the prime and no larger than `threshold`, and
`huntBonus / prime < wrongHunt`. The default-only assertion in
`game/src/reducer.test.ts` does not validate operator overrides. For the default
field, one uniform blind guess has an unclamped expected score change of
`25/97 - 8*96/97`, which is negative; the score floor at zero still applies, so
the attempt cap is necessary even when a team has no points to lose.

The budget is per attacker, target, and generation; a hit spends an attempt
and prevents another reward on that pairing. A well-formed wrong answer costs
`wrongHunt` and spends one attempt. Malformed or unreduced inputs are refused
without either cost. Shamir HUNT, FHE, and MPC inputs must already be in
`0..prime-1`: adding the prime to a correct answer is a format error.

Use a replay or fixture with the proposed config to check correct recovery,
wrong-answer cost, exhausted attempts, and ROTATE before using an override.
`field.ts`'s library default `P = 2^61 - 1` is for arithmetic tests; the match
passes `config.prime` explicitly, with `HAND_PRIME = 97` as its default.

### Order economics

Per-rung economics live in `game/src/ladder.ts`'s `CIPHER_RUNGS`, not in
`DEFAULT_CONFIG`: how many published pairs break a rung, how long its plaintext
is, and what breaking it pays. They belong to the rung because that is what the
ladder varies — see the header of that file.

Hint text lives in `game/src/hints.ts`, its prices in `DEFAULT_CONFIG.scores.hintCosts`
(one entry per level, `[2, 4, 8]`). Two constraints bind them together and
`game/src/hints.test.ts` enforces both: every task kind carries the same number
of hints, and the whole ladder must cost less than `contract - contractLeak`
(30 - 10), or a team that needs help scores better by leaking than by learning —
the "LEAK is always optimal" failure #659's simulation was rebuilt to remove.

Hint text is served from the plugin, not the Portal bundle, and only for the
levels a team has bought. Moving it into the Portal's locale tables (where every
other participant-facing string lives) would ship every hint to the browser and
make its price apply only to players who do not open devtools.

Change tuning with a replay/fixture assertion that explains the intended player
effect. Do not tune by changing validation rules or by weakening a test.

**Order distribution is the one knob that decides whether the match is a game.**
`contractsPerIssue` (6) is sized so a fast team clears the batch and a slow team
overflows. Too low and nobody ever has to LEAK, so nothing is published and HUNT
never fires; too high and every team overflows, so being fast stops paying.
Issue #659 sizes it as "team size + 1 to 2" for the standard three-person team.
The plugin is handed team ids and never headcount, so a different team size has
to be re-tuned by hand.

**Match size depends on the backend and is checked by the platform's capacity preflight.**
The full-play fixture now completes FHE, MPC, sudoku and both RPS stages as well
as LEAK, purchases every hint, and uses 26-character team IDs and epoch times.
At 99 teams it measures **3,109,666 UTF-8 bytes** (2026-09-05). The old fixture
missed non-LEAK records and some rush Orders and therefore understated capacity.
`metadata.json` reserves **32 KiB per team + 1,536 bytes**. This is a forecast for
the default 90-minute configuration; remeasure after changing duration or batch size.

| Backend | Platform policy | Default-match capacity |
| --- | --- | --- |
| Turso / libSQL | 4 MiB, environment-overridable | 99 teams, with at least 25% headroom in the tested full-play path |
| DynamoDB | 400 KiB item; platform reserves 16 KiB | 9 teams with 25% headroom; the declaration's preflight limit is 11 |

The platform owns these limits (`coordination-budget.ts`); this change does not
raise them. The test's old 2 MiB SQL allowance was not the platform's 4 MiB policy.
The revised test checks the real policy with headroom, instead of letting most
Orders expire and calling that a worst case. Records remain public for the match;
none are deleted to improve the measurement. Live AWS checks remain optional.

## Rock-paper-scissors lifecycle

After the opening, one of every six Order slots is a paired duel. The default
six-Order batch therefore has one of each mechanism. Teams rotate through a
circle schedule; an odd roster rotates one bye, which receives an individual
Order instead. Small batches still receive the other five mechanisms. Late
unseen slots are consumed but not issued or charged. All deadlines stop at match end.

`rps-commit` accepts only the nonzero order-11 subgroup modulo 23. A second
commitment is refused. `rps-open` requires both commitments and a matching hand
and hiding number; a mismatch is rejected without a penalty. The first accepted
opening stays judge-private; the second atomically settles both Orders and
publishes both openings. Win 30, draw 10, loss 0, configurable through `scores`.
ROTATE changes long-lived secrets and does not cancel a duel. At timeout, a team
that finished its current stage gets `duelWin`; the team with a required action
outstanding receives ordinary `expiredOrder`. No opening is published on timeout.

`Contract.rps` and `TeamState.issuedDuelCount` are optional on old rows; missing
counters mean zero. Old score configs backfill `duelWin` and `duelDraw` through
existing config migration. Persisted openings must never be spread into another
team's projection. Tests cover all 33 first openings and all nine hand pairs.
The toy has no computational binding security; fairness relies on the judge
keeping openings private until both arrive. It is commit-reveal, not a full ZK protocol.

## Release checks

- game tests and typecheck
- dev-harness tests and typecheck
- fresh browser scenarios for the initial, in-progress, and ended states
- repository `make agent-gate`

A real-AWS walkthrough and an independent third-party playtest are optional
pre-event rehearsals. Record them when useful, but do not block development or
merge when they have not run.

## Source map

- `game/src/reducer.ts` — state transitions, validation, projection
- `game/src/types.ts` — JSON-safe state/op/projection contract
- `coordination/crypto-battle.ts` — TenkaCloud plugin adapter
- `portal/` — participant slots
- `dev/` — local browser harness
- `game/src/vertical-playtest-fixture.ts` — deterministic multi-move fixture
- `game/src/replay.ts` — public debrief timeline
