# SCORING.md — TenkaCloudChallenge scoring regulation

> Audience: anyone (human or AI agent) authoring or editing a problem. This is the
> competition ruleset for **points, hint penalties, and wrong-answer penalties**.
> The rules for Challenges are **enforced by `bun run validate`** (AGENT.md §14);
> breaking them fails CI.

The catalog is a competition. If two problems of the same difficulty are worth wildly
different points, or one problem's hints are free while another's cost half the score, the
leaderboard stops meaning anything. This document unifies scoring so difficulty — not the
author's mood — decides the reward, and so hints are a real, costed trade-off.

## Scope

- **Challenges with a fixed point total** (`scoring.kind` = `flag` / `verify` / `multi-flag`
  / `multi-verify`) follow this regulation in full, and the validator enforces it.
- **Battles** (`uptime-flat` / `uptime-multi` / `phased-polling` / `attack-detection`) are
  scored continuously from uptime / phases / attack counters — there is no single fixed
  total, so the tier point table does not apply. Battle hints still follow the *spirit* of
  the 50 % rule (see "Battles" below), but are not validator-enforced.

## 1. Difficulty tiers → points

`difficulty` (1–5, see SCHEMA.json) maps to three tiers, and each tier has **one** point
value. Same tier ⇒ same points.

| Tier | `difficulty` | Base points | `wrongAnswerPenalty` (5 % of base) |
| --- | --- | --- | --- |
| **Easy** | 1–2 (入門 / 初級) | **100** | **5** |
| **Medium** | 3 (中級) | **200** | **10** |
| **Hard** | 4–5 (上級 / エキスパート) | **300** | **15** |

- The problem's total is exactly the tier value. For `flag` / `verify` that is
  `scoring.points`. For `multi-flag` / `multi-verify` it is the **sum** of
  `flags[].points` / `checks[].points`.
- `wrongAnswerPenalty` is a flat **5 % of the base** (Easy 5 / Medium 10 / Hard 15). For
  multi-checkpoint kinds, each checkpoint's `wrongAnswerPenalty` should be 5 % of that
  checkpoint's points (rounded), and stays small so a competitor can probe without being
  wiped out.

## 2. Hint penalties — opening every hint costs at most 50 %

Hints are a costed trade-off, not a free walkthrough. **The sum of every hint penalty in a
problem must not exceed 50 % of the base points.** A competitor who opens all hints can
still earn at least half; a competitor who opens none earns full marks.

Distribute the penalty progressively — an early nudge is cheap, the near-answer is
expensive. Recommended splits (as a fraction of base points, summing to 50 %):

| # hints | Split (% of base) |
| --- | --- |
| 1 | 50 |
| 2 | 20 / 30 |
| 3 | 10 / 15 / 25 |
| 4 | 5 / 10 / 15 / 20 |

In points, per tier:

| # hints | Easy (100) | Medium (200) | Hard (300) |
| --- | --- | --- | --- |
| 2 | 20 / 30 | 40 / 60 | 60 / 90 |
| 3 | 10 / 15 / 25 | 20 / 30 / 50 | 30 / 45 / 75 |

For multi-checkpoint problems, the ceiling applies to **all hint penalties across all
checkpoints combined** (≤ 50 % of the problem total), not per checkpoint.

The hard rule the validator enforces is the **ceiling** (`sum ≤ 50 %`); the progressive
split above is the recommended shape. A free opening nudge (`penalty: 0`) is allowed as
long as the total still reaches for — and never exceeds — 50 %.

## 3. Worked examples

- **Easy `verify`, 2 hints** — `points: 100`, `wrongAnswerPenalty: 5`,
  `hints[].penalty: [20, 30]`. Open both hints ⇒ lose 50, keep 50.
- **Medium `flag`, 3 hints** — `points: 200`, `wrongAnswerPenalty: 10`,
  `hints[].penalty: [20, 30, 50]`. Open all ⇒ lose 100, keep 100.
- **Medium `multi-verify`, 3 checkpoints** — `checks[].points: [60, 70, 70]` (sum 200);
  hint penalties across all checkpoints sum to ≤ 100.

## 4. Battles

Battles have no fixed total, so:

- Do **not** set a tier `points` value; they score from uptime / phases / attack counters.
- Keep hints meaningful but not crushing: progressive penalties, and avoid a single hint
  that erases a large share of a typical round's score. Treat "≈ half of what a mid-pack
  team earns in a round" as the informal ceiling for opening every hint.

## 5. Enforcement

`scripts/validate-problems.ts` (`checkScoringRegulation`) checks every **Challenge** with a
determinable point total:

- total points == the difficulty tier's base (Easy 100 / Medium 200 / Hard 300);
- flat `wrongAnswerPenalty` == the tier's 5 % value;
- sum of all hint penalties ≤ 50 % of the total.

Battles (no fixed total) are skipped. When you change a problem's difficulty, update its
points to the new tier — the validator will remind you if you forget.

## 6. Changing the regulation

The tier values and the 50 % ceiling are deliberately simple so the leaderboard stays
legible. If you want to change them (e.g. a steeper Hard tier for a tournament), change the
table here **and** `checkScoringRegulation` in one PR, and re-score every affected problem
in the same PR so the catalog never drifts from the regulation.
