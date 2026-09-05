# Find an incorrect approval in a calculation trace

> An independent, unofficial companion to Advanced Cryptography Program 2026.
> No affiliation or endorsement. Direct questions to TenkaCloud.

Week 6 / order 635 / difficulty 3 / 200 points / draft.

A discount calculator approves totals at or below a limit. Its storage wraps after
addition, so its stored total can differ from the ordinary sum. Follow a three-addition
trace, identify an incorrect approval, and check whether a reported claim answers the
request. Start by adding the three numbers in Inspect evidence.

## Participant route

1. Start the problem in the Portal. Paste Inspect evidence assignments into `python3`.
2. Run row 1's `sum(discounts)`. Submit the result in `exact` for the first verdict.
3. Continue rows 2–7. Without a Python terminal, use the Portal editor: replace
   each function's `return None` with its row's whole code block, prefixing the final
   expression with `return`. Run public tests to see your calculated values.
4. For row 8, construct your own three-number input that only the other program
   improperly accepts. Submit it directly or implement `binding` yourself. Copying
   the seven supplied blocks leaves this construction unfinished. Any valid input passes.

The free statement defines the terms and supplies every needed calculation. Each field
has three optional hints: mechanism, one-digit example, and steps using your own screen's
names. Each hint costs 2 points, 48 in total. A wrong answer costs 10 points.

| Answer field | What to check | Points |
| --- | --- | ---: |
| exact | Ordinary sum | 25 |
| trace | Stored total after each addition | 25 |
| overflow | Which individual additions wrap | 25 |
| decision | Machine approval versus ordinary-sum approval | 25 |
| exploit | Approval despite exceeding the limit | 25 |
| predicate | Counterexamples to an incomplete condition | 25 |
| tamper | Whether reports match recomputation | 25 |
| binding | Construct an input distinguishing two programs | 25 |

## Model and boundaries

The visible one-digit example uses m=8, discounts=[7,2,1], limit=3: the ordinary sum
is 10, but the machine stores 7 → 1 → 2 and approves. Deployment inputs vary; m is 8
or 16 and each input is at most 15. This is an arithmetic model, not an implementation
of a zkVM or cryptographic proof verification. The last row changes a program’s limit
and asks the learner to construct a distinguishing input. All example inputs are visible.

Only the verifier receives `FLAG_SEED` and generates the deployment fixture. The
participant image contains the starter, public tests and Portal API; it contains no
fixture generator, reference solution or hidden checks. A public one-way deployment
tag binds prepared submissions to this deployment. It is not authentication; the
separate verifier decides correctness. The trusted Workbench fetches a public snapshot
once; learner processes receive only that snapshot, with no verifier URLs or submission
tag. Linux seccomp blocks socket creation, network transfers and descriptor-stealing
paths before learner code runs, including executed child processes. The supervisor
is non-dumpable. The CLI applies the same restriction and execution fails if the
filter cannot be installed.

Only Workbench port 18165 is published on 127.0.0.1. The verifier is internal. Both
services run non-root with read-only filesystems and capability, memory and PID limits.
The local exercise protects no real secret from the person controlling Docker.

## Local verification and teardown

Run these commands from this problem directory:

```bash
make inspect
make test              # expected to fail with the unfilled starter
make test-one ID=exact
make verifier-down
```

The local CLI streams your edited starter to Docker; it needs no host Python or shared
filesystem path. Inspect and test retain the verifier between calls; `make verifier-down` stops it and removes
the network. No cloud resources are created. Local CPU and memory remain in use until
the containers are stopped. Plan approximately 30–45 minutes for the full drill.

## Author verification

Run `make reference-test` for the reference, mutation and learning-contract checks.
They check both languages' seven published blocks in the real starter; those alone
must leave the final construction incomplete. They also check multiple valid and invalid
final inputs, per-addition overflow, case distinctions, malformed answers, seed
non-forwarding and deployment binding. Run repository `make install` and `make agent-gate` as well.
Live AWS events and third-party event rehearsals are optional and have not been run.

The scope follows the [pinned zkvm-exploit assignment](https://github.com/zk-tokyo/advanced-cryptography-2026/blob/bdbc913fa7fd4ed87ce7f0de6b1d73fb41e49732/week6/problems/zkvm-exploit/README.md).
The course uses u16 wrapping and a 1000-unit limit; this drill shrinks the arithmetic
and introduces claim checking before actual proof generation.
