# Delivered Twice, Arrived Out of Order

> TenkaCloud Challenge · difficulty 3 · 45–60 min · local Docker · multi-verify (6 checkpoints, 200 points)

An EventBridge-like order consumer charges a duplicate `PaymentCaptured` twice, accepts a
late `OrderCreated` as the newest state, silently overwrites a same-version collision, and
drops a delivery after retry exhaustion. This lab turns those failures into an explicit,
deterministic delivery state machine. It uses synthetic events only: no AWS account,
credential, production data, or outbound network.

## Architecture and trust boundary

```text
Browser Workbench (participant image, :18120)
  -> inspect vulnerable synthetic stream
  -> edit delivery-policy JSON
  -> call public-test / prepare over loopback CORS

Verifier image (:18121, separate internal network)
  -> public cases and submission encoder
  -> hidden permutations, mutations, and per-checkpoint /verify
```

Both containers are non-root, read-only, stripped of Linux capabilities, and attached to
separate Docker networks. Host ports bind to `127.0.0.1`; a seccomp profile also
denies outbound `connect`, `sendto`, `sendmsg`, and `sendmmsg`. The participant image contains
the Workbench, starter policy, and state-machine primitive, but not the reference policy,
public expectations, hidden grader, or `/verify` implementation.

## Delivery model

The policy separates seven decisions:

1. observations from the vulnerable run;
2. source event identity and the atomic side-effect ledger;
3. aggregate version monotonicity and version gaps;
4. canonical-payload conflict detection;
5. a bounded retry budget with deterministic backoff metadata;
6. a complete, replayable DLQ receipt;
7. deterministic persistence across a second replay.

The six scoring checkpoints are independent. A partial repair earns only the checkpoints it
satisfies. Hidden tests include positive, negative, shuffled, malformed, retry-exhausted, and
mutation cases. A constant answer, timestamp sort, event-ID-only policy, or version-only policy
cannot pass them all.

AWS EventBridge retries retriable target-delivery failures according to the configured policy;
the documented default is up to 24 hours and 185 attempts with exponential backoff and jitter.
After exhaustion an event is dropped unless a DLQ is configured. EventBridge target DLQs are
standard SQS queues and carry failure attributes such as error code, exhausted condition, and
retry attempts. See the AWS documentation for [retry policy](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-retry-policy.html),
[DLQs](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html), and
[delivery monitoring](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-monitoring-events-best-practices.html).
The lab compresses time and uses deterministic backoff (no jitter) so grading is reproducible;
it does not emulate the AWS service.

## Run and clean up

    docker compose -f challenges/eventbridge-delivery-discipline/local/docker-compose.yml up --build

Open `http://127.0.0.1:18120/`, inspect the vulnerable stream, repair the policy, run the public
tests, and prepare the value for Participant Portal.

    docker compose -f challenges/eventbridge-delivery-discipline/local/docker-compose.yml down --volumes --remove-orphans

Estimated cost is USD 0. Cloud CREATE / UPDATE / REPLACE / DELETE operations are all none.
Only disposable local containers, images, and Docker networks are created.

## Playtest status

Automated and agent-operated local flows are recorded by CI and the implementing pull request.
A human learner playtest is not claimed unless a person completes and records the full flow.
