# aif-bedrock-rag-knowledge-base

**Certification:** AI Practitioner (AIF-C01) · **Kind:** `flag` · **Difficulty:** 2 · **Cost:** $0

## Story

Two months in at TenkaCloud Inc., the player has joined the AI team. The ask: let an LLM answer questions based on the company's private manuals and incident reports — without retraining the model. Which Amazon Bedrock feature provides this?

## What gets deployed

One SSM String parameter (`/{NamePrefix}/briefing`) with the detailed requirement and four candidate Bedrock features (fine-tuning, agents, guardrails, knowledge-bases), plus the ParticipantViewerRole. No EC2, NAT Gateway, or actual Bedrock resources — free tier only.

## Solution (operator notes)

The requirement is to ground LLM answers in private documents without retraining. This is the RAG (Retrieval-Augmented Generation) pattern. Amazon Bedrock **Knowledge Bases** provides this: it ingests documents into a vector store, retrieves relevant passages at query time, and appends them to the prompt.

Decoy analysis:
- Fine-tuning: changes model weights, requires retraining — ruled out
- Agents: orchestrates multi-step tasks — not document retrieval
- Guardrails: filters harmful content — not document retrieval

```bash
aws ssm get-parameter \
  --name "/{NamePrefix}/briefing" \
  --query Parameter.Value --output text
```

**Flag:** `TC{knowledge-bases}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+175 pt** (once per deploy).
- Wrong answer: **−15 pt** each (anti-brute-force); score clamps at 0.
- Two progressive hints (−20 / −40).

## Learning goals

- Understand how RAG grounds LLM responses in private documents without retraining.
- Confirm that Amazon Bedrock Knowledge Bases is the managed RAG implementation.
- Distinguish Knowledge Bases from Fine-tuning, Agents, and Guardrails.
