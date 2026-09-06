# Issue #740: prediction before simultaneous publication

The reducer now accepts an RPS prediction after the opponent has privately given
their opening to the judge, until both hands become public. The active RPS answer
area contains the opponent, current sealed number, two public records, a short
calculation table, and the optional prediction submission. No hidden hand or r is
sent to the hunter. `openingHeld` is only a public boolean status; old projections
may omit it. Scores, deadlines, order distribution, ROTATE and forced publication
rules are unchanged.

## Reproducible 90-minute reducer run

From `../game`, run `bun test src/rps-interaction.test.ts`. This uses the real
reducer with `DEFAULT_CONFIG` unchanged: two teams, 90 minutes, the initial Order
then six Orders at minute 1 and every five minutes. Both teams correctly answer
each batch, complete their RPS duel and ROTATE as soon as the cooldown permits.
Both use identical public-evidence prediction logic. The first opening seat
alternates, so each team also acts as the last opening seat.

Synthetic choices draw each hand and r independently with SHA-256 and rejection
sampling, allowing normal chance repeats. Trial 85 was selected from the earlier
200-trial author experiment for equal final scores; it is an existence example,
not an estimate of success probability. Author answer helpers complete non-RPS
Orders from the team's own projection; this is not a human reading-speed or
90-minute playability measurement.

| Observed per team | alpha | bravo |
|---|---:|---:|
| Completed Orders | 109 | 109 |
| ROTATE operations | 18 | 18 |
| RPS duels with an available prediction target | 14 | 14 |
| Predictions submitted | 3 | 3 |
| Hits / misses | 1 / 2 | 1 / 2 |
| Hits submitted after the judge privately held the target's opening | 1 | 1 |
| HUNT points | +9 | +9 |
| Final score | 3284 | 3284 |

No Order expires. Maximum unanswered batch size remains six. Neither team LEAKs
shares or plaintext/ciphertext pairs. In the preceding pinned-main experiment,
share-recovery and Sudoku-recovery opportunities and attacks were zero for both
teams under this correct-answer/fresh-proof/ROTATE policy. Zero attacks without
choosing to predict therefore did not establish zero RPS opportunities.

The attacking function `publicPrediction(view)` accesses only
`view.rpsHunt.targets`: the current public commitment and past published r. It
tries `commit(m, pastR)` for m=1,2,3 and submits a match. It does not receive raw
state, another team's vault, current opening, current r or answer-generating
helper. After publication, the test reads the public result solely to measure it.
Own hands/r are generated separately and used only for each owner's seal/open.

Concrete successful calculations from this synthetic sequence:

- Minute 51, alpha targets bravo: past r=7 gives `9^7 mod 23 = 4`. The three
  candidate remainders are 16,18,3; public c=3 selects hand 3. Final opening is 3.
- Minute 76, bravo targets alpha: past r=6 gives `9^6 mod 23 = 3`. Candidates are
  12,2,8; public c=8 selects hand 3. Final opening is 3.

This does **not** break fresh-r hiding. The second test enumerates all 33 current
hand/r pairs for each past r: nine commitments match some candidate, and only
three predictions are correct. For independently uniform hand and r, the
conditional hit rate remains 1/3. Existing +25/-8 scoring has positive blind-guess
expectation; this change neither changes that scoring nor claims the public
history makes a fresh uniform opponent predictable.

## Publication boundary and race

`src/rps-hunt.test.ts` exercises the two possible accepted-write orders from one
snapshot with an opening already held privately. Prediction first is accepted
and then scored by the final opening. Final opening first publishes both hands;
revalidating the stale prediction rejects it. Expiry and a second prediction in
the same duel also reject. A third-party hunter sees `openingHeld: true`, no hand
or r in the target, and no current-duel opening in the public ledger.

These are pure reducer linearizations. The parent dispatcher's existing CAS retry
must reread and revalidate after losing a version race. This local harness does
not prove DynamoDB/Turso concurrency, authentication, deployed catalog state or
AWS behavior. No new persistence or concurrency mechanism is introduced here.

## Real Portal component check, 2026-09-06

Run `PORT=5674 bun run server.ts` in this directory, then visit
`http://127.0.0.1:5674`. The server explicitly binds localhost. The local harness
uses the real StatusPanel/FastMovePanel/RpsDuel/RpsHunt components and reducer,
with synthetic scenario state. The developer toolbar is not participant UI.

Headless Chromium was exercised in two tabs with the `rps-reuse` scenario:

1. Alpha chooses current RPS Order #18, hand 1, r=1, and calculated c=13; seals.
2. The second tab chooses bravo and gives its opening, hand 2/r=2, to the judge.
   Alpha's original tab remains mounted and polls the private-held status.
3. Alpha sees past r=2 twice and current c=8. The visible products 4×12, 16×12,
   18×12 have remainders 2,8,9; choose hand 2. Focus the prediction selector, Tab
   to the submit button and Enter. The accepted-but-unscored notice appears.
4. Alpha's own hand=1 and r=1 remain unchanged. Focus its opening button and Enter.
   The real reducer and screen show DUEL win +30 and prediction hit +25, total 55.
   The current prediction form disappears; the published hand is labelled as such.

At 375×812 the input retention and final opening were verified by keyboard.
Comparing the Vigenere #751 worktree found only its CIPHER-input scroll margin;
the RPS/HUNT controls were still outside that protection. The existing scroll
margin approach now applies to answer/HUNT inputs, selects, buttons and summaries,
including the narrow queue's 40px offset. Cards remain rendered and sticky.

Measured after that correction: document width/scrollWidth 375/375; queue bottom
381.03px; focused prediction select top 583.84px; submit top 617.84px. Hit-testing
at the submit button reaches that button. At 640×360, width/scrollWidth 640/640,
queue bottom 140.80px and focused select top 213.08px. This short viewport is a
reflow check, not an assertion that physical browser zoom or a mobile device was
tested. Ordinary page scrolling still moves content behind the sticky queue;
the correction protects controls reached through automatic focus/scroll.

Local screenshots (not catalog assets):

- `/private/tmp/issue740-before-prediction.png`
- `/private/tmp/issue740-prediction-accepted.png`
- `/private/tmp/issue740-narrow-pending.png` (before the scroll-margin correction)
- `/private/tmp/issue740-narrow-form-fixed.png`
- `/private/tmp/issue740-narrow-submit-fixed.png`
- `/private/tmp/issue740-short-form-fixed.png`

## Validation evidence

- Full game suite: 625 passed, 0 failed; `/private/tmp/issue740-game-tests.log`.
- Dev harness: 52 passed; `/private/tmp/issue740-dev-tests.log`.
- Final affected Portal/RPS/Order tests: 179 passed;
  `/private/tmp/issue740-final-portal-tests.log`.
- Final 90-minute opportunity-count regression:
  `/private/tmp/issue740-interaction-final.log`.
- Game and dev TypeScript checks passed.
- `make install`, `make agent-gate` and `git diff --check` passed. The child gate
  validates all 116 catalog metadata documents; it does not itself run game tests.

The original main experiment is preserved separately at
`/private/tmp/issue740-balance-results.json` (base
`24ac02fc7e7f2e2683dc7ec6d6d5d893fb6a9329`). Do not overwrite that baseline by rerunning
its temporary script against this modified worktree. No shared AWS, Docker,
port 5657, physical Mac UI or deployed Portal was used.
