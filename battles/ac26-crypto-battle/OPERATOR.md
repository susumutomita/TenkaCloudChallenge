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
4. `validateOp` rejects malformed, stale or unauthorized moves. A well-formed
   PROVE or Vigenère/Rotor/RSA CIPHER miss is accepted and charged by `applyOp`.
5. `applyOp` changes state only after validation.
6. `projectForTeam` returns the team's vault and Orders plus the public ledger.
7. Reset/delete removes both state and the separate match-secret record.

All state and operations must remain JSON-safe. Large field and group values
cross the state/op boundary as decimal strings, never JavaScript numbers or
raw `bigint`.

### Upgrading across a schema version

The plugin declares `stateSchemaVersion` (12, including the generation-scoped disclosure retirement fee) and a
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
the fixed answer with a one-sentence takeaway. Calculation steps and full reasons
remain in the free collapsed explanation. There is no practice score, fake Contract, or
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
fill a HUNT answer or show another team's private material. The HUNT guide may
count public evidence and display interpolation factors, leaving the arithmetic
and submission to the participant. Guessing below the threshold remains available
with the normal attempt cost.

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

### The disclosure Order and why the match connects

The existing five-task rotation is preserved. Every other ordinary share slot
requires publication; the alternating share slot still permits LEAK or PROVE.
The opener remains unchanged. Disclosure indices advance cyclically through
1..shareCount, so consecutive disclosures have distinct indices. Keeping five
slots preserves the established Vigenere/Rotor/RSA issuance schedule.

Publication still requires pressing LEAK. Expiry only penalizes; it publishes
nothing. Disclosure LEAK pays the Order's full rate, including rush. ROTATE is
visible before the first disclosure even at zero exposure; its normal cooldown
and voided-Order penalty still apply. Duel byes can shift disclosure timing per
team, so read opponents' exposure from public records rather than your schedule.
`game/src/interaction.test.ts` verifies both competent teams land Shamir HUNTs
without voluntary LEAKs, and that rotating before the third share prevents these
attacks at a score cost. This is a deterministic test, not a human playtest.

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
The full-play fixture completes every mechanism, buys every hint and uses
26-character team IDs and epoch times. It spends RPS attempts against all eligible
opponents, then rotates near match end to exercise pending predictions beside the
nearly full ledger. At 99 teams the measured peak is **2,968,946 UTF-8 bytes**,
with **9,604 simultaneous predictions**; the terminal row is **2,887,478 bytes**
(2026-09-05). These are measurements of this deterministic route, not a universal
bound over every operation sequence. Duration/batch changes require remeasurement.

Schema 4 replaces repeated IDs in private budget/prediction keys with positions in
the fixed sorted roster, and stores a ledger Order number only when the original
ID can be reconstructed exactly. Public projections, successful-HUNT history and
ledger contents stay identical. Retired-generation counters are discarded only
when no pending prediction needs them for a refund. Upgrade migrates v1/v2/v3 rows;
unknown IDs/counts fail migration without rewriting the row. A rollback to schema 3
must not read schema-4 rows. Finish running matches on their compatible plugin.
The existing v2 unspent-Schnorr-exposure upgrade restriction still applies.

Schema 5 records the actual own score change on new Shamir and sudoku HUNT
results, including a penalty limited by the zero-score floor. Upgrade accepts
schemas 1–4 and keeps older results without a score delta; their outcome remains
visible, but the Portal reports the delta as unrecorded instead of guessing it
from today's rules. A schema-4 plugin must not read schema-5 rows after rollback.

`metadata.json` reserves **31 KiB per team + 1,536 bytes**. The platform owns the
limits below; this problem does not raise them. The local capacity tests retain
25% headroom and check both the peak and the final state.

| Backend | Platform policy | Default-match capacity |
| --- | --- | --- |
| Turso / libSQL | 4 MiB, environment-overridable | 99 teams with at least 25% headroom in the tested route |
| DynamoDB | 400 KiB item; platform reserves 16 KiB | 12 teams with 25% headroom in the tested route; declaration preflight limit 12 |

## Rock-paper-scissors lifecycle

