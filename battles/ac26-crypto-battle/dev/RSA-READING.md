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

The capacity fixture includes current RSA all-pairs successes **after ROTATE,
while the maximum RPS predictions are still unopened**. Independent review
caught that the earlier order measured these separately. At 99 teams the
unfixed combination reached 3,143,511 bytes, above the declared 3,042,816-byte
forecast. RSA success reservations now encode fixed roster pairs compactly and
retire only obsolete RSA generations. Other attack history and the permanent
public ledger are retained. The corrected fixture passes the existing forecast,
Turso 99-team / 25%-headroom budget and DynamoDB's measured 11-team ceiling;
no resource, capacity declaration or platform limit was enlarged.

The independent reviewer reran the final 99-team sequence: peak 3,037,431 bytes,
maximum 9,604 unopened RPS predictions, below the existing 3,042,816-byte forecast
and 3,145,728-byte operational budget. The reviewer also reran 19 RSA/reservation
tests (9,353 assertions); all passed, with no additional P1/P2 finding.

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
