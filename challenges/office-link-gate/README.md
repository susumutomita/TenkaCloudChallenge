# Office Link Preparation — a four-person learning Gate

[日本語](README.ja.md) · [GameDay](../office-link-gameday/README.md) · [60-minute host runbook](../office-link-gameday/OPERATOR.md)

Learn the concepts needed for GameDay: matching regions, granting only needed permissions, restoring an intact copy, and verifying the outcome. Four teammates explain, read the example, operate and check, rotating after each question. Open **GameUrl** in the portal and discuss the one question shown.

## Complete preparation before GameDay

The server verifies all four steps in sequence. **Only the last step issues one completion passphrase**, worth 100 points when submitted in the existing portal. There are no partial official points: the platform's existing first-score Gate rule cannot unlock GameDay halfway through learning.

Include only this problem and `office-link-gameday` in the event. Use the [Gate configuration](../office-link-gameday/event-gate.json). A TenantAdmin must enable Progression Gate in the event's Gate panel (default OFF), set policy to `required`, team overrides to inherit, and additional bonus to 0. One GameDay problem unlocks after preparation. Completed content remains reviewable. This is not proof that every individual understands; the host listens to all four explanations.

Workshop attempts and hints are free. An incorrect portal passphrase costs 5 points. The intermediate handoff code is progress, not a scoring passphrase. Open the same GameUrl on another device and import it to resume validated progress. Altered and foreign-team codes are rejected.

## Runtime and security

Existing AWS CloudFormation + `flag` scoring. Each team receives a 128MB Lambda, Function URL, one-day CloudWatch log group and IAM roles. `build.py` embeds the same handler and assets into `template.yaml`. Progress tokens use HMAC with a separate secret. Editing browser progress cannot skip server checks or obtain the flag.

The existing random-password injection generates independent access, progress-signing and scoring secrets. Metadata declares the scoring output for the existing participant-output redaction. Initial assets contain no secrets or scoring passphrases. Share GameUrl and handoff codes only within the team. The workshop cannot directly change official scores.

The execution role only writes its own logs. The participant role keeps standard sign-in/CloudShell permissions and ExternalId, without access to function code, environment variables or stack outputs. Requests and tokens are not logged.

## Cost, teardown and validation

Initial rehearsal region: Tokyo, `ap-northeast-1`. Allow about 20 minutes for preparation. Requests, execution, transfer and logs may incur charges, separately from platform and GameDay costs. No EC2, NAT, RDS, S3 bucket, Secrets Manager secret or customer-managed KMS key is created. Unauthorized requests still invoke Lambda; zero cost is not guaranteed.

Delete both problem deployments through the admin console afterwards and confirm removal of their functions, URLs, logs and roles. Clear browser data on shared devices. Live AWS scoring, Gate lock/unlock, teardown and beginner understanding remain pre-event rehearsal checks.

Run `make install` at catalog root, then `make build && make test` here with Python 3.12+ and the catalog's pinned Bun. `make preview` starts the same handler on localhost:5685. This preview covers learning and verdicts only; it does not provide official portal scores, event-level Gate enforcement or multiplayer ranking. Stop with Ctrl-C. Finish with `make agent-gate` at catalog root.