After the opening, one of every six Order slots is a paired duel. The default
six-Order batch therefore has one of each mechanism. Teams rotate through a
circle schedule; an odd roster rotates one bye, which receives an individual
Order instead. Small batches still receive the other five mechanisms. Late
unseen slots are consumed but not issued or charged. All deadlines stop at match end.

`rps-commit` accepts only the nonzero order-11 subgroup modulo 23. A second
commitment is refused. `rps-open` requires the submitting team’s own commitment and a matching hand
and hiding number; a mismatch is rejected without a penalty. The first accepted
opening can be accepted before the opponent commits and stays judge-private; the second atomically settles both Orders and
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

## RPS reuse prediction HUNT

`hunt-rps { targetTeamId, duelId, predictedHand }` accepts a hand 1–3 only when the
target's current duel is sealed and not yet privately opened, and two distinct
past public duels show equal randomness. Evidence may cross generations; ROTATE
does not erase it. Any other team may predict, not only the paired opponent.
Acceptance does not test the hidden answer or assume the current r was reused.

The same `huntAttempts` budget as Shamir HUNT is reserved immediately against the
target's acceptance generation. A hunter gets one immutable prediction per duel,
even if the target rotates. Only the hunter sees the pending receipt. Both public
openings trigger hit `huntBonus` / miss `wrongHunt` once, with score floor zero;
first opening alone never produces a grade or answer oracle. Forfeit/expiry cancels
all predictions, shows no hand, and refunds the exact reserved generation.

Browser rehearsal: select `rps-reuse` in the local harness, alpha seat. Use only
the public rows and free tables to predict bravo, submit, then finish both sides
of the duel using the controls. Confirm no early grade, the public outcome and
separate HUNT points. Automated tests cover misses, expiry, rotation, shared budgets,
malformed inputs, third-team privacy and old projection compatibility.

## Release checks

- game tests and typecheck
- dev-harness tests and typecheck
- fresh browser scenarios for the initial, in-progress, and ended states
- repository `make agent-gate`

A real-AWS walkthrough and an independent third-party playtest are optional
pre-event rehearsals. Record them when useful, but do not block development or
merge when they have not run.

The [participant walkthrough](dev/PLAYTHROUGH.ja.md) lists the nine checks
for the next event, local scenario setup, and a result template. The explanation
is optional and opens above the board; automatic display is not required.
Record the Portal Score/Rank refresh and team-name initialization separately
from local harness evidence.

## Source map

- `game/src/reducer.ts` — state transitions, validation, projection
- `game/src/types.ts` — JSON-safe state/op/projection contract
- `coordination/crypto-battle.ts` — TenkaCloud plugin adapter
- `portal/` — participant slots
- `dev/` — local browser harness
- `game/src/vertical-playtest-fixture.ts` — deterministic multi-move fixture
- `game/src/replay.ts` — public debrief timeline


### Visual guidance release check (2026-09-06)

In the local harness, use `fresh` / alpha / Japanese. Select PROVE and table
`1→3 2→1 3→4 4→2`; derive the four holes from the visible left board. A wrong
last hole shows PROVE MISS and no celebration. Correcting it shows the awarded
30 points and total, with a short confetti burst and a persistent result.
In `hunt-reachable` / bravo, open the HUNT entry. The visible alpha shares at
indices 3,4,5 have values 36,61,10 and factors 10,-15,6. The displayed operation
gives -495, whose remainder modulo 97 is 87; submitting it succeeds. This
rehearsal uses public worksheet values, not alpha's vault. These are fixed local
harness examples, not event secrets. Game tests also check all 3-of-5 index
subsets over fields 7,11,97 and exclude duplicate, retired and own-team evidence.


### Schema 6: endgame hint booster

The new `endgameBooster` persists one distribution decision. Activation is
immediate at distribution because #659 §9 defines no separate activation move.
The ranking is read after ordinary deadline/RPS settlement at the endgame
boundary and before an operation stamped at that same time. A late tick reads
that boundary state only to select recipients; its real state still follows the
original single-tick issuance/expiry path, avoiding newly issued unseen Orders
and artificial catch-up penalties. Hosts must retain tick → validate → apply.

