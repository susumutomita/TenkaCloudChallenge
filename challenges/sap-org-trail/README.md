# sap-org-trail

**SAP-C02 · flag · difficulty 4 · $0**

## Story

Kato-san set up Organizations with 50 accounts, each with its own CloudTrail.
CTO Sasaki-san needs everything centralized in one S3 bucket, with new accounts
automatically covered. The player identifies Organization Trail.

## What gets deployed

| Resource | Type | Cost |
|---|---|---|
| `/{NamePrefix}/briefing` | SSM String Parameter (scenario) | Free |
| `{NamePrefix}-participant-viewer` | IAM Role | Free |

**$0**.

## Solution (operator notes)

**Organization Trail**: created in the management account with `IsOrganizationTrail=true`.
Automatically covers all current and future member accounts.
All logs go to one S3 bucket.

**Exact flag:** `TC{organization-trail}`

## Scoring

- Correct: +200 pt
- Wrong answer penalty: -20 pt
- Hint 1 (−20 pt): points to the "scope" option in trail creation (Apply to organization)
- Hint 2 (−40 pt): reveals "organization-trail" and submission format

## Learning goals

1. Understand that Organization Trail auto-covers all member accounts from the management account
2. Distinguish per-account trails from Organization Trails
3. Know the Organizations + CloudTrail centralized logging pattern
