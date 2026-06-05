# dva-lambda-iam-overprivilege · DVA · flag · difficulty 3 · $0

## Story

Kato-san left a Lambda function whose execution role grants `dynamodb:*` on `*`,
even though the function description explicitly says it only performs a single
DynamoDB GetItem. The new SRE (you) must identify the single least-privilege
Action the function actually needs.

## What gets deployed

| Resource | Notes |
|---|---|
| `AWS::IAM::Role` (exec) | `${NamePrefix}-overprivileged-exec` with `dynamodb:*` on `*` inline policy |
| `AWS::Lambda::Function` | `${NamePrefix}-overprivilege-fn`, description says "only performs a single DynamoDB GetItem", **never invoked** |
| `AWS::IAM::Role` (viewer) | ParticipantViewerRole with `iam:GetRole/GetRolePolicy/ListRolePolicies` + `lambda:GetFunction*` |
| `AWS::SSM::Parameter` | `/${NamePrefix}/briefing` |

## Solution

```bash
# Find the execution role name
aws lambda get-function-configuration \
  --function-name <NamePrefix>-overprivilege-fn \
  --query 'Role'

# List inline policies on the role
aws iam list-role-policies --role-name <NamePrefix>-overprivileged-exec

# Read the policy -- shows dynamodb:* on *
aws iam get-role-policy \
  --role-name <NamePrefix>-overprivileged-exec \
  --policy-name OverprivilegedDynamoPolicy

# Read the function description
aws lambda get-function-configuration \
  --function-name <NamePrefix>-overprivilege-fn \
  --query 'Description'
```

**Flag:** `TC{dynamodb:GetItem}`

The description says "only performs a single DynamoDB GetItem" -- that is the one correct Action.

## Scoring

- Correct: +200 pt
- Wrong: -20 pt each (anti-brute-force)
- Hint 1: -25 pt (how to read the role policy)
- Hint 2: -50 pt (points directly to GetItem)

## Learning goals

- IAM least-privilege principle: grant only the Actions actually used
- Reading Lambda execution role inline policies via `aws iam get-role-policy`
- Cross-referencing function purpose with IAM grant to detect over-privilege
