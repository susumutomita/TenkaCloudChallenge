# Detect a second vote without a name

> An independent, unofficial companion to Advanced Cryptography Program 2026.
> No affiliation or endorsement. Direct questions to TenkaCloud.

Week 6 / order 655 / difficulty 3 / 200 points / draft / approximately 30–45 minutes.

An election accepts one vote per person. Follow the spent marker called a nullifier,
then process six requests to see why verification must precede recording the marker.
The last step asks you to construct a collision in the deliberately tiny model.

## Participant route

1. Start in the Portal. Paste Inspect assignments from `p =` through `attempts =` into
   `python3`, calculate row 1's marker, and submit it to `label`.
2. Follow the seven teaching rows. Alternatively, use the Portal editor: replace each
   row's `return None` with its whole published block and return the final expression.
   Run public tests to see your calculated values.
3. For the last row, choose a different secret producing the same marker. Submit the
   number directly or implement `collision` yourself. Copying the seven published
   blocks leaves this construction unfinished.

The free bilingual statement supplies the terms, rules and one-digit example. Each
field has three optional hints: mechanism, example, then steps using the on-screen
names. Each costs 2 points, totaling 48; a wrong answer costs 10 points.

| Field | What to investigate | Points |
| --- | --- | ---: |
| label | Calculate a spent marker | 25 |
| repeat | Keep the marker stable when the vote changes | 25 |
| scopes | Separate election numbers | 25 |
| accept | Verify, match election, check freshness, then record | 25 |
| count | Count accepted records, not incoming requests | 25 |
| message | Observe the flawed vote-dependent marker | 25 |
| unchecked | Locate false acceptances when verification is skipped | 25 |
| collision | Construct a different secret with the same toy marker | 25 |

## Arithmetic model and boundaries

The example uses p=7, secret=2 and election scope=1. The toy formula is
(secret squared + scope) remainder by p, giving 5. p is 5 or 7 and the secret is
1 through p−1. The full observer input, including the secret, is visible. The model
has easy collisions and provides no anonymity. It does not implement a cryptographic
hash, membership proof, ZK verification or concurrent voting service.

The `verified` flag represents an already checked practice request. Actual proof
verification must bind eligibility, marker, election and message; a user-provided
boolean would not establish any of those. Request order and spent-state changes here
are a sequential arithmetic exercise. Different toy scopes can also collide; this
small formula does not establish real unlinkability.

Only the verifier receives `FLAG_SEED` and generates deployment values. The participant
image contains public tests, starter and Portal API, with no generator, reference or
hidden checks. Public deployment tags bind prepared submissions to a run, without
serving as authentication. Only the separate verifier decides correctness. Learner
processes receive a prefetched public snapshot, without verifier URLs or a binding
tag. Linux seccomp denies network and process-FD access paths, including in executed
children; the supervisor is non-dumpable. The CLI uses the same restriction and
denies supervisor signals and resource-limit changes. Remaining learner descendants
are terminated when an API run finishes. Execution fails if the filter cannot be installed.

Workbench port 18167 is bound to 127.0.0.1; the verifier stays internal. Both services
run non-root with read-only filesystems and resource limits. Local Docker owners can
inspect their own images; the exercise protects no real election or secret.

## Local verification and teardown

Run from this problem directory:

```bash
make inspect
make test              # the unfilled starter is expected to fail
make test-one ID=label
make verifier-down
```

The CLI streams your edited starter to Docker, requiring no host Python or shared
filesystem path. Inspect/test retain the verifier between runs; finish with
`make verifier-down`. No cloud resources are created. Local CPU and memory stay in
use until containers are stopped.

For authors, run `make reference-test` for mutations, the actual public-test route,
state-update checks and submission boundaries. Also run repository `make install`
and `make agent-gate`. Live AWS and human event playtests are optional and unrun.

The application composition accompanies the [pinned Week 6 stack-design theme](https://github.com/zk-tokyo/advanced-cryptography-2026/blob/bdbc913fa7fd4ed87ce7f0de6b1d73fb41e49732/week6/README.md).
It is not a copy of a course assignment. The conceptual reference is the
[official Semaphore proof documentation](https://js.semaphore.pse.dev/functions/_semaphore_protocol_proof.generateProof.html):
a real nullifier depends on identity secret and election scope, and is used to detect
repeated signaling. The small squared formula here is only a teaching substitute.
