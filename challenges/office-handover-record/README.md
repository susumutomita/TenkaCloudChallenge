# Keep a team handover record — DynamoDB basics

An optional difficulty-1, 100-point AWS Challenge for a four-person team. It is independent of the first event’s core EC2 preparation Gate and recovery Battle. Use it when the host selects this topic; do not add all extras to a 60-minute beginner event.

## Participant route

Create one named on-demand table → insert a waiting handover → explain its key → teammate updates it to done → explain why the same key matters.

Use the portal’s AWS Console sign-in, then GameUrl. The operator swaps between missions; teammates read the diagram, explain the next step and verify the result. Checks and three-step hints are free. Only the final completion passphrase scores: 100 points, 5-point penalty for an incorrect portal submission. No intermediate positive score unlocks a Gate early.

## Components and authority

One participant-created DynamoDB table, checker and cleanup Lambdas, one-day log groups, scoped roles and a capability-protected URL.

The unchanged [family runtime](../../runtimes/aws-intro/README.md) is embedded in this problem’s generated template. Participant operations target fixed problem resources; no grader environment, scoring secret, arbitrary role or cross-team data mutation is allowed. ExternalId is required for the participant role. Metadata/list APIs without resource-level scope may show inventory within the same account; isolated competitor accounts remain the recommended boundary. Learners cannot redeploy the stack.

DescribeTable checks the key, active state and on-demand mode. Consistent GetItem checks the same handover first as waiting and then as done. This does not audit an individual’s read action; teammates confirm reading together.

Progress is signed per problem and deployment. The private GameUrl and handoff code are shared only inside the team. The final flag is a declared scorer output, redacted by the platform. CloudFormation NoEcho does not hide Outputs; participants are not granted stack-output reads.

## Cost and teardown

Default rehearsal Region: ap-northeast-1. Allow 10–15 minutes for this optional topic plus deployment and observation delays. AWS usage is billed to the host; no zero-cost guarantee. Chargeable resources are listed above, including API requests, Lambda, logs and data transfer. Do not choose customer-managed KMS keys, extra indexes, provisioned capacity, detailed EC2 monitoring or notifications. The provided permissions constrain resource names, not an account-wide spend limit; a host still monitors usage.

Delete through the platform after the event. CloudFormation deletes its managed resources, and a dedicated cleanup function deletes the exact participant-created table, queue or alarm when this topic uses one. DynamoDB table deletion is awaited. Lambda-only topics require no data cleanup hook. Confirm stack deletion and inventory; retained or failed resources continue billing.

## Local verification

```sh
make build
make test
python3 -m unittest discover -s ../../runtimes/aws-intro/tests -v
python3 preview.py --port 5685
```

Install the family’s requirements-test.txt to run SDK contract tests. The preview has an explicit fixture banner and never operates AWS. Tests compile the deployed handler, exercise positive and negative AWS observations, verify final-only scoring and cleanup boundaries. Real AWS deployment, console role permissions, propagation delays, billing and cleanup are optional pre-event rehearsals and have not been performed for this change.
