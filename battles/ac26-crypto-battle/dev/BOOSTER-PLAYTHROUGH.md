# Endgame hint support: local evidence

Issue #659 §9, booster only. Higher cipher rungs, lightning and #740's balancing
choices remain open. No shared environment or AWS resource was changed.

## Repeatable standard-timing screen

Run `bun install && PORT=5678 bun run dev` in this directory, open the local
harness, and choose **終盤のヒント支援 — 通常90分設定で残り10分**.
This scenario runs the real reducer with the standard 90-minute configuration.
Bravo has answered existing FHE/MPC Orders through real operations before the
60-minute boundary; alpha is the lowest team. It does not assign a score or
invent a saved game state.

On 2026-09-06, a dedicated headless local agent-browser session showed:

1. At minute 60, alpha's selected Order displayed **ヒントの減点なし · 残り 9:58**
   (the browser's elapsed countdown had started), **次は減点なし**, and the hint
   button **次のヒントを開く（減点なし）**. The clicked first rung opened.
2. The visible +5m clock control twice reached minute 70. The notice changed to
   **ヒントの減点なし期間は終了しました** and the next hint displayed **−2 点**.
   The ordinary button was **次のヒントを開く（-2）**. The match still had time left.
3. Screenshots were visually inspected: `/private/tmp/booster659-standard-active.png`
   and `/private/tmp/booster659-expired.png`.

A separate run used the existing short `fresh` scenario: at minute 18 its
25-minute match truncates the support to seven minutes. A displayed FHE Order
showed `(31,30)` and `(92,10)`, modulus 97. After a hint was opened without a
penalty, the manually computed `(26,40)` was submitted via the real button and
accepted for **+30**, current score **30**. Reloading and opening a hint on the
next Order retained score 30 and **減点なし · 下に表示されています**. This also
checked that a later change in ranking does not withdraw the saved allocation.
Screenshot: `/private/tmp/booster659-fhe-success.png`.

## Automated evidence and limits

`game/src/booster.test.ts` exercises the real host's tick → validate → apply
path, all three hint levels with a positive score, exact expiry and a stale
zero-price submission, unchanged Order deadlines, shifted starts, solo/tied
rosters, delayed tick equivalence, RPS settlement, schema-5 compact reservations
through migration and subsequent openings, and JSON checkpoint restoration.
Actual component rendering and projection guards cover a locally aged expiry,
missing older-server data and malformed new data.

The full game suite also retains the existing state-size, no-catch-up penalty,
rotation, expiry, migration and score classification checks. The local harness
clock was intentionally advanced; this is not a wall-clock novice reading test,
real unlocked-Mac confirmation, AWS persistence/concurrency test or evidence
that #740's competitive balance is solved. A browser cannot prove the lack of a
penalty while its score is zero; positive-score deduction is asserted by the
host tests and the separate 30-point UI run above.

## Integration after #747

Rebased onto main `640dae5`. The full game suite passed 621 tests and the dev
suite passed 52 tests; both TypeScript checks and all 116 catalog entries passed.
In the same dedicated local harness, the CIPHER choice focused the existing
input, the expiry warning remained present, and opening all three hint steps
showed **このお題のヒント（すべて開いた）**. The partial answer `2 3` remained
through hint updates and opening/closing the diagram dialog with Escape.
At clock 70:00, after the projection refreshed, the notice showed the end of the
support period and the next hint returned to **−2 点**. This checks the real
StatusPanel components in the dev harness; it does not repeat the parent-frame,
physical-device or AWS checks.
