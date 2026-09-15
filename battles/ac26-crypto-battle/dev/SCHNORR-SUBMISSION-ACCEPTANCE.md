# Schnorr submission feedback — Issue #882

Verified on 2026-09-15 using the real Portal components and reducer in the local
development preview, based on catalog commit `af39b5a5`. No AWS event or official
score storage was used.

## Reproduce

1. Follow [the preview setup](README.md), then select the current-pacing scenario
   (`streaming`), seat `alpha`, locale `ja`, with the clock paused.
2. Open the first Order and its Schnorr proof. Leave `a` empty, then enter `0`.
3. Press the first calculation button, edit the value, and use the displayed
   `r` and power table to calculate the correct remainder.
4. After receiving `e`, use the displayed formula to calculate and submit `z`.
5. Repeat with seat `bravo` and locale `en`.

## Observed results

| Action | Result |
| --- | --- |
| Leave `a` empty | Button disabled. |
| Enter incorrect `0` or `22` | Button enabled; no correctness message before pressing. |
| Press with incorrect `0` | Recalculation message appears in the selected language; input remains editable and the proof stays at step 1. |
| Edit the incorrect value | Previous correctness message disappears. |
| Enter `23`, `-1`, `1.5`, or `abc` | Button disabled with the integer-range instruction. |
| Enter the calculated `a` and press | Step 2 displays the verifier's `e`. |
| Enter `0` as `z` | Final submission is enabled, independently of correctness. |
| Submit the calculated `z` | Order completes once and the local score becomes 30, in both Japanese and English runs. |

Inputs were calculated from the visible participant formula/table. No state was
injected to advance the proof. Source review confirms that the first mismatch
returns before storage or `onSubmit`; the operation shapes still contain only
the public commitment/response values, never the private `x` or `r`. Existing
server-side proof verification and scoring are unchanged.

The paused preview's client countdown continues visually between projections;
this exercise verifies input handling and reducer results, not live expiry timing.
