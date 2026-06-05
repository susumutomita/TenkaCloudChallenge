# soa-cost-allocation-tag-count

**SOA-C02 · flag · difficulty 2 · $0 free-tier**

## Story

Kato-san created three SSM Parameters but only tagged two of them with `CostCenter`. The accounting team needs the count for cost allocation reporting. The player checks each parameter's tags and counts only those with the `CostCenter` key.

## What gets deployed

| Resource | Detail |
|----------|--------|
| `AWS::SSM::Parameter` | `/{NamePrefix}/app-a` — String, tagged `CostCenter=frontend` |
| `AWS::SSM::Parameter` | `/{NamePrefix}/app-b` — String, tagged `CostCenter=backend` |
| `AWS::SSM::Parameter` | `/{NamePrefix}/app-c` — String, **no CostCenter tag** |
| `AWS::SSM::Parameter` | `/{NamePrefix}/briefing` — task description |
| `AWS::IAM::Role` | `ParticipantViewerRole` with SSM read + `ListTagsForResource` on `/{NamePrefix}/*`, CloudShell |

No EC2. Cost: **$0**.

## Solution

The flag is **`TC{2}`**.

CLI verification:
```bash
for name in app-a app-b app-c; do
  echo -n "/${NamePrefix}/${name}: "
  aws ssm list-tags-for-resource \
    --resource-type Parameter \
    --resource-id "/<NamePrefix>/${name}" \
    --query 'TagList[?Key==`CostCenter`].Value' --output text
done
# app-a: frontend
# app-b: backend
# app-c: (empty)
```

Two parameters (app-a, app-b) carry a CostCenter tag; app-c does not.

## Scoring

- Correct: +200 pt
- Wrong: -15 pt per attempt

## Learning goals

- Check SSM Parameter tags using `aws ssm list-tags-for-resource`
- Understand Cost Allocation Tags: tagged resources appear as line items in Cost Explorer reports
- Identify untagged resources as coverage gaps in cost attribution
