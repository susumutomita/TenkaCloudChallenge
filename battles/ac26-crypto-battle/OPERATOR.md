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
2. `initialState` creates team secrets, shares, commitments, and the Order plan.
3. `tick` advances time, phases, expiry, and Order issuance.
4. `validateOp` rejects malformed, stale, unauthorized, or incorrect moves.
5. `applyOp` changes state only after validation.
6. `projectForTeam` returns the team's vault and Orders plus the public ledger.
7. Reset/delete removes both state and the separate match-secret record.

All state and operations must remain JSON-safe. Large field and group values
cross the state/op boundary as decimal strings, never JavaScript numbers or
raw `bigint`.

## Participant surface

The default surface is deliberately staged:

1. pick one ORDER;
2. choose the action that Order accepts;
3. open tactics only after public material makes HUNT or ROTATE relevant;
4. open the tutorial or full computation reference only when needed.

The Portal must not compute a participant's PROVE or HUNT answer, announce that
a target is exploitable, or show another team's private material.

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
Schnorr verification, Shamir reconstruction, FHE/MPC behavior, nonce-reuse
HUNT, team projections, deterministic replay, and the vertical playtest.

From the TenkaCloudChallenge root, also run:

```bash
make install
make agent-gate
```

## Tuning

`DEFAULT_CONFIG` in `game/src/reducer.ts` owns match duration, phase boundaries,
Order cadence, batch size and TTLs, ROTATE cooldown, threshold/share count, and
the score values that apply to every Order.

Per-rung economics live in `game/src/ladder.ts`'s `CIPHER_RUNGS`, not in
`DEFAULT_CONFIG`: how many published pairs break a rung, how long its plaintext
is, and what breaking it pays. They belong to the rung because that is what the
ladder varies — see the header of that file.

Change tuning with a replay/fixture assertion that explains the intended player
effect. Do not tune by changing validation rules or by weakening a test.

**Order distribution is the one knob that decides whether the match is a game.**
`contractsPerIssue` (6) is sized so a fast team clears the batch and a slow team
overflows. Too low and nobody ever has to LEAK, so nothing is published and HUNT
never fires; too high and every team overflows, so being fast stops paying.
Issue #659 sizes it as "team size + 1 to 2" for the standard three-person team.
The plugin is handed team ids and never headcount, so a different team size has
to be re-tuned by hand.

**Match size is capped, and nothing enforces the cap.** The whole match is one
persisted row. On the DynamoDB backend a single item is capped at 400 KB and
there is no partial write, so a match that outgrows it stops mid-play. Measured
worst case for a 90-minute match: about two thirds of the cap at six teams, and
past it at ten. **Six teams is the supported maximum**; `game/src/state-size.test.ts`
holds that number and fails if a change erodes the margin. Turso/libSQL has no
comparable per-row cap.

The 25-minute vertical fixture is deterministic game coverage. Pair it with the
dev-harness tests, typecheck, and browser scenarios that render the real Portal
components using participant-visible inputs.

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
