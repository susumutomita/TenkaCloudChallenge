# HUNT flow verification — 2026-09-06

Run `bun install && PORT=5674 bun run dev` in this directory. This check uses the
real Portal components and reducer, an in-memory local match, and no AWS service.
Only the hunter's rendered public evidence is used to derive attack answers.

| Local scenario / seat | Action and observed result |
| --- | --- |
| `ledger-filling` / alpha | Bravo has 0/3 distinct shares and one sudoku group. Both show materials waiting with their different requirements. Neither answer form is rendered. |
| `hunt-reachable` / bravo | Alpha's shares and Caesar pairs show ready buttons. Choose the share worksheet. Indices 3,4,5 show public values 36,61,10 and factors 10,-15,6. The sum is −495, whose remainder after division by 97 is 87. |
| same | Enter 86 deliberately: HUNT MISS, −8, two attempts left. Enter 87: success, the share method becomes completed, its answer form disappears, the Caesar attack remains available. |
| `rps-order` / alpha | Choose the RPS Order, hand 1 and hiding number 1; submit sealed number 13 from the free example. The view says it is waiting for the opponent to seal; the opening button is disabled even with valid inputs. It states the approximately 30-second production refresh cadence. |
| same / bravo | Select the RPS Order and submit the same teaching example. Both teams have sealed: the view says opening is possible and the opening button is enabled with valid inputs. No unsuccessful opening attempt was needed to learn this status. |

The final HUNT colours were inspected against the harness's dark host. Inputs
explicitly use dark text on white; target buttons specify their own text colour.
At a 390px viewport the HUNT frame measures 336px with 334px scroll width, so its
content does not overflow horizontally. The developer toolbar itself extends
beyond the narrow viewport; this is not evidence about the production host.

`game/src/hunt-flow.test.ts` renders the same HUNT panel/workspace with projections
from real scenario states and calls the actual validator/reducer. It covers zero,
insufficient and sufficient evidence, duplicate indices, retired generations,
real hits/misses and exhausted attempts, per-reader completed status, sudoku
tag reuse and RPS pending predictions. The worksheet does not compute Sudoku
solutions or expose the validator's eligibility result. Existing `pi-reuse.test.ts`
checks that repeated groups which do not pin a unique solution remain rejected;
`rps.test.ts` checks every private first opening is redacted until settlement.
Schema 5 adds `lastHunt.points` for the actual attack delta including the score
floor. Schemas 1–4 migrate without inventing missing historical deltas; old
results display their known outcome and say the score change was not recorded.
The only new target projection data is the reader's own completed attack types;
no recovered secret, solution, key, or private opponent opening is added.

Readiness is a UI preparation rule for Shamir/Caesar; it does not replace the
trusted validator. Sudoku worksheets use only repeated public tags and displayed
reveals. Participants compare those with the public puzzle and wait for more
evidence if they cannot determine a solution; the UI never runs a Sudoku solver.
Review follow-up: a dedicated headless browser on port 5674 confirmed the
`pi-reuse` worksheet opens from “材料を確認して解く”, shows the two public boards,
and does not announce a solution count or a passed eligibility check. This was
a headless local check, not an unlocked-Mac or deployed-Portal verification.

Not performed: AWS deployment, production event play, independent human playtest,
full keyboard-only completion, or screen-reader audit. These remain optional
pre-event rehearsals, not conditions for the local development fix.