Versions 1–5 before the boundary migrate to pending. Already-past legacy states
migrate to an explicit unavailable decision: no prior ranking is stored, and
current scores cannot reconstruct it. Numeric roster HUNT budgets, pending RPS
reservations and the public ledger are preserved. Reload/checkpoint round trips
retain the saved decision. Rollback requires a schema-compatible plugin; do not
feed schema-6 rows to older plugins.

The optional `reveal-hint.expectedCost` binds the new Portal's displayed price
to the atomic hint operation. Older clients may omit it; they retain the existing
server-priced contract. Regular prices remain projected so a local countdown
can restore them between polls. No score event is created for a zero delta.

Validation: `bun test` and `bun run typecheck` in `game/`, including
`src/booster.test.ts` (actual reducer/host, existing RPS reservations, JSON
checkpoints, delay equivalence and real component rendering), plus the local
browser route recorded in `dev/BOOSTER-PLAYTHROUGH.md`.

### Schema 7: a public-position Vigenère cycle

`caesar-shift` remains the wire task discriminator for compatibility; `rung`
distinguishes Caesar and Vigenère. New Vigenère tasks and cipher-pair records
carry public `keyPosition` (zero-based 0..2; displayed as 1..3); compact records
use `kp`. The derived private key is three integers, visible only on the owning
team's Order projection. Old Caesar rows keep their scalar keys and omitted
positions. Schema-6 migration preserves contracts, ledger bytes, HUNT/RPS
reservations, and the saved booster award; the existing migration chain remains.
Rollback must not feed schema-7 rows to a pre-Vigenère plugin.

The issue's full-length Vigenère example reveals every key from one known pair.
This implementation therefore issues one position per Order, with a publicly
known period and offset, and checks **coverage**, not record count, for the
participant attack route. A long pair covering a cycle still reveals all keys.
The server requires public pairs covering all three distinct positions for that
target/rung/current generation before comparing the submitted key. Repeated
positions and records from other teams, generations or rungs do not unlock HUNT.
Caesar retains its existing validator.

