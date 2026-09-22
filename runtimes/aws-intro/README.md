# AWS introductory mission runtime

One shared runtime packages real AWS observations, signed sequential progress, bilingual mission UI and CloudFormation lifecycle hooks. Consumers:

- `challenges/office-link-gate`: EC2/network/Session Manager/HTTP preparation.
- `challenges/office-file-delivery`: S3 upload and team handover.
- `challenges/office-file-recovery`: S3 previous-version recovery.
- `challenges/office-lambda-delivery`: execute a supplied Lambda and hand over its receipt.
- `challenges/office-log-investigation`: correlate an execution with its actual log.
- `challenges/office-handover-record`: create, read and update a DynamoDB handover.
- `challenges/office-job-queue`: create, send, receive and delete using SQS.
- `challenges/office-server-watch`: configure a CPU alarm for a prepared EC2.

Each consumer owns its `workshop.json`, metadata, generated `template.yaml`, README and small packaging wrapper. `build.py` embeds this exact implementation; participant static assets never include answers, signing secrets or flags. The final flag appears only after the AWS operation and explanation stages all pass. Handoff receipts are scoped to the problem and per-deployment secret. AWS errors are distinct from ordinary not-ready observations.

## Checks

From this directory:

```sh
python3 -m venv /tmp/aws-intro-tests
/tmp/aws-intro-tests/bin/pip install -r requirements-test.txt
/tmp/aws-intro-tests/bin/python -m unittest discover -s tests -v
node --check web.js
```

Regenerate every consumer with its `make build` and run its `make test`. Run `cfn-lint` on every generated template. W2010 on the private capability URL and final scoring output documents the existing platform output contract: NoEcho does not hide Outputs. Participants are not granted CloudFormation output reads; the portal redacts the declared scoring output. Do not suppress the warning or claim it proves secrecy.

Tests use injected clients and SDK Stubber, without AWS credentials. They cover boundaries and deployment-source parity, not real AWS permissions, connectivity or teardown. Preview explicitly displays its fixture boundary. A fresh-account pre-event rehearsal should include one incorrect operation, a correct full route, handoff, portal score/Gate behavior and teardown.

The seven extra topics are independently selectable. The first event uses only the core EC2 Gate and final recovery Battle. The separate `battles/office-link-battle` composes the same EC2 checks and template with its own fault controller and state machine; see its runbook for operator authority and recovery.

Session permissions follow the [AWS Session Manager end-user policy](https://docs.aws.amazon.com/systems-manager/latest/userguide/getting-started-restrict-access-quickstart.html): start on owned instances, and open/resume/end only sessions matching the caller’s user ID. The server uses [AL2023 system Python](https://docs.aws.amazon.com/linux/al2023/ug/python.html) so its page can start before internet routing exists.
