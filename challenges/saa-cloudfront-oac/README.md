# saa-cloudfront-oac — SAA · flag · difficulty 2 · $0

## Story

Kato-san left an S3 bucket publicly accessible. CTO Sasaki-san needs it
locked down so only CloudFront can read it. The bucket policy now shows the
modern OAC pattern. The player must name the feature.

## What gets deployed

- S3 bucket `{NamePrefix}-content` — PublicAccessBlock all true, no objects
- Bucket policy — grants `s3:GetObject` to `cloudfront.amazonaws.com` service
  principal with `AWS:SourceArn` condition (placeholder distribution ARN)
- SSM Parameter `/{NamePrefix}/briefing` — task description with bucket name

Cost: **$0** (empty bucket + bucket policy are free; no CloudFront distribution deployed).

## Solution (operator notes)

The bucket policy uses the `cloudfront.amazonaws.com` service principal plus
an `AWS:SourceArn` condition — the canonical **OAC (Origin Access Control)**
pattern that replaced OAI in 2022.

**Flag:** `TC{origin-access-control}`

CLI verify:
```bash
aws s3api get-bucket-policy --bucket "${NAME_PREFIX}-content" | python3 -m json.tool
aws s3api get-public-access-block --bucket "${NAME_PREFIX}-content"
```

## Scoring

- Correct: +200 pt (once per deploy)
- Wrong answer: -15 pt (anti-brute-force)

## Learning goals

- OAC is the successor to OAI for restricting S3 access to CloudFront only
- Bucket policy uses `cloudfront.amazonaws.com` service principal + `AWS:SourceArn`
- `aws s3api get-bucket-policy` and `get-public-access-block` output interpretation
