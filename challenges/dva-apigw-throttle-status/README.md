# dva-apigw-throttle-status · DVA · flag · difficulty 2 · $0

## Story

Kato-san configured an API Gateway Usage Plan with a throttle limit that is too
low. A mobile client exceeds the rate limit and gets error responses. The new
SRE (you) must identify the HTTP status code API Gateway returns for throttled
requests.

## What gets deployed

| Resource | Notes |
|---|---|
| `AWS::SSM::Parameter` | `/${NamePrefix}/briefing` with scenario text |
| `AWS::IAM::Role` (viewer) | ParticipantViewerRole with SSM read permissions |

No API Gateway or Lambda deployed -- this is a spec-knowledge scenario.

## Solution

API Gateway returns **HTTP 429 Too Many Requests** when a Usage Plan rate or
burst limit is exceeded (RFC 6585).

**Flag:** `TC{429}`

CLI verify:
```bash
aws ssm get-parameter --name "/<NamePrefix>/briefing" --query 'Parameter.Value' --output text
```

## Scoring

- Correct: +150 pt
- Wrong: -15 pt each (anti-brute-force)
- Hint 1: -20 pt (RFC 6585 direction)
- Hint 2: -40 pt (reveals 429)

## Learning goals

- API Gateway throttling returns 429 (not 400, 403, or 503)
- Distinction between throttle (429) and auth error (403) and bad request (400)
- SDK retry-on-429 behavior and exponential backoff
