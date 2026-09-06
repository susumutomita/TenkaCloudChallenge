# RSA: participant reading and local acceptance

Scope: one `rsa-encrypt` rung in the normal endgame cipher slot of #659.
Base: `7bec1289e8119df2bb88636e3ffbc4983e0ec920` (schema-9 lightning).
This candidate writes schema 10. Rotor/Enigma and the later homomorphic ladder
rung remain outside this increment, so #659 remains open. The separate balance
Issue #740 was already closed by PR #753; this change does not replace that work.

## Participant-only maximum-range packet

The independent reader received only public/own projection values, the three
hint stages, submission rules, the formula and a different one-digit example.
No fixture seed, reference implementation or author answer was supplied first.
The task was m=9, n=77, e=7; the opponent's public key was also n=77, e=7.

The reader began at 2026-09-06 14:36:41 UTC and returned at 14:37:05 UTC (24 s):

- CIPHER: 9² leaves 4 modulo 77; 9⁴ leaves 16; 16×4=64;
  64×9=576=77×7+37. Submit `37`.
- HUNT: 77=7×11, with both factors prime. Submit `7`, `11`.
- The first reading found a real missing connection: why factors enable an
  attack rather than merely solve a factoring puzzle. The screen now says the
  factors allow calculation of a recovery key. Optional mathematics defines
  φ=(p−1)(q−1), ed leaving remainder 1, and recovery by c^d modulo n, with
  n=33/e=3 and more than one valid recovery exponent. HUNT still asks only for
  the two factors, in either order.

This is independent **AI reading and hand arithmetic**, not a timed human
junior-high-school playtest. The implementation's author had read its internals;
author checks below are separately identified as runtime/UI verification.

## Actual Portal submissions

The dedicated local `rsa` scenario uses the real reducer and real StatusPanel.
It reaches minute 61 using ordinary ticks with the normal 90-minute match,
five-minute Order deadline, six-Order batch and usual point values. The fixture
seed stays in the server-only scenario module and is absent from the actual
participant browser bundle. No direct state mutation or answer-generating code
was used through the browser.

The connected Chrome session used `127.0.0.1:5680`, isolated from shared 5657:

- At 375×812, the Japanese CIPHER card showed selected Order/deadline, m9/n77/e7,
  formula, calculation diagram, wrong-answer cost and input/submit together.
  With the scenario clock running, three hints were opened; the unchanged
  independently supplied answer `37` was submitted at minute 61:41, 41 seconds
  after the clock began at 61:00. CIPHER completed for +30; no ledger entry was
  added. This timing measures the author's UI verification after the reading,
  not a first-time human solve.
- The same running-clock pass submitted unchanged factors `7` / `11` at 62:34
  (94 seconds from 61:00), with no LEAK record. HUNT added +25 and switched the
  opponent to already attacked. The opponent had 0 points, so the zero floor
  kept that score at 0; this UI pass does not claim to observe a 12-point loss.
- A final English pass at 1280×720 opened/closed the one-digit explanation and
  retained input `37`. The calculation action focused the answer; Tab focused
  CIPHER and Enter submitted it, resulting in +30 and no publication.
- At 375×812 in English, input `7`, Tab, input `11`, Tab reached Attack bravo.
  Target, generation, n77/e7, +25, wrong-attempt terms and both fields were
  visible together. Enter submitted it; score changed 30→55 and the worksheet
  became already attacked. Document width and scroll width were both 375px.
- Switching to bravo's own seat and pressing LEAK completed its RSA Order for
  +10 and published m8/c57 with public n77/e7. ROTATE then voided the displayed
  four remaining normal Orders, kept the RPS duel open and changed generation
  1→2. Alpha then saw bravo's new public n33/e3 and a new RSA attack worksheet.
  The old public m/c record remained visible.

The final keyboard checks used the paused harness clock to isolate focus and
input preservation; they are not additional deadline measurements. All UI
submissions above used the participant inputs and the real operation endpoint.
The two-team reservation string is unchanged by the final base-36 capacity
encoding; the complete game suite tests that encoding at up to 99 teams.

Evidence:

- [Japanese narrow CIPHER](evidence/rsa-cipher-narrow.png)
- [Japanese CIPHER result](evidence/rsa-cipher-success-narrow.png)
- [English CIPHER and keyboard focus](evidence/rsa-cipher-english.png)
- [English narrow HUNT confirmation](evidence/rsa-hunt-narrow.png)
- [HUNT result](evidence/rsa-hunt-success-narrow.png)
- [Published RSA pair](evidence/rsa-leak-narrow.png)

## Runtime, migration and capacity checks

`game/src/rsa.test.ts` exercises all four generated parameter sets and every
residue (including zero and multiples of a factor), unordered factors,
public-only/opponent isolation, private CIPHER and public LEAK, malformed input,
wrong-answer −6 followed by permanent 0-point retries, clean lightning +60,
replay, expiry and ROTATE. The maximum packet also runs through the real host
within controlled five-minute time. A nonempty actual schema-9 fixture retains
failed Vigenère, public records, numeric Shamir/sudoku/RPS reservations and an
armed lightning card through migration and the next real operation.

### Review follow-up: complete RSA replay within the existing capacity budget

