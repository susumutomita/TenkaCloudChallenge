# Cryptography Battle — operator guide

[Play guide (English)](README.md) · [遊び方（日本語）](README.ja.md) · [Local preview](dev/README.md)

This guide describes current operation. For scheduling, staffing and event preparation, use the [event-host rehearsal](../../challenges/event-host-rehearsal/README.md). Historical implementation and validation results remain in Git, Issues and the dated records under `dev/`.

## Before an event

1. Use compatible versions of TenkaCloud and this problem pack. The platform must support the coordination plugin, score delivery and team projections.
2. Allocate teams within the backend limits below. Default play is 90 minutes, designed around four-person teams; allow additional time for joining, the first mission and debriefing.
3. Choose pacing and whether to enable the optional score-steal exercise **before** deploying the pack. Complete all team deployments before creating the match.
4. Rehearse the first mission, one completed Order, one HUNT, an expiry and the official scoreboard. Check both Japanese and English if the event needs them.
5. Start a fresh match. Ready normally starts play only after all teams are ready. The waiting room also provides an explicit action to start without everyone.

These steps describe operator work; the commands below run only local validation, not deployment.

| State-storage backend | Maximum teams per match |
| --- | --- |
| DynamoDB | 12 |
| libSQL / Turso | 99 (the catalog maximum) |

These are deployment admission limits. The [metadata](metadata.json) declares a state budget of `31 KiB × teams + 1,536 bytes`. With the 400 KiB DynamoDB limit this admits 12 teams; libSQL's 4 MiB limit permits the catalog maximum of 99. The admission calculation is covered by [state-size.test.ts](game/src/state-size.test.ts). Choose the backend before allocating a larger roster; a deployment preflight rejects a roster above its limit.

## Pacing and topic selection

Edit [game/src/pacing.ts](game/src/pacing.ts) and rebuild the problem for a **new** match:

| Setting | Default | Supported values |
| --- | --- | --- |
| `MATCH_PACING.answerSeconds` | 180 seconds | Integer 30–900; applies to regular and rush Orders |
| `MATCH_PACING.arrivalSeconds` | 30 seconds | Integer 10–300 |
| `MATCH_PACING.arrivalJitterSeconds` | 10 seconds | Integer 0 up to `arrivalSeconds - 1` |

For example, `answerSeconds: 240` gives four minutes. Arrival timing varies around the base interval; do not put the exact schedule in participant instructions. The seeded schedule is shared by teams and does not reroll on reload.

[STREAMING_ORDER_CONFIG in reducer.ts](game/src/reducer.ts) is the production new-match configuration: one Order per arrival, at most three unanswered Orders per team including duels, and mixed cryptographic topics. `DEFAULT_CONFIG` also supports older fixtures and is not the complete production pacing configuration.

A full queue skips arrivals without charging for an unissued Order or accumulating a later burst. Delivery resumes at a subsequent arrival after room opens. Duels need room on both teams. After the two opening tasks, non-duel topics follow shuffled bags; RSA is not restricted to the endgame. New anamorphic encryption, decryption and probability exercises are separate Orders. Legacy combined tasks remain readable.

Settings are bundled with the problem, not an in-match administrator control. Existing matches retain their stored settings and issued deadlines when code is deployed.

## Scores and deadline behavior

The Order's displayed reward and accepted methods are authoritative for that Order. Defaults come from [reducer.ts](game/src/reducer.ts), with cipher-specific rules in [ladder.ts](game/src/ladder.ts).

| Event | Standard behavior |
| --- | --- |
| Correct calculation | +30; rush reward +45; an applicable declared Lightning card doubles the reward |
| Voluntary LEAK | +10 |
| Publication-required Order | LEAK earns its full displayed reward; leaving it unanswered publishes nothing |
| Unanswered deadline | −15 once, with a score floor of zero |
| Purchased hints | −2, −4, −8; a charge is not refunded by leaving the Order unfinished |
| RPS outcome | Win +30, draw +10, loss 0 |

Do not apply one retry policy to every task. A well-formed wrong Schnorr response costs 6 and consumes that proof attempt. A proof-only Order then ends; an Order allowing LEAK can still be completed by LEAK. The failed proof does not force another expiry deduction. Legacy Sudoku and other worksheets have their own retry rules. Vigenère/Rotor/RSA encryption misses can also forfeit that Order's later calculation reward. Other validation failures may reject an operation without changing score. Check the method's visible explanation and its tests before changing these rules.

For RPS expiry, an accepted opening qualifies for a forfeit win if the opponent does not finish. A submitted commitment also qualifies when the opponent has not committed at all. If both committed but the player has not supplied their own opening, that player still has a required action and can receive the ordinary expiry penalty. Timeout does not publish a private opening. See [rps.ts](game/src/rps.ts).

HUNT prices differ by method. Shamir and Rotor use the shared per-attacker/target/generation attempt budget; RPS reservations share that budget, while legacy Sudoku has a separate budget. Cipher-specific rewards and validations must not be inferred from the general +25/−12 HUNT values. The Portal displays method-specific effects before submission. A breach notice reports the target's loss; no ROTATE action is currently offered in the main UI.

## Endgame support

At the configured endgame boundary (normally minute 60), eligibility is fixed from scores at that boundary:

- Lowest-ranked teams, including ties, receive ten minutes without hint deductions. Solo practice is excluded.
- The bottom two teams receive one Lightning card; ties at the distribution boundary are included. For two teams only the lower-ranked team qualifies; solo practice is excluded.
- Lightning must be declared for an eligible calculation Order. It does not double LEAK, HUNT, RPS outcomes or deductions, and does not extend a deadline.

