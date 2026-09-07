# Computing with a cover — then testing its limits

> This is an independent, unofficial companion to the Advanced Cryptography Program
> 2026, without affiliation or endorsement. The problem text and implementation are
> independently authored. Questions belong in TenkaCloud, not with course operators.

Track `advanced-cryptography-2026`, order 12, difficulty 1, 20–30 minutes, 100 points.

## Participant route

Start the problem and press **Inspect evidence**. Calculate on paper or with the
optional `unknown_x_drill.py` editor; no terminal setup is required. Submit the
covered pair first and check for solved. The eight answer fields follow the same
experiment: cover, add, compare with a large cover, account for the cover, recover,
count candidates under a separate remainder rule, observe a difference leak, and
analyze the expanded product.

The Japanese and English statements give the required formulas and small worked
examples. Each field has three hints: mechanism, example, and actions named after
the actual screen controls. Hint penalties total 28 points; a wrong answer costs 5.
The final ungraded extension replaces the shared cover with distinct covers u/v
and asks what changes in the sum, difference, and product.

The optional public tests first check a published small example, then print the
learner's results on the current public inputs. That output does not grade those
results. All eight checkpoints grade manual values; no checkpoint grades the
source file or credits a public-test PASS.

| Checkpoint | Points | Grading evidence |
|---|---:|---|
| covered | 10 | Ordered pair of covered numbers |
| sum-covered | 10 | Their integer sum |
| huge | 15 | Difference of the two expressions with the large cover |
| held | 10 | Returned sum and total cover, in that order |
| recover | 10 | Original sum after removing both covers |
| guesses | 15 | Candidate count in the full remainder range |
| gap | 15 | Signed difference of the covered values |
| product | 15 | Product, terms excluding x², and their difference |

The candidate experiment explicitly permits both candidates over `0..n−1`; it is
not a secrecy proof for the generator's narrow integer ranges. Counting compatible
candidates differs from an equal-probability claim. The product experiment shows
that the addition correction `2*x` cannot be reused unchanged: removing x² alone
also leaves `(a+b)*x`. This is not a multiplication impossibility result or a
derivation of bootstrapping. Some answers coincide across experiments, so the text
does not promise that every other learner's numerical answer will fail.

## Runtime and authority

Compose builds a participant Workbench and a separate unpublished verifier. Only
the verifier image contains `fixtures/` and the expected-value derivation;
`reference/` and `mutation.py` are author-stage additions. The verifier receives
the per-run `FLAG_SEED` and serves only the public inputs through `/public`.

The Workbench receives no fixture seed in its container environment, including
PID 1 and healthcheck processes. Before listening, its Python supervisor protects
its process and fetches a derived signing key and a public-input snapshot from
fixed internal routes. The key is never returned through the public APIs. The
existing `tcw1` submission format binds a value to its checkpoint and run; the
verifier still checks the value itself. Raw, altered, cross-checkpoint, and
cross-run sealed submissions are rejected. Tuple entries must be exact integers,
not fractions truncated into an answer.

Learner processes launched by **Run public tests** receive only public data. The
pinned Linux image supplies libseccomp; its filter blocks network access and
reading or disrupting the protected supervisor. A failed restriction aborts the
learner run. The launcher closes inherited descriptors and kills its process
group after completion or timeout. This is an additional process restriction,
not a claim to sandbox arbitrary programs against every kernel attack.

Local execution remains self-paced practice for the person who controls Docker.
That person can inspect verifier images and alter the stack; this setup is not an
exam, ranking, or certification authority against its administrator. Direct CLI
runs outside the Workbench launcher do not receive its process restrictions.

Only the Workbench publishes a host port, `127.0.0.1:18140`; the verifier has no host
port. Both run non-root with read-only root filesystems, dropped capabilities,
no-new-privileges, and bounded memory/PIDs/CPU. No AWS resources or cloud account
are required. Local Docker CPU, memory, images, and disk remain in use until the
operator stops the project or removes its images.

## Author verification and teardown

From this problem directory, with an author-only synthetic `FLAG_SEED`:

```sh
make reference-test
make test
make inspect
make verifier-down
```

`reference-test` runs the existing 25 mutations plus bootstrap, exact-answer, and
Linux process-boundary tests in the author image. `test` and `inspect` use the
unpublished verifier for public inputs. The starter intentionally fails until
filled in. To exercise the live Workbench boundary tests, set
`UNKNOWN_X_WORKBENCH_URL` to the dedicated loopback URL and run
`local/tests/hidden/test_isolation.py`; the seed probe returns booleans only.

At the repository root, `make install && make agent-gate` validates the catalog;
it does not exercise HTTP or prove the runtime boundary. Recorded reader findings,
source basis, and participant acceptance are in
[local/tests/hidden/READER.md](local/tests/hidden/READER.md). Stop only the Compose
project used for the exercise; `make verifier-down` targets this problem's default
project. No release, cloud deployment, or shared-environment action is needed.
