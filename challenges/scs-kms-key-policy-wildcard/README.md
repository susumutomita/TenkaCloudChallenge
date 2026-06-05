# scs-kms-key-policy-wildcard

**Certification:** Security Specialty (SCS-C02) · **Kind:** `flag` · **Difficulty:** 4 · **Cost:** $0

## Story

One month at TenkaCloud Inc. CTO Sasaki-san sends a security review request. Kato-san stored a KMS key policy in SSM — one Statement grants `kms:Decrypt` to a suspiciously broad Principal. Which value makes the key world-decryptable?

## What gets deployed

Two SSM Parameters (String type, free):

| Parameter | Contents |
| --- | --- |
| `/${NamePrefix}/key-policy` | KMS key policy JSON with two Statements: one normal admin grant, one `kms:Decrypt` to `Principal: "*"` |
| `/${NamePrefix}/briefing` | Task description |

No KMS CMK is deployed (costs ~$1/month). The policy JSON is delivered as data.

## Solution (operator notes)

Read the key policy from SSM. The `WorldOpenDecrypt` Statement has `"Principal": "*"` — a wildcard that allows anyone (including outside the account) to call `kms:Decrypt`.

```bash
aws ssm get-parameter \
  --name /<NamePrefix>/key-policy \
  --query Parameter.Value \
  --output text | python3 -m json.tool
```

**Flag:** `TC{wildcard-principal}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+200 pt**.
- Wrong answer: **−15 pt** each; score clamps at 0.
- Two progressive hints (−20 / −40).

## Learning goals

- Understand that `Principal: "*"` in a KMS key policy grants world-open access.
- Read the Statement structure (Sid / Effect / Principal / Action / Resource) of a KMS key policy.
- Retrieve and parse JSON from an SSM Parameter via CLI.
