# Friday Night Patch — Contain It, Fix It, Keep It Up

> TenkaCloud Challenge · `challenges/wp2shell-friday-night-patch` · difficulty 4 · ~75 min · `multi-flag` scoring (7 flags, 300 pts)

The **live AWS incident** half of a training pair with
[`wp2shell-local-lab`](../wp2shell-local-lab/) (the safe local rehearsal). Same two root
causes, same simulator app — but this time it is deployed for real on API Gateway + Lambda
behind a WAFv2 WebACL, and the business has one hard requirement: **the site does not go
down while you respond.**

## Story

17:30 on a Friday. Monitoring flags suspicious REST API traffic against Example Co's
production WordPress-like site. The evidence shows exactly what you rehearsed safely in
`wp2shell-local-lab`: an unauthenticated batch-request bypass chained into a
string-concatenated SQL query. The intruder left three things behind — a benign
persistence marker, a rogue administrator, and a modified theme file. The WAF rule that
would have caught this is currently set to `Count` (detect/log only) — it has not blocked
anything.

Your job: investigate, contain immediately, patch the root cause, clean up, rotate
credentials, and prove all of it — without ever taking the site offline.

## What gets deployed

| Resource | Role |
| --- | --- |
| **`RestApi`** (API Gateway, REGIONAL) | The public "production site" — a `{proxy+}` route to `AppFunction`. |
| **`AppFunction`** (Lambda, Python) | The whole app: the mock REST surface (same batch-routing + query-construction logic as `wp2shell-local-lab`, ported to Python + SQLite), the CloudFormation evidence-seeding custom resource, and the `grade` action every checkpoint's flag is earned through. |
| **`WafWebAcl`** (WAFv2, REGIONAL) | One rule (`SqliMatchStatement` + a `/wp-json/batch/v1` path match) currently set to `Count`. Associated with the API stage. |
| **`EvidenceBucket`** (private S3, versioned) | Seeded at deploy with `incident-log.json` — the timeline, the exact suspicious request, and the findings. |
| SSM config/data (`/<prefix>/config/*`, `/<prefix>/data/*`, `/<prefix>/site/*`) | Every setting this incident touches: the two root-cause toggles, the salt version, the rogue-admin / persistence-marker flags, and the tampered theme file content. All **existing** parameters — you overwrite them, you never create a new one. |
| **`ParticipantViewerRole`** | Read the evidence; read/write every `/<prefix>/*` parameter; `wafv2:GetWebACL` + `wafv2:UpdateWebACL` scoped to this stack's own WebACL; `lambda:InvokeFunction` scoped to `AppFunction` (to grade checkpoints). No `cloudformation:DescribeStacks`, no `lambda:GetFunction*` — every flag stays earned, never readable directly. |

No EC2, no VPC, no NAT, no ALB. Lambda + API Gateway + WAFv2 + S3 + SSM only — the same
low/near-zero-cost shape as `x402-paywall`.

## Checkpoints (multi-flag)

| Checkpoint | What it proves | Points |
| --- | --- | ---: |
| `timeline-iocs` | You reconstructed the incident from the evidence bundle. | 45 |
| `waf-containment` | The WAF rule is `Block`, verified by **replaying the exact attack** against the live endpoint and getting 403. | 45 |
| `patched-workload` | Both root-cause settings hold, verified by a **direct replay that bypasses WAF entirely** — the code fix, independent of containment. | 45 |
| `persistence-removal` | The rogue admin, the persistence marker, and the modified file are all cleared — checked live. | 40 |
| `credential-rotation` | The key was actually rotated: the old token evidence shows the intruder had no longer authenticates. | 40 |
| `evidence-preservation` | The original evidence object is still intact — you did not destroy it while cleaning up. | 40 |
| `uptime-and-legit-traffic` | The index, the normal post feed, and a legitimate authenticated request all still return 200, live. | 45 |

Every flag except `timeline-iocs` is earned by invoking `AppFunction` with
`{"action":"grade","check":"<id>"}` — the Lambda only echoes that checkpoint's flag once it
has re-verified the live condition (a real replay against the real endpoint, or a real read
of current parameter state). A superficial fix — flipping a setting without the underlying
behavior actually changing, or a URI-only block — never earns credit here, because grading
always exercises the real path, not the setting's face value.

## How to solve

