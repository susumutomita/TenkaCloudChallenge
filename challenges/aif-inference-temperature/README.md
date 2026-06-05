# aif-inference-temperature

**Certification:** AI Practitioner (AIF-C01) · **Kind:** `flag` · **Difficulty:** 1 · **Cost:** $0

## Story

One month into TenkaCloud Inc.'s AI team. The QA team can't write automated tests for Kato-san's LLM contract review tool because the same input produces different output every run. The player must identify the inference parameter to lower toward 0 to achieve deterministic, reproducible output.

## What gets deployed

One SSM String parameter (`/{NamePrefix}/briefing`) describing the non-determinism problem with three candidate inference parameters (top-p, max-tokens, temperature), plus the ParticipantViewerRole. No EC2, NAT Gateway, or LLM invocations — free tier only.

## Solution (operator notes)

**Temperature** is the primary inference parameter controlling LLM output randomness. At temperature ≈ 0, the highest-probability token is chosen greedily on every step, producing near-identical output for identical input. Top-p also affects randomness but is secondary. Max Tokens controls output length only.

```bash
aws ssm get-parameter \
  --name "/{NamePrefix}/briefing" \
  --query Parameter.Value --output text
```

**Flag:** `TC{temperature}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+150 pt** (once per deploy).
- Wrong answer: **−15 pt** each (anti-brute-force); score clamps at 0.
- Two progressive hints (−20 / −40).

## Learning goals

- Understand that Temperature is the primary inference parameter controlling LLM output randomness.
- Confirm that Temperature near 0 produces deterministic output; Temperature near 1 produces creative/diverse output.
- Distinguish Temperature from Top-p and Max Tokens.
