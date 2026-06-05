# dva-lambda-env-plaintext-secret · DVA · flag · difficulty 2 · $0

## Story

Kato-san, the predecessor SRE who abruptly quit, left a Lambda function with a
sensitive value encoded (not encrypted) in an environment variable called
`SECRET_CONFIG`. The new SRE (you) must read the function configuration,
base64-decode the value, and demonstrate why this is a security anti-pattern.

## What gets deployed

| Resource | Notes |
|---|---|
| `AWS::Lambda::Function` | `${NamePrefix}-secret-fn`, nodejs20.x, inline handler, **never invoked** |
| `AWS::IAM::Role` (exec) | Minimal: CloudWatch Logs only |
| `AWS::IAM::Role` (viewer) | ParticipantViewerRole with `lambda:GetFunction*` + `lambda:ListFunctions` |
| `AWS::SSM::Parameter` | `/${NamePrefix}/briefing` |

## Solution

```bash
# List functions to find the name
aws lambda list-functions --query "Functions[?starts_with(FunctionName, 'tc-dva')].FunctionName"

# Get the environment variable
aws lambda get-function-configuration \
  --function-name <NamePrefix>-secret-fn \
  --query 'Environment.Variables.SECRET_CONFIG' \
  --output text | base64 -d
```

**Flag:** `TC{use-secrets-manager}`

The encoded value `VEN7dXNlLXNlY3JldHMtbWFuYWdlcn0=` decodes to the flag.

## Scoring

- Correct: +200 pt
- Wrong: -15 pt each (anti-brute-force)
- Hint 1: -20 pt (how to read env vars)
- Hint 2: -40 pt (decoding approach)

## Learning goals

- Lambda environment variables are readable by anyone with `GetFunctionConfiguration` -- not a safe secrets store
- AWS Secrets Manager / SSM Parameter Store SecureString provide encrypted, audited, rotation-capable storage
- `base64` is encoding, not encryption -- it provides zero confidentiality
