# aif-bedrock-guardrails

**Certification:** AI Practitioner (AIF-C01) · **Kind:** `flag` · **Difficulty:** 2 · **Cost:** $0

## Story

Two weeks into the AI team at TenkaCloud Inc. The compliance department flags two problems with Kato-san's LLM chatbot: user PII passes straight to the model, and harmful output is not filtered. The player must identify the Bedrock feature that handles both input and output filtering.

## What gets deployed

One SSM String parameter (`/{NamePrefix}/briefing`) describing both the input (PII) and output (harmful content) filtering requirements with four candidate Bedrock features as decoys, plus the ParticipantViewerRole. No EC2, NAT Gateway, or actual Bedrock resources — free tier only.

## Solution (operator notes)

The requirement is to filter both LLM input (PII detection/masking) and LLM output (harmful content blocking). **Amazon Bedrock Guardrails** is the only feature that intercepts both.

Decoy analysis:
- Knowledge Bases: retrieves documents for RAG — not content filtering
- Agents: orchestrates multi-step tasks — not content filtering
- Fine-tuning: changes model weights to adjust behavior — cannot guarantee blocking per-request

```bash
aws ssm get-parameter \
  --name "/{NamePrefix}/briefing" \
  --query Parameter.Value --output text
```

**Flag:** `TC{guardrails}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+175 pt** (once per deploy).
- Wrong answer: **−15 pt** each (anti-brute-force); score clamps at 0.
- Two progressive hints (−20 / −40).

## Learning goals

- Understand that Amazon Bedrock Guardrails provides PII detection and harmful-content filtering for LLM input and output.
- Explain why LLM applications should configure Guardrails as part of responsible AI practices.
- Distinguish the purpose of Guardrails, Knowledge Bases, Agents, and Fine-tuning.