Review [3944474852](https://github.com/susumutomita/TenkaCloudChallenge/pull/759#discussion_r3944474852)
identified that a successful RSA HUNT only wrote a current-generation replay
reservation. No timestamp reached `buildReplay`, and ROTATE removed the old
reservation. New successes now retain attacker, target, generation and exact
millisecond time in `huntLog`. `buildReplay` identifies RSA in both languages,
including after multiple ROTATEs and a serialized checkpoint. Legacy Shamir and
sudoku log objects remain intact. Earlier schema-10 candidate reservations have
no historical timestamp: migration preserves their guard and never invents an
event. Review [3944474854](https://github.com/susumutomita/TenkaCloudChallenge/pull/759#discussion_r3944474854)
also prompted the small bilingual README correction: RSA is implemented; rotor/
Enigma and the later homomorphic ladder remain future work.

Historical measurement, superseded by the complete-history bound below: the
pre-review `7b5c073` candidate measured 3,037,431 bytes at 99 teams, below its
then-declared 3,042,816-byte forecast. That route included current RSA guards
beside 9,604 unopened RPS predictions, but did not retain eleven generations of
timestamped RSA successes. The earlier guard implementation had reached
3,143,511 bytes before its roster-pair encoding was corrected. Neither older
figure is the current full-history capacity claim.

Storing a long object for every pair in every generation would exceed the
existing capacity budget. The new RSA representation uses one row per target/
generation, the existing sorted roster positions, an exact base timestamp, and
one fixed-width base-64 offset slot per other team. Zero denotes no success;
positive values recover `base + value - 1`. Width expands for later timestamps.
It loses no record and does not rely on attacks sharing a timestamp. Neither
secret factors nor the recovered private key enter the history. RSA guards,
other HUNT counters and their existing rules are unchanged.

To pay for permanent history, completed Order IDs reuse the existing ledger
codec: an exact `teamId-cN` becomes N, and all unfamiliar IDs remain strings.
All completion writers use it; the participant projection expands full IDs,
and score-reason comparisons normalize both sides, including an old-string to
new-number migration during a delayed DUEL forfeit. This introduces no new
counter encoding, pruning policy or platform resource. The independent reviewer's
actual 99-team completion route found 10,791 completed IDs (109 per team): their
arrays occupy 356,103 bytes as strings and 32,373 bytes encoded, a 323,730-byte
saving. At the unopened-DUEL peak the saving is slightly smaller because the
last 98 completions have not happened yet.

The capacity test retains the original full-Order route, all purchased hints,
public LEAK records, other private computations, settled duels, and **9,604
unopened RPS predictions**. A second actual reducer trace runs all **99 × 98 ×
11 = 106,722 RSA successes** and verifies every identity, generation and
millisecond after JSON serialization and roster insertion-order reversal. Its
clock uses the standard 90-minute match, RSA access from minute 60 and a
three-minute ROTATE cooldown:

- Twenty legal pre-endgame ROTATEs at minutes 0, 3, …, 57 yield generation 21.
- The already-active generation can be attacked at minute 60. Ten more ROTATEs
  fit before minute 90, so eleven attacked generations end at generation 31.
- Eleven successive attack windows span 7,000; 263,000; 263,000; seven times
  180,000; and 7,000 milliseconds, totaling 1,800,000. Attacks are spread from
  the first through the last millisecond of each window. The two 263-second
  windows require four offset characters, so this includes the legal delayed-
  ROTATE case that a same-time or exact-cooldown fixture misses.
- At eleven generations the nine interior cooldown intervals consume at least
  1,620,000 milliseconds. The remaining 180,000 permits at most two intervals
  to cross the 262,143 offset boundary; every other interval needs at most
  three characters. Fewer generations cannot increase that total character
  budget. All rows retain all generations; the fixture does not prune history.

The test forms a **conservative upper envelope**, not a claim that two independent
routes are one observed match: it retains the full-Order/RPS peak and all ledger/
completion fields, substitutes the maximum complete RSA history and current RSA
guards, and keeps the larger generation and score bookkeeping. The independently
played RSA history is 377,576 bytes. The resulting 99-team bound is **3,106,689
bytes**, below the unchanged **3,145,728-byte** budget (4 MiB with 25% headroom),
with **39,039 bytes** left inside that budget. The declaration is now **31 KiB
per team + 1,536 bytes**, forecasting **3,144,192 bytes** for 99 teams: at least
the measured bound and still below the same budget. No platform limit or test
headroom was relaxed. The measured DynamoDB edge is **305,641 bytes at 12 teams**,
within the 307,200-byte test budget; **329,207 bytes at 13 teams** crosses it.
The declaration's preflight ceiling remains 12.

The final game run passed **685 tests across 46 files**, including the full
99-team measurement. The additional string-ID → numeric-ID / delayed-DUEL
regression passed in a focused 39-test rerun. Game and dev typechecks passed;
the dev suite passed 61 tests and catalog validation passed all 116 entries.
These checks cover the new exact replay and storage boundary; the earlier
participant/browser evidence above covers the unchanged RSA action surface.

Commands run from this candidate:

```sh
cd battles/ac26-crypto-battle/game
bun run typecheck
bun test
cd ../dev
bun run typecheck
bun test
cd ../../..
make install
make agent-gate
```

The game suite includes the actual Portal server rendering and a real browser
bundle boundary check; the dev suite verifies that scenarios reach their
advertised positions. Catalog validation covers all 116 metadata entries.

Not run: real AWS event, Cognito/remote persistence integration, production
publication, and an independent human playtest. The local harness does not
claim those trust boundaries. No AWS, release or shared environment was changed.
