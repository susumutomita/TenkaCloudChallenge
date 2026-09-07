# Rotor reader and runtime record

This is author/operator evidence. It is not participant instructions or a human
reading-speed claim. The implementation starts from RSA review head `019eb56`;
RSA later merged as `2221a125`. Only the Rotor difference belongs in its PR.

## Scope and sources

Normal pressure cipher slots alternate Vigenère and a four-symbol, two-wheel
Rotor model. Endgame normal RSA, rush Vigenère, the existing encrypted-addition
Order, schedules, deadlines and prices retain their rules. The two-wheel model
is not actual Enigma and the rung order does not rank security.

The seminar snapshot is `bdbc913fa7fd4ed87ce7f0de6b1d73fb41e49732` and the owner's
notes snapshot is `58344a29ea39c25839475ba9a594c115ed89989b` (both rechecked).
Neither contains a dedicated Rotor exercise in the reviewed weeks 1–5.

- [Seminar week 5](https://github.com/susumutomita/advanced-cryptography-2026/blob/bdbc913fa7fd4ed87ce7f0de6b1d73fb41e49732/week5/README.md) and the linked slide introduce key generation, encryption and decryption.
- [Owner week 5](https://github.com/susumutomita/advanced-cryptography-note/blob/58344a29ea39c25839475ba9a594c115ed89989b/week5/index.html) distinguishes these operations and common/public keys.
- [Seminar week 3](https://github.com/susumutomita/advanced-cryptography-2026/blob/bdbc913fa7fd4ed87ce7f0de6b1d73fb41e49732/week3/README.md) and [owner week 3](https://github.com/susumutomita/advanced-cryptography-note/blob/58344a29ea39c25839475ba9a594c115ed89989b/week3/index.html) give Schnorr's specific repeated-r condition. Its two-transcript requirement does not transfer to this different formula.
- [NSA's educational simulator](https://github.com/NationalSecurityAgency/enigma-simulator/blob/master/components.py) supplies the position-add / wiring / position-subtract principle. This model omits the real machine's alphabet, notches, double stepping, reflector, ring settings and plugboard.

The free surface states both wheel formulas, output-before-step, the carry,
all public tables, and a separate one-digit example. Its position table is
constant. It never computes a live answer or the count of matching candidates.
A single LEAK can uniquely identify a state or remain ambiguous; the participant
must determine this from the public rows. A second LEAK is not mandatory.

## Fresh participant packet

The author first saved only participant-visible values and the procedure in
`/private/tmp/rotor-659-reader-v2/participant-packet.md`. The reviewer had seen the
previous design and its different author answer, so this was a new-values
participant-role check, not an independent first encounter with the concept.

The reviewer calculated the new CIPHER `3 2 3 2`, initial `a=3,b=2`, as
`3 2 2 3`. The public HUNT pair `0 0 1 1 → 1 1 1 3` gave `a=1,b=2`.
They recorded the intermediate rows in `root-hand-reading.md`: 27 character
transformations / 54 table lookups, with candidates 16→6→3→2→1. Reading began
around 16:48 UTC (exact start not captured), a mid-read clock was 16:49:07, and
completion was 16:49:57. This is an AI reading and hand-calculation check, not
human five-minute timing evidence.

`rotor.test.ts` uses an actual generated default-config Order matching those
values and submits these answers unchanged through the real reducer. The dev
`rotor` scenario uses the same generated match, not a rewritten task payload.

## Local Portal interaction

The real StatusPanel, FastMovePanel, HuntPanel and reducer ran in the dedicated
localhost harness on `127.0.0.1:18163`; no AWS or shared environment was changed.
A connected Chrome browser exercised the actual inputs at 375×812.

- Japanese CIPHER submitted the unchanged answer and completed for +30.
- HUNT used one public pair and the unchanged a=1,b=2, added +25, moved the
  opponent from 100 to 88, and switched the method to “攻撃済み”.
- Opening and closing the constant lookup retained the unfinished answer. Tab
  navigation from the submit control reached the hint control.
- The document width equalled the 375-pixel viewport with the table open.
- English, with the local server clock running, opened the three actual hint
  prices 2/4/8, accepted a well-formed miss at −6, showed the zero-point retry,
  and completed the same Order for 0 before its five-minute deadline. The local
  score reconciled as HUNT25 − hints14 − miss6 = 5. This was about 45 seconds of
  interaction using an already calculated answer, not fresh reading-speed evidence.
- No application console error was observed. Browser-extension warnings were
  present and are not attributed to the Battle.

Evidence files are under `/private/tmp/rotor-659-reader-v2/`: `rotor-ja-table-narrow.png`,
`rotor-ja-answer-narrow.png`, `rotor-ja-hunt-before.png`,
`rotor-ja-hunt-success.png`, and `rotor-en-zero-retry.png`.
After the final codec changes the backend was restarted, and the same CIPHER
and HUNT answers were submitted again through both Japanese and English UI.
The score was 55 and bravo had 88 points, with the method marked already attacked.
The Japanese viewport/document width was 375; English was also checked at the
normal desktop width. `rotor-ja-final-codec.png` and `rotor-en-final-codec.png`
record this final smoke check. The earlier clock-running retry remains the
five-minute runtime evidence; the final smoke deliberately used a paused clock.

## Earlier capacity findings — superseded by final traces below

The original RSA capacity fixture omitted successful Shamir/Sudoku hunts.
Adding Rotor's fixed-seed history to that incomplete fixture measured 3,090,328
bytes for 99 teams and 306,939 for 12, but **these are not guaranteed upper
bounds**. Do not use their passing assertions as capacity acceptance.

Independent counterexamples in `/private/tmp/rotor-capacity-review/` found:

- The fixed seed exercised 219 target/generation Rotor rows at 99 teams instead
  of the possible 297 rows. At 12 teams, all three normal opportunities and
  two-digit generations made the previous combined envelope 307,590 bytes,
  exceeding its 307,200-byte budget.
- One actual generation of 132 Shamir successes at 12 teams remained alongside
  the normal Order/RPS trace and measured 322,340 bytes without the added
  RSA/Rotor envelope. The fixture had omitted those permanent success records
  and repeat guards.

The independent baseline `019eb56` 12-team full-match trace accepted 4,092
Shamir successes over 31 generations and 360 ROTATEs, retained all eleven
endgame RSA generations, and reached 1,085,425 bytes. Thus the missing permanent
Shamir history was already a baseline storage defect, separate from Rotor.

Schema11 keeps the same records through fixed-roster codecs: exact-time audit
blocks, untimed success bits, two independent attempt counters, latest own HUNT
verdict tuples and Public Ledger tuples. Every public value, ID and Ledger order
survives. A guard with no time stays untimed. If compression changes an arbitrary
legacy same-millisecond replay order, the entire old huntLog is retained.

The current complete 12-team rapid-PROVE trace records 20,975 transitions and a
238,388-byte peak (211,883-byte final state): Shamir/Caesar4,092 each, Rotor396,
Sudoku2,167 and RSA1,452. RSA and Sudoku attacks occupy different milliseconds
within their generations. The real validator chooses whether the reused Sudoku
reveals allow an attack; author-only trial permutations do not inject artifacts.
Real CIPHER misses, subsequent LEAKs, lightning declarations and all hint levels
are included. The byte meter is compared with full JSON UTF-8 at every issuance
and at its saved peak. The earlier all-at-once RSA trace is not an upper bound.

At this earlier checkpoint, the 99-team final trace remained pending. The catalog gate, game/Portal typecheck,
and all 704 non-capacity game tests passed after the final codec changes. Earlier unindexed
99-team computations were explicitly stopped with exit130; they are not passes.
The later indexed rapid-PROVE and reuse computations were also stopped with
exit130 after the final combined run started, to avoid duplicate host load. The
indexed rapid-LEAK route completed at 2,834,392 bytes (941,806 transitions), but
it excludes the subsequent Sudoku/RSA-time/adjudication additions and is not the
final acceptance result.
No validator gate, point value, supported team count or capacity budget changes
to conceal a failure. The declared DDB12 / SQL99 admission model remains the same;
these declared limits are distinguished from the measured spare bytes.

### Recovered full traces and timestamp representation (2026-09-07)

The recovered `21718a5f` trace passed all three 12-team routes. Its 99-team
rapid-LEAK route passed at 3,043,637 bytes over 944,086 transitions. Its 99-team
rapid-PROVE route **failed** the 3,145,728-byte headroom limit: 3,600,518-byte peak,
3,362,488-byte final state, 1,107,256 transitions. This is not a passing result.

The follow-up timestamp codec can store signed differences between present
attacker slots instead of absolute offsets. Missing slots keep the preceding
value unchanged. It chooses this representation only when smaller and retains
absolute encoding for arbitrary safe-integer extremes. Positive-width old blocks
remain readable; negative widths explicitly select the new encoding. No timestamp,
attacker, generation, order, or success is removed or rounded. Tests cover gaps,
reverse arrivals, equal times, extreme integers, malformed differences, legacy
blocks and randomized values. All 707 non-capacity tests and the three 12-team
routes pass. The updated 99-team traces subsequently completed as recorded below.


### Final complete capacity traces (2026-09-07)

The final game code matches recovery commit `5ee6f9c8` byte-for-byte. All eight
state-size cases passed across three commands (the three 12-team routes, the
99-team rapid-PROVE route, and the other 99-team routes plus small rosters).
No team limits or byte budgets were increased.

| Teams / route | Peak bytes | Final bytes | Accepted transitions |
| --- | ---: | ---: | ---: |
| 12 / rapid-LEAK | 219,814 | 192,946 | 18,610 |
| 12 / rapid-PROVE | 238,388 | 211,883 | 20,975 |
| 12 / reuse | 201,759 | 201,115 | 12,743 |
| 99 / rapid-LEAK | 2,659,517 | 2,370,172 | 944,086 |
| 99 / rapid-PROVE | 3,065,951 | 2,799,403 | 1,107,256 |
| 99 / reuse | 2,066,612 | 1,942,180 | 560,466 |

These are the fixture's complete legal-transition traces, with retained histories
and repeat-attack guards checked after reload, not a proof over every imaginable
match. The separately tested admission forecast covers supported smaller rosters.
Logs are under `/private/tmp/rotor-recovery/`: `time-slots-capacity12.log`,
`time-slots-capacity99-prove.log`, and `time-slots-capacity-remaining.log`.
The 707 non-capacity game tests, 64 dev harness tests, type checks and catalog gate
also passed on the integrated main-based tree.

### Integrated Portal smoke check (2026-09-07)

At 375 × 812, the local real-Portal harness's Rotor scenario retained the visible
order queue after the successful four-character CIPHER answer. The public packet
`m=[0,0,1,1], c=[1,1,1,3]` led to initial positions `a=1, b=2` using the displayed
P/Q tables and carry rule. Entering these positions through the HUNT worksheet
produced “秘密を見破った！ +25 点”; alpha changed 30→55 and bravo 100→88. Rotor then
showed “攻撃済み”. The screenshot `/private/tmp/rotor-final-hunt-success.png` was
visually inspected and shows the order queue, success panel and next-order action.
The clock was paused: this confirms interaction and feedback, not a fresh timed
five-minute reader run. It does not exercise platform score-history persistence.


### PR #773 review corrections and complete rerun (2026-09-07)

Retained completed and expired Rotor orders now carry their issuance generation;
ROTATE does not reinterpret their keys with the current generation. A JSON
round-trip regression covers both cases. The Rotor worksheet defines division
remainders before using mod notation in both languages.

Dense HUNT rows now preserve acceptance order at identical millisecond timestamps,
including mixed targets/methods and appends after reload. Exact rank sequences use
raw, affine, repeated-motif, or dictionary encodings; timestamp differences may use
bounded run encoding. No event, timestamp, target, generation, or ordering is
removed. Old encodings remain readable. Malformed encodings are rejected.

The affine-only rank implementation exceeded the 99-team rapid-PROVE budget
(3,538,079 bytes). The motif implementation still exceeded it (3,489,947), as did
the dictionary-only probe (3,172,882). Bounded exact-difference runs resolved that
failure without raising the existing 3,145,728-byte budget or reducing team limits.

All eight capacity cases passed in one final command (1,137.19 seconds):

| Teams / route | Peak bytes | Final bytes | Accepted transitions |
| --- | ---: | ---: | ---: |
| 12 / rapid-LEAK | 218,326 | 191,386 | 18,610 |
| 12 / rapid-PROVE | 237,614 | 211,073 | 20,975 |
| 12 / reuse | 203,742 | 203,098 | 12,743 |
| 99 / rapid-LEAK | 2,638,394 | 2,366,841 | 944,086 |
| 99 / rapid-PROVE | 3,080,011 | 2,835,155 | 1,107,256 |
| 99 / reuse | 1,836,171 | 1,711,739 | 560,466 |

The suite checks each accepted transition, retained histories, reload behavior,
and repeat-attack rejection. It covers these complete fixtures, not every possible
match. Final checks: 713 non-capacity game tests, 64 dev tests, both type checks,
116-item catalog gate, and git diff --check passed. Evidence logs:
`/private/tmp/rotor-review-capacity-runs.log`,
`/private/tmp/rotor-review-game-final.log`,
`/private/tmp/rotor-review-dev-final.log`, and
`/private/tmp/rotor-review-catalog-final.log`. The earlier browser smoke remains
applicable to the worksheet; no new AWS or timed independent playtest is claimed.


### CI execution-budget correction

GitHub job 101610532510 passed metadata validation but was cancelled with
"The job has exceeded the maximum execution time of 5m0s" during game tests.
The complete local capacity suite took 1,137.19 seconds. CI now runs ordinary
regressions/type checks under the existing five-minute budget and all eight
capacity cases in four independent jobs (five small-roster/configuration cases,
then each of the three 99-team routes). Each capacity job has a 35-minute bound;
the existing per-case 30-minute bound and all byte/team/history assertions remain.
The paid Rotor hint and free concept panel also now define remainders before mod
in both languages, completing the wording correction beyond the worksheet.
