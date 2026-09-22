# Operator-controlled reversible faults

This is an operator-driven problem, not a platform `effect` or SSM disruption. Read [OPERATOR.md](../OPERATOR.md) before use. No cloud actions run from this repository or CI.

| Round | Only target changed | Recovery / revert |
| --- | --- | --- |
| gateway | Reserved EIP association, then this VPC’s IGW attachment | Attach the same IGW; checker restores only this EIP to its fixed ENI |
| route | Default route in this subnet’s route table | Create/replace 0.0.0.0/0 to the same IGW |
| role | Profile attached to this EC2 | Reattach the prepared profile; team proves a fresh Session Manager session and check command |
| http | TCP80 ingress in this security group | Restore TCP80 while retaining the fixed TCP8080 observation rule |

Start requires a healthy baseline and the preceding explanation. DynamoDB compare-and-swap serializes transitions. A partial apply becomes restoring, never a new round. The watchdog runs every minute, starts recovery after the ten-minute deadline, and uses a 180-second lease longer than the 120-second Lambda timeout. Repeated events cannot restore concurrently. Failed AWS operations remain visible and retry after the lease; emergency restore uses the same state machine. Recovery success moves to review, never awards retrospective points.

The participant role cannot invoke the fault function, write the state table, detach gateways, launch replacement instances or create gateways. Mutations target this stack’s IDs, PassRole the exact EC2 role. The timer and public URL are removed before the deletion hook terminates the instance and removes owned gateways.

Before an event, test all four mutations and both recovery paths using two real teams, including an API failure, delayed propagation, overlapping invocations, and deletion during an active fault. Check logs and actual resource state; a Lambda HTTP200 does not mean its payload succeeded. Real-AWS rehearsal is not yet performed. Local tests cover state/authority/request contracts and injected AWS observations only.

For the role round, an existing session may remain alive while credentials propagate. Confirm the profile is absent, then require a new post-repair session. Inspect [Default Host Management Configuration](https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-instance-permissions.html) during rehearsal: it can provide an alternate management path without an instance profile. Do not disable shared account settings from the problem.