Everything below runs from AWS CloudShell (already has your stack's credentials). Replace
`<prefix>` with your team's NamePrefix.

1. **Investigate.** `aws s3 cp s3://<EvidenceBucketName>/incident-log.json .` — read the
   timeline, the suspicious request, and the findings. The `audit_token` field is the
   `timeline-iocs` flag.
2. **Contain immediately (zero downtime).**
   ```bash
   aws wafv2 get-web-acl --scope REGIONAL --name <WebAclName> --id <WebAclId> > acl.json
   # edit acl.json: change the one rule's Action from {"Count":{}} to {"Block":{}}
   aws wafv2 update-web-acl --scope REGIONAL --name <WebAclName> --id <WebAclId> \
     --lock-token <LockToken from acl.json> --default-action Allow={} \
     --rules file://rules.json --visibility-config ...
   ```
3. **Patch the root cause (settings only, zero downtime).**
   ```bash
   aws ssm put-parameter --name /<prefix>/config/route-isolation --value true --overwrite
   aws ssm put-parameter --name /<prefix>/config/parameterized-queries --value true --overwrite
   ```
4. **Clean up.**
   ```bash
   aws ssm put-parameter --name /<prefix>/data/rogue-admin-present --value false --overwrite
   aws ssm put-parameter --name /<prefix>/data/persistence-marker-present --value false --overwrite
   aws ssm put-parameter --name /<prefix>/site/theme-functions --overwrite \
     --value "$(aws cloudformation describe-stacks ... ThemeFunctionsBaseline)"
   ```
5. **Rotate.** `aws ssm put-parameter --name /<prefix>/config/salt-version --value 1 --overwrite`
6. **Grade each checkpoint.**
   ```bash
   aws lambda invoke --function-name <AppFunctionName> --cli-binary-format raw-in-base64-out \
     --payload '{"action":"grade","check":"waf-containment"}' out.json && cat out.json
   ```
   `{"ready": true, "flag": "TC{...}"}` — submit that flag. Repeat per checkpoint.

## Why order matters (but is not enforced)

Nothing stops you from rotating first or cleaning up first — every checkpoint just checks
current live state, independent of the others. But **WAF containment costs nothing and
takes seconds**, while the root-cause fix and cleanup take longer to verify are genuinely
correct — so doing containment first is both the safer real-world instinct and the fastest
points here.

## Cost

Lambda + API Gateway + WAFv2 + S3 + SSM Standard parameters only — no EC2, no RDS, no ALB,
no NAT Gateway. All of these are pay-per-use with a free tier; a normal ~75-minute session
costs a few cents at most, and idle time between requests costs nothing. `delete-stack`
removes every resource this template created (the WebACL association, the WebACL itself,
the API, the Lambda, the evidence bucket, and every SSM parameter).

## Physical impact if you deploy this problem

CREATE only: `AWS::ApiGateway::RestApi` + `Resource` + `Method` (x2) + `Deployment` +
`Stage`, `AWS::Lambda::Function` + `Permission`, `AWS::WAFv2::WebACL` +
`WebACLAssociation`, `AWS::S3::Bucket`, seven `AWS::SSM::Parameter`, `AWS::IAM::Role` (x2),
one `AWS::CloudFormation::CustomResource`. Nothing is REPLACEd or DELETEd by a normal
playthrough — every "fix" is `ssm:PutParameter` on an existing parameter or
`wafv2:UpdateWebACL` on the existing WebACL. `delete-stack` is a clean DELETE of everything
above.

## Learning goals

- Flipping a WAF rule from `Count` to `Block` is a zero-downtime, immediate-containment
  lever — separate from, and faster than, the root-cause fix.
- Root-cause remediation, containment, and cleanup are three independent jobs with
  different urgency and different verification.
- Credential rotation and evidence preservation are required steps, not optional extras.
- A full incident response can be completed purely through settings changes (`ssm
  put-parameter`, `wafv2 update-web-acl`) while honoring a "never take the site down"
  requirement.

## Related files

- `template.yaml` — the whole stack: API Gateway, the app/grader Lambda, the WAFv2 WebACL,
  the evidence bucket, every SSM parameter, and the participant IAM role.
- `metadata.json` — catalog entry, seven-flag scoring, per-flag hints.
- `scripts/wp2shell-friday-night-patch.test.ts` (repo root) — cross-checks the template's
  Outputs against `metadata.json`'s `flagOutputKey`s, the IAM baseline, and the resource
  tagging invariant.

## What was verified offline vs. what needs one-time live AWS verification

The full Lambda application logic (the batch-routing bug, the SQL-construction flaw, both
fixes, the grading logic for all seven checkpoints, and the CloudFormation custom-resource
evidence seeding) was executed and verified directly with a mocked `boto3` in place of real
AWS calls — every checkpoint flips from not-ready to ready exactly when it should, and
fails closed when a live network call is unreachable (see the PR body for the transcript).
What could **not** be verified without a real AWS account and cannot be simulated offline:

- That AWS WAF's `SqliMatchStatement` genuinely recognizes the exact payload this problem
  plants as SQL-injection-shaped (this is standard WAF behavior for a classic `UNION
  SELECT` + quote breakout, but it has not been exercised against a real WebACL).
- That the API Gateway `{proxy+}` + `AWS_PROXY` Lambda integration deploys and routes
  correctly end to end (the resource tree is a well-established CFn pattern, but was not
  synthesized against a live account).
- That `wafv2:UpdateWebACL` truly succeeds for the participant role with only
  `wafv2:GetWebACL` + `wafv2:UpdateWebACL` scoped to the specific WebACL ARN (no
  `wafv2:GetWebACLForResource`), since that action was not exercised live.

A maintainer with AWS access should do one `make deploy`-equivalent test deploy and walk
the full solve path before flipping `status` to `ready`.