This follows the private trusted-judge and time-progression decisions in
[PR #661](https://github.com/susumutomita/TenkaCloudChallenge/pull/661), and the
incremental rung contract in [#659 §13](https://github.com/susumutomita/TenkaCloudChallenge/issues/659).
The owner's [week 2 notes](https://github.com/susumutomita/advanced-cryptography-note/blob/58344a29ea39c25839475ba9a594c115ed89989b/week2/index.html)
(section 「三つ組は1乗算1回限り」) demonstrate how subtracting public masked values
exposes relations when a mask repeats. That is related algebra, not a claim
that Vigenère implements Beaver triples or achieves one-time-pad security.
No dedicated Vigenère treatment was found in the checked local seminar notes.

The Rotor model below completes the next cipher exercise. The existing
homomorphic-sum Order already runs in every phase; it is an addition-only
teaching model and is not full FHE. No additional homomorphic Order is introduced.


### Schema 8: Vigenère answer adjudication

A well-formed incorrect Vigenère CIPHER is an accepted move: charge the existing
`scores.wrongProve` (default 6), persist `Contract.cipherFailed=true`, and publish
nothing. Subsequent correct answers complete that Order for 0; LEAK remains at
its normal points, and ROTATE/deadline retain the ordinary one-time expiry
penalty. Shape/length/alphabet errors are rejected without a failure record.
This removes the guaranteed six-candidate reward without new point constants,
clocks or attempt-budget configuration. It does not prevent a lucky first guess.

`TeamState.lastCipher` and the own projection record the actual result/delta;
SDK `ok` alone is not a correct answer. The browser states the reward forfeiture
before the answer and offers a zero-point completion after a miss. Schema-7
migration preserves all Vigenère records, numeric HUNT reservations and booster
allocation; missing failure flags mean no previously charged miss. Existing
true flags survive migration, reload, LEAK and ROTATE. Rollback requires a
schema-8-compatible plugin. Caesar's existing retry adjudication is unchanged.

Free Vigenère material carries the problem's own values, a general formula and
an unrelated small example. The three paid guide texts, including live-value
instructions at level 3, reach the Portal only through projected purchased hints.


### Schema 9: fixed endgame lightning

`endgameLightning` fixes eligible teams once on the same temporary boundary tick
used by the hint booster. Actual time advancement remains the original single
tick, so a late poll does not issue/penalize unseen Orders. The host ticks before
an operation, fixing eligibility before that operation's score changes. Rank
cutoff is the second-lowest roster entry for 3+ teams, lowest for two, and none
for solo practice; ties at the cutoff all receive one card.

Each card is available, armed for one Order, or terminal; targeting writes the
Order ID, reward and existing deadline atomically with the operation. These
records survive terminal Order pruning. Only the owning projection exposes the
card. Ordinary calculation completions share the multiplier, including private
CIPHER, encrypted addition and masked totals. RPS duel outcomes and all LEAK,
HUNT, hint and penalty paths keep their existing score rules. No extra award
occurs at declaration, and no zero-delta score history event is needed.

`answerAttempted=false` is written on newly issued calculation Orders. An accepted
PROVE miss changes it to true; Vigenère uses its existing `cipherFailed` too.
Legacy absence is unknown and ineligible, not a made-up empty history. Existing
CIPHER/FHE/MPC validation rejections still do not write attempt state. A wrong
answer after declaration does not detach the card. Existing Vigenère forfeiture
makes the multiplier zero and remains visible; the card is spent on correct
completion, LEAK, deadline, ROTATE or match end. There is no new penalty/timer.

Migration supports v1–v8, preserving compact roster reservations, Vigenère failure
flags and booster decisions. Missing allocation is pending before the boundary
and unavailable after it; it is never reconstructed from a later score. Schema-9
rows require a compatible plugin on rollback. Verify game/dev tests and types,
`make agent-gate`, and the `lightning` harness scenario; AWS rehearsal is optional.


### Schema 10: small RSA encryption and public-key factor HUNT

Only normal cipher slots scheduled at/after endgame use RSA. Parameters are
(3,11,3), (5,11,3), (5,13,5), (7,11,7), representing (p,q,e). Derivation stays
server-side and separated from the Shamir seed domain; n/e project to everyone
from endgame, while m projects only on its owner's Order until LEAK. The tiny
set intentionally allows repeats after ROTATE; do not claim key renewal makes
factoring infeasible. `rsa-pair` stores public n/e/m/c only. Its compact `p` field
means plaintext, not a prime factor. CIPHER uses the existing BigInt modular
power helper and failure/zero-retry/lightning scoring paths.

Migration from v9 preserves existing Orders, compact Shamir/sudoku/RPS attempt
reservations, ledger records, Vigenère failure bits and declared lightning cards.
Only future normal endgame cipher slots become RSA. Completed Order IDs reuse
the ledger's exact `teamId-cN` ↔ numeric N codec, while unfamiliar IDs stay
verbatim and the participant projection returns full strings. Rollback must use
a plugin that understands all schema-10 encodings, including the RSA hunt log;
older decoders must not read these rows. No resource, IAM, timer or point value
is introduced. The measured capacity declaration is updated above.

RSA success reservations encode `r<pairIndex>:<generation>`, where `pairIndex`
is attacker roster position × fixed roster length + target roster position, written
in base 36. This preserves ID separation
without storing long IDs for every attacker/target pair. ROTATE discards only
retired RSA reservations, since old-generation submissions are rejected anyway.
Other HUNT history, public records and per-team attacked-generation lists remain.

Every new successful RSA HUNT also appends its exact millisecond timestamp to
`huntLog`. One compact row per target/generation stores a sorted-roster slot per
attacker, with zero for absence and an exact offset from the row's base time.
ROTATE never removes these rows: replay can still name every attacker, target,
generation and time. Legacy Shamir/sudoku object entries remain readable.
Earlier schema-10 candidate rows containing only reservations have no recorded
RSA timestamps; migration preserves those guards but cannot invent past replay
events. The 99-team test retains all 106,722 new RSA successes across eleven
generations, including differently timed attacks that require wider encoding.

The RSA HUNT checks distinct prime factors of the current n in either order.
It never compares an internal canonical d. See `game/src/rsa.test.ts` for the
complete small parameter/residue sweep, malformed input, private projection,
actual host scoring, migration, repeated submission and ROTATE regressions;
`game/src/state-size.test.ts` includes public RSA LEAK and pairwise HUNT traffic.
The independent packet and browser evidence are in `dev/RSA-READING.md`.


### Schema 11: Rotor and lossless HUNT bookkeeping

New normal pressure cipher slots alternate Vigenère and Rotor; issue time fixes
the task even under a late tick. Existing RSA, Vigenère, scalar Caesar, RPS,
lightning, booster and failed-CIPHER state retain their rules. A Rotor public pair
stores only plaintext/ciphertext, owner, generation, Order and publication time.
The owner's initial positions are derived at projection time, never stored in an
Order or public artifact. One pair is an entry gate, not a uniqueness predicate.
Rotor attempts share the existing Shamir/RPS count; Sudoku remains independent.

Schema11 changes the saved representation, with no new public information:

- Public Ledger entries use fixed tuples and the existing sorted match roster.
  Old short-key objects and literal team/Order/artifact IDs remain readable. Every
  value, exact publication time, ID and ledger entry order survives projection
  and replay; unfamiliar IDs are kept verbatim.
- Shamir, Sudoku, RSA and Rotor successes share the existing dense exact-time
  audit codec with distinct method tags. If compaction would change a legacy
  same-millisecond replay order, migration retains that entire old huntLog.
  Each audit also rejects repeat success,
  avoiding a duplicate guard. ROTATE retains these records across generations.
- Classic cipher success and legacy guard-only rows use one bit per fixed roster
  attacker, grouped by method/target/generation. A guard without a recorded time
  remains untimed: migration does not invent an event in the replay.
- The two independent HUNT counters use fixed roster slots and the same lossless
  safe-integer codec as audit offsets. Counts above3 stay exact. Schema4–10
  numeric keys are validated; schema1–3 logical keys first use the existing
  converter. Reserved RPS refunds retain their own old-generation counts.
- Latest HUNT verdicts use roster tuples. Legacy objects, including absent score
  deltas, stay readable; an unknown historical delta is never reported as zero.

The schema-11 migration accepted schemas1–10, preserving existing Vigenère failure flags,
lightning and booster decisions, RPS predictions and current-generation guards.
Only a guard with a matching real audit record is removed as redundant. Other
untimed guards remain; the existing retired-RSA-guard policy is unchanged.
Malformed identities/counts fail without rewriting the saved row. Mixed-version
workers must respect the declared schema (currently12). Roll back only to a worker that
understands that version; never relabel a row as an older version. No platform
configuration or cleanup change accompanies this migration.


### Disclosure ROTATE floor (PR #752 follow-up)

Answering a publication-required Order records `disclosureRotationCost` on the
current team generation, equal to one expiry penalty. ROTATE charges the larger
of this floor and its existing voided-Order penalties, never both. The marker
survives JSON reload and Order pruning and clears on rotation. Optional disclosure
alone does not activate it. The Portal receives `rotateMinimumPenalty` and shows
it before ROTATE; the publication primer also states this price.

The escape bot now clears other work first, publishes, then immediately rotates
after each disclosure. It pays the floor even with no unanswered work and scores
below the race policy. Avoiding exposure remains a paid choice, not a guarantee
that both human teams will choose to attack. The 90-minute RPS test retains all
attacks, but its final score is 135 lower (nine disclosure retirement fees of15).

Browser check for PR #752: the real local dev harness at 375×812 rendered
`LEAK +30` and `LEAKのみ` on the disclosure card, with document scrollWidth375.
Selecting a disclosure and submitting LEAK showed the minimum15-point ROTATE
cost before its button. Screenshots: disclosure-mobile-752.png and
disclosure-rotate-price-752.png in the local verification output directory.
This used the harness's accelerated, paused scenario, not an AWS event or timed
human gameplay. The existing sticky Order queue remains visible while scrolling.

### Disclosure retirement schema 12

Schema 12 records the generation-scoped disclosure retirement fee. Migration accepts schemas 1–11, preserving saved scores, Orders and history. A legacy generation has no fee until a new mandatory disclosure is answered; no historical fee is invented. The platform must reject schema-12 rows on older workers, including during rollback. ROTATE charges the larger nominal fee (retirement minimum or voided-Order penalties) once, with the existing zero score floor.
