# dva-cognito-identity-pool · DVA · flag · difficulty 2 · $0

## Story

Kato-san's mobile app design stops at Cognito User Pool (authentication only).
The new SRE (you) must identify the additional Cognito component needed to
exchange the authenticated identity for temporary AWS credentials so the mobile
SDK can call S3 directly.

## What gets deployed

| Resource | Notes |
|---|---|
| `AWS::SSM::Parameter` | `/${NamePrefix}/briefing` with scenario text |
| `AWS::IAM::Role` (viewer) | ParticipantViewerRole with SSM read permissions |

No Cognito pool deployed -- spec-knowledge scenario.

## Solution

**Cognito Identity Pool** (Federated Identities) issues STS temporary credentials
via `AssumeRoleWithWebIdentity`. User Pool provides authentication tokens;
Identity Pool exchanges them for AWS credentials.

**Flag:** `TC{identity-pool}`

## Scoring

- Correct: +150 pt
- Wrong: -15 pt each (anti-brute-force)
- Hint 1: -20 pt (distinction between User Pool and Identity Pool)
- Hint 2: -40 pt (reveals identity-pool)

## Learning goals

- Cognito User Pool = authentication (tokens); Identity Pool = AWS credential issuance (STS)
- Mobile apps access AWS services directly via Identity Pool without a backend proxy
- Web Identity Federation: Identity Pool wraps `sts:AssumeRoleWithWebIdentity`
