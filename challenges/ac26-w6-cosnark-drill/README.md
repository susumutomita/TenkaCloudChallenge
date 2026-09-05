# Multiply shared secrets together

> An independent, unofficial companion to Advanced Cryptography Program 2026.
> No affiliation or endorsement. Direct questions to TenkaCloud.

Week 6 / order 605 / difficulty 3 / 200 points / 40–60 minutes / draft.

Two people split addition and multiplication without collecting the original numbers.
Read your values in Inspect evidence, try the fourteen visible rows, and complete eight
answer fields. This isolates arithmetic used in jointly generating a proof (co-SNARK);
it is not a complete proof-generation protocol.

## Participant route

1. Start the problem in the Portal and paste the Inspect assignments into `python3`.
2. Run the statement's rows in order. Submit your computed values where an answer field exists.
3. Without Python, use the editor. Replace `return None` with that row's whole code block,
   prefixing its final expression with `return`. Preceding names are supplied. Complete
   functions in order and Run public tests to see your own values.

You observe both people. Person 0 holds `w0[0],w1[0]`; person 1 holds `w0[1],w1[1]`.
Observer reconstructions of w, A, B and the full preparation values a, b are separate
from each person's actual knowledge. The exchanged values are only the remainders of
`A_sh[i]−a_sh[i]` and `B_sh[i]−b_sh[i]`.

| Answer field | Observation | Points |
| --- | --- | ---: |
| shares | Distribute the shares | 20 |
| ashares | Compute A locally | 25 |
| aopen | Compare shared and direct calculations | 20 |
| bshares | Compute B with the other coefficients | 25 |
| crossmul | Identify the two missing cross terms | 30 |
| beaveropen | Open d,e from difference shares | 25 |
| cshares | Use d,e to build product shares | 30 |
| csum | Recover product C | 25 |

Each checkpoint has three hints: mechanism, one-digit example, then steps using your
own values. Each costs 2 points, totaling 48; a wrong answer costs 10. Required formulas
are also in the free statement.

## Fixtures and boundaries

Only the verifier receives `FLAG_SEED`. It reproducibly generates each deployment's
numbers. The modulus excludes the pinned course's 97, 101 and 89. Individual small
numbers may overlap course examples, and a computed result may happen to equal an input.

Masks use the full range 0 through p−1. Zero, equal factors, and masks equal to the
secret are allowed. Draws are not retried to force the two multiplication results to
differ: that would condition the mask distribution on the secret. The share-wise product
is not a general method, although it happens to agree when the missing terms sum to
remainder zero. The one-digit worked example directly demonstrates disagreement.

This is a local observer exercise and protects no real secrets. The participant image
contains only the starter, public tests and Portal API. Fixture generation and grading
live in the separate verifier; reference code and mutations are author-only. Workbench
receives no fixture seed. A public one-way deployment tag binds prepared submissions to
this deployment; it is not authentication, and only the verifier decides correctness.

Only Workbench port 18163 is published on 127.0.0.1. The verifier stays on the internal
network. Both services run non-root with read-only filesystems and capability, memory
and PID limits. This does not provide secrecy from the person who controls Docker or
establish a competition trust boundary.

## Local verification and teardown

```bash
make inspect
make test              # expected to fail with the unfilled starter
make test-one ID=shares
make verifier-down     # stop the retained verifier and network when finished
```

Inspect and test deliberately leave the verifier running between calls. Run
`make verifier-down` at the end. No cloud resources are created; local CPU and memory
are used, and the verifier remains active until stopped.

## Author verification

`make reference-test` rejects 24 faulty implementations/submissions and checks copying
both languages' visible rows into the real starter, all mask residues, seed non-forwarding,
and rejection of a submission from another deployment. Also run repository `make install`
and `make agent-gate`. An independent junior-high-role first read caught real allocation,
procedure and vocabulary gaps that were corrected. Live events and further third-party
rehearsals are optional.

The arithmetic scope follows the [pinned co-snark-prove assignment](https://github.com/zk-tokyo/advanced-cryptography-2026/blob/bdbc913fa7fd4ed87ce7f0de6b1d73fb41e49732/week6/problems/co-snark-prove/README.md): shared linear forms and their product.
