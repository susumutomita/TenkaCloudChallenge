# Privacy audit: compare what was permitted with what was revealed

> Independent, unofficial companion to Advanced Cryptography Program 2026; not affiliated with or endorsed by the course operators. The implementation and examples here are original.

Seven implementations return the same correct weighted total. Four disclose something extra. Build an auditor, show how an extra partial sum reveals an input, and repair only the prohibited observations.

## Participant route

**Start → Inspect evidence → edit auditor.py → Run public tests → Submit a checkpoint.** All seven checkpoints submit the same source file; none needs typed JSON or a local terminal. Start with `allowed_opens` and submit it independently.

| Checkpoint | Function | Purpose |
|---|---|---|
| allowed-opens | allowed_opens | Sorted permitted names |
| opened-secret | first_violation | Extra opening |
| cross-party | first_violation | Reading another party's storage |
| log-leak | first_violation | Log and failure-message disclosure |
| transcript | derive_secret | Recover the private input |
| repair | repair | Remove only prohibited operations |
| mutation | first_violation | Follow the same rules after names and order change |

The statement and starter define every field and provide the required rules before paid hints. Each checkpoint has three hints: mechanism, small example or formula, then actions using the editor's actual names. Public tests include p=7 recovery and a short repair; private checks cover other seeded cases. A correct result in every checkpoint completes the problem. The total is 300 points; wrong submissions cost 15 points. Existing hint costs are unchanged.

## The mathematical connection

MPC means several parties compute together while keeping their inputs private. A share is a number produced by secret sharing; opening reconstructs and reveals a shared value. The auditor sees the resulting events, rather than implementing the sharing network.

Let T be a weighted total and S the extra sum excluding the last party. All arithmetic uses remainders after division by prime p:

```text
T = w0*x0 + w1*x1 + w2*x2
S = w0*x0 + w1*x1
T-S = w2*x2
x2 = ((T-S) * inverse(w2)) % p
```

An inverse u satisfies `w*u % p = 1`; it exists for `1 <= w < p`. With p=7, T=2, S=4, w=3, the difference is 5 and the inverse of 3 is 5, so the recovered input is `5*5 % 7 = 4`.

A final result deliberately discloses information. Privacy asks whether intermediate observations disclose anything beyond the agreed result, not whether the result tells anyone nothing. Permitted masked values rely on fresh, independent, uniformly selected masks unknown to the observer; the audit uses that declared assumption, rather than proving it.

## Course and owner-note inputs

The official [Week 2 toy-mpc assignment](https://github.com/zk-tokyo/advanced-cryptography-2026/blob/a3aa4b56fa88fbe803b57d320fbc87c1a203b480/week2/problems/toy-mpc/README.md) tests correct Beaver multiplication and the restriction to masked openings. The author's Week 2 notes connect that distinction to output leakage and an interactive disclosure audit. Both informed this problem's explanation; neither is a required separate screen during play. The repository's existing courseAlignment pins the published lecture and assignment; this change keeps that pin and draft status.

## Local verification

```bash
make test
make test-one ID=recovery-p7
make reference-test
make verifier-down
```

`make test` runs the published examples. `make reference-test` runs author-only mutation and Linux boundary tests. The participant image contains the starter and public tests; fixture generation, private checks and the reference stay in separate verifier/author images. See `local/tests/hidden/READER.md` for the exact participant-only reading and local evidence boundaries.

## Operations and cost

The Portal uses the existing Compose runtime, editor API and `/verify` contract. No new endpoint or scoring type is introduced. The Workbench is host-loopback only; its verifier is reachable only inside the isolated Compose network. This problem provisions no AWS resources. Local CPU and memory are used while containers run; there is no required AWS Region. Stop the problem in Portal or run `make verifier-down` for a local checkout.

## Verification scope

The parent process owns the mathematical and audit predicates. Submitted Python runs with a clean environment in a bounded Linux child, which receives function inputs and returns untrusted JSON values. Fresh request IDs reject preprinted replies, but do not attest that a native Python function return produced a value. A different implementation that computes the same correct values is acceptable. The parent never accepts the learner's own pass/fail message as grading authority.

This is an audit against an explicit specification and finite observed traces. It does not prove cryptographic security, randomness quality or all possible executions of a real MPC protocol. The deterministic fixture seed creates reproducible teaching data; the one-time-mask explanation describes the ideal assumption certified by `spec.masked`.

A person controlling Docker can inspect or change their own containers; these local checks do not conceal grading material from that administrator. Deployment authentication and competition authority belong to the parent platform.
