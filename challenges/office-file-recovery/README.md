# Recover the handover note — S3 versions

[日本語](README.ja.md) · [Scope #887](https://github.com/susumutomita/TenkaCloudChallenge/issues/887)

The meeting room note was overwritten incorrectly. Inspect its earlier versions and restore the correct note.

This is an optional Challenge selected by the host, not automatically added to the first Gate/Battle event. Rotate operator, reader, explainer and verifier across four teammates.

## Play and scoring

Use Open AWS Console in the portal with your team's role, then open GameUrl. The board shows the exact bucket/key, steps, success condition and three free hints. Finish the real AWS check and explanation to receive one passphrase. Submit it for 100 points; a wrong portal passphrase costs 5. Board attempts and hints are free. Handoff codes carry progress, not scoring flags; share only within the team.

Earlier versions remain and the new current version contains the correct note. The checker reads all four public access blocks and the actual current object. Recovery additionally checks versioning and retained history. Merely opening an older version cannot repair the current object. The checker does not audit each download; reading the file on a teammate's device remains a team verification task.

## Resources, permissions and cost

Each team's AWS account receives one private versioned S3 bucket with SSE-S3 (AES256), a mission Lambda, a data lifecycle Lambda, one-day logs and IAM roles. No customer-managed KMS key is created. Participants may list only their bucket and read/write handover.txt. They cannot change public-access settings/policies, delete history, or read checker code. ExternalId is required.

Storage (including earlier versions), S3 requests, Lambda, logs and transfer can incur charges. Start with Tokyo ap-northeast-1 and about ten minutes; the host checks current regional pricing and whole-event costs. No zero-cost promise.

Delete the deployment through the admin console. The lifecycle hook removes every object version and delete marker before bucket deletion. Partial delete errors report FAILED; inspect logs and retry. Confirm removal of the bucket, functions, logs and roles, and clear progress on shared devices.

## Verification

Shared implementation and tests: [aws-intro](../../runtimes/aws-intro/README.md). Run `make build && make test` here, and `make install && make agent-gate` at catalog root. Family tests cover current-object comparisons, wrong-current-version rejection, public access blocks, history, cleanup errors and deployed-Lambda parity using SDK fixtures.

`make preview` is loopback-only, visibly labelled, and cannot pass AWS checks without explicit fixture data. It does not operate or score real AWS. Console permissions, upload/recovery, teardown and official scoring remain optional pre-event AWS rehearsals.