The relevant implementations are [booster.ts](game/src/booster.ts) and [lightning.ts](game/src/lightning.ts). Preserve the saved allocation on reload or upgrade; never recompute an earlier allocation from later scores.

## Optional score-steal exercise

Disabled by default. In [metadata.json](metadata.json), operators can set:

| Parameter | Value |
| --- | --- |
| `cfnParameters.ScoreStealEnabled` | `"true"` to enable |
| `cfnParameters.ScoreStealKey` | An integer string from `"1"` to `"9"` |
| `cfnParameters.ScoreStealSeed` | Keep `"__RANDOM_PASSWORD__"`; the existing deploy chain injects a per-deployment receipt |

Use a dedicated AWS account per team. Complete every team deployment with consistent settings before starting a new match. This requires platform SDK 0.2 deployment-input support and filtering of `CoordinationPrivate` outputs; do not use the template alone against an older platform.

After five minutes, the exercise can replace an ordinary arrival with queue room. It is offered once per team, counts toward the three-Order cap and uses the normal deadline. The participant opens their own Parameter Store value, pastes the full value containing `key` and `receipt`, and decrypts one digit. The receipt is checked by the server and is not part of the arithmetic.

Acquisition alone gives no points. Using the item transfers up to 10 of an opponent's remaining points to the holder. Acquisition and use are each limited to once per team per match; a victim can be charged once, and a zero-score target is ineligible. Consumption and both score changes are saved together through the existing coordination path. See [score-steal.ts](game/src/score-steal.ts).

## Runtime, private data and official scores

```text
Participant Portal → authenticated team coordination API
  → TenkaCloud dispatcher (persistence and concurrency control)
    → coordination/crypto-battle.ts → game/src/reducer.ts
  → official score and history delivery
```

[crypto-battle.ts](coordination/crypto-battle.ts) adapts the pure game hooks: `initialState`, `tick`, `validateOp`, `applyOp` and `projectForTeam`. TenkaCloud owns dispatch, authentication and persistence. No game server is deployed per team.

| Data | Access |
| --- | --- |
| `matchSecret`, full state and seed | Trusted platform only |
| Own vault and open Orders | Owning team's projection |
| Opponent's un-leaked shares and keys | Not projected to the attacker |
| Public ledger, public keys and public puzzles | Public according to the relevant protocol; not all public data comes from LEAK |
| Optional item receipt | Server-side deployment input and the owning team's scoped AWS read; not public deployment output or ledger data |

Production hidden values derive from `CoordinationContext.matchSecret`, never public `eventId`. Local fixtures may use the explicit non-secret marker `local-play-not-secret:<eventId>`; reaching it in a real event is a wiring error. Never log or export live secrets in a replay or test fixture. All reads to the browser must use the team projection.

The plugin exposes `teamScores` and operation reasons for official score delivery. A score in the local harness is not an official score. If the live board and Portal disagree, inspect the deployed platform/catalog revisions and official delivery/refresh path before changing game arithmetic.

## Saved matches and upgrades

The current reader version is declared by `STATE_SCHEMA_VERSION`, and `migrateState` in [reducer.ts](game/src/reducer.ts) defines supported migrations. Do not maintain a separate version number in this guide.

Upgrade between events. Preserve stored Orders, deadlines, ledger entries, score changes and attack reservations. Old Sudoku proofs, combined anamorphic worksheets and generation/ROTATE records are compatibility data, not the current player route. Do not feed a newer row to an older plugin.

A legacy v2 row with an unspent nonce-reuse HUNT is deliberately rejected by migration rather than silently losing an earned attack. Finish that match with its compatible plugin, or arrange a deliberate reset with the event owner. Reset/delete must remove only the target match state and its separate secret record through the platform lifecycle.

## Resources, cost and cleanup

The [template](template.yaml) normally creates a participant viewer IAM role. The optional item adds one **Standard/String Parameter Store parameter per team**, scoped value reads and metadata-only `ssm:DescribeParameters` listing. It adds no item-specific Lambda, KMS key or S3 bucket. `ExternalId` remains required for the participant role.

The default operating region is `ap-northeast-1`; check the event deployment region. Expected play lasts 90 minutes. Existing platform API/Lambda invocations, score/state storage, logs and any hosting/network usage still contribute to the event's costs; CloudShell usage is also separate from game arithmetic. A zero total bill is not guaranteed. Use current account billing tools for estimates rather than a fixed price table.

After the event, the operator deletes the problem stacks through TenkaCloud's supported lifecycle, removing the parameter and viewer role, and removes the match state/secret when no longer needed. Deleting this problem does not delete shared platform hosting, logs or storage; those can continue billing under the platform's retention and teardown policy.

## Local verification

From the TenkaCloudChallenge root:

```bash
make install
make agent-gate
```

For game or participant-flow changes, run the owning packages:

```bash
cd battles/ac26-crypto-battle/game
bun install --frozen-lockfile --ignore-scripts
bun test
bun run typecheck
cd ../dev
bun install --frozen-lockfile --ignore-scripts
bun test
bun run typecheck
bun run dev
```

The full game suite includes long capacity traces. CI chooses ordinary and capacity checks based on affected files; do not remove required coverage to shorten a run. For a documentation-only change, check the documented facts and links plus the catalog gate.

The [preview guide](dev/README.md) explains scenarios and participant interactions. The harness uses real game/Portal code with fake auth and in-memory state. It can validate inputs, results, retention, language and layout; it cannot validate production isolation, official persistence or live AWS permissions. Rehearse those in the intended event when needed, and record exactly what ran. Historical test counts and screenshots are evidence of that revision, not a current completion claim.
