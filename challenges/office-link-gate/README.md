# Office Link Preparation — AWS Intro Challenge

[日本語](README.ja.md) · [Parent scope #884](https://github.com/susumutomita/TenkaCloudChallenge/issues/884)

Engineers from different offices meet at one venue to learn AWS and get to know each other. Four teammates bring one real EC2 server online: **launch → attach an internet gateway → add a route → connect with Session Manager → allow HTTP**. The page program is supplied; beginners operate AWS rather than write code. Rotate operator, diagram reader, explainer and verifier after each mission.

Open the portal's **AWS Console**, then **GameUrl**. The board shows one mission, exact resource IDs, console links, a small diagram, observable success and three free hints. Each real operation check is followed by a short explanation question. Only all five completed missions issue **one final 100-point flag**. A wrong portal flag costs 5 points; board attempts and hints are free.

## Gate and scope

Use only `office-link-gate` and `office-link-battle` in the first event. Enable the platform's existing Progression Gate (default OFF), select this Challenge as the Gate, Battle as the sole unlock target, `required` policy, zero extra bonus and inherited team settings. Check the participant view before the event. The platform unlocks on a first positive score, so this Challenge deliberately issues no intermediate flags. This is team completion, not proof of every individual's understanding.

Preparation is tracked by #886, the [real AWS recovery Battle](../../battles/office-link-battle/README.md) by #892, and the host integration by #893. S3 and other extension Challenges are optional, not added to the first event automatically.

## AWS resources and isolation

Each team needs a **separate competition AWS account**. The stack creates a VPC, subnet, route table, security group, fixed network interface, reserved public IPv4 address, launch template, Session Manager instance profile, two Lambdas and one-day logs. The student launches one `t3.micro` with an 8 GiB `gp3` root volume from the prepared template. The fixed primary network interface prevents a second simultaneous instance. The student creates the IGW; after attachment is verified, the board associates only this lab's reserved address. AWS cannot detach an IGW while public addresses remain attached, so the initial network starts without a public address association.

The checker verifies exact stack identities, running state, EC2 status checks, VPC/subnet association, actual outbound HTTPS, the team's Session Manager session plus a server marker, and HTTP reachability with the required ingress rules. Port 8080 is a fixed observation endpoint; the student adds only port 80. Neither contains secrets.

Read-only EC2 list APIs are account/Region-wide because those APIs do not support resource-level scoping. Mutations are resource/tag-scoped. The participant cannot modify checker code, read its environment, retrieve stack outputs, assign arbitrary roles, or modify launch templates. ExternalId remains mandatory. Access, progress-signing and final scoring secrets are separate. Signed progress can be handed to a teammate; browser edits cannot advance it.

The family runtime is [`../../runtimes/aws-intro`](../../runtimes/aws-intro), shared unchanged with the S3, Lambda, logs, DynamoDB, SQS and CloudWatch extension Challenges. `build.py` packages exactly that source and this problem's `workshop.json` into `template.yaml`.

## Cost and teardown

Default rehearsal Region: Tokyo (`ap-northeast-1`). Allow **about 40 minutes**, including AWS propagation and discussion. Budget separately for a subsequent Battle. EC2, EBS, public IPv4, Lambda invocations/execution, logs and data transfer can incur charges. No NAT Gateway, RDS, Secrets Manager secret or customer-managed KMS key is added. Public IPv4 is charged even before the student finishes; zero cost is not promised.

Delete the deployment through the admin console. Its CloudFormation cleanup hook disassociates the lab address, terminates only the tagged instance attached to the fixed lab interface, waits for termination, and removes only this lab's IGWs before the stack network is deleted. A cleanup failure reports FAILED; investigate its logs and retry deletion. Confirm no EC2, volumes, IPv4 allocation, IGW, Lambda or log groups remain. Clear progress on shared browsers. Begin each event with fresh deployments; redeploying changed code is not a learner reset.

## Verification

```sh
make build
make test
python3 -m venv /tmp/aws-intro-tests
/tmp/aws-intro-tests/bin/pip install -r ../../runtimes/aws-intro/requirements-test.txt
/tmp/aws-intro-tests/bin/python -m unittest discover -s ../../runtimes/aws-intro/tests -v
/tmp/aws-intro-tests/bin/cfn-lint template.yaml
make preview
```

`make preview` binds localhost only and explicitly labels fixture observations. Without `--fixture-file`, AWS checks do not pass. It proves UI behavior, not real AWS permissions, provisioning, costs, Gate scoring or connectivity. See [VALIDATION.md](VALIDATION.md) for evidence and the optional pre-event AWS rehearsal. At catalog root also run `make install && make agent-gate`.

CFN lint reports W2010 for capability URL/final flag outputs: these are the existing platform's output contract, not proof that NoEcho hides outputs. The participant role cannot read CloudFormation outputs; the portal redacts the declared scoring output. Verify that boundary during rehearsal.
