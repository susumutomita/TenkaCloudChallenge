# Split it, and still nobody knows

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 210 · **Chapter:** Week 2 / Additive Secret
Sharing · **Role:** `mechanism` · **Time:** 60–90 minutes · **Points:** 200
· **Status:** draft — see "Week 2 alignment" below

## Start and repair

You maintain the split of a confidential number among several holders. The starter
hands the entire secret to one person. Repair the sharing mechanism, demonstrate
why a missing share leaves multiple secrets compatible, and then let any two of
three holders reconstruct when one holder is unavailable.

1. **Start** in Participant Portal and select **Inspect evidence** on the same page.
2. Note `modulus p`, `parties n`, and the list under `party 0 through n-2`.
3. Edit the six functions in `sharing.py`; the statement and starter give all needed
   formulas with one-digit examples.
4. **Run public tests**, then **Submit** each code checkpoint using the current editor.
5. For `threshold`, enter the statement's JSON shape on one line using your p and n.
   Complete all five checkpoint verdicts. No terminal or second screen is needed.

## Mechanism and its assumptions

A share is one holder's piece. Numbers are remainders after division by prime p,
written `% p` in Python. Choose n−1 random values and append
`(secret - sum(first values)) % p`; add all shares and take `% p` to reconstruct.
For p=7, secret 4, random values [5,6], this gives [5,6,0] and reconstructs to 4.
A missing last share for any candidate is `(candidate - sum(partial)) % p`.

Every candidate fitting a partial list proves **compatibility**, not unchanged
probabilities by itself. The secrecy claim assumes independent uniform randomness
from all of 0..p−1, independent of the secret, fresh for each sharing. An observer
sees collected shares, not the missing holders' information or the randomness list.
Then the same partial observation has the same likelihood for every secret, leaving
its probabilities from before the observation unchanged. Zero draws are valid; a rule that always copies
the secret is different from a valid random draw that happens to contain zeros.

Refreshing adds a zero-total sharing. The exercise checks visible change on nonzero
adjustment inputs; general uniform randomness can leave the original values unchanged.
Shamir two-of-three uses `y=(secret+r*x) % p` at x=1,2,3 with **prime p>3** and
uniform independent r, including zero. Two points recover x=0 by the statement's
inverse procedure; one point has the same likelihood for each secret.

This is a component of MPC (several holders computing jointly without revealing
inputs), not a complete MPC, signature, or wallet protocol. Local addition,
multiplication, and the rules for revealing an output require further mechanisms.

## Scoring and feedback

| Checkpoint | Points | Participant outcome |
|---|---:|---|
| `share-and-reconstruct` | 50 | Use the supplied randomness; recover from all shares |
| `hides-the-secret` | 45 | Construct a missing share for any candidate secret |
| `threshold` | 45 | Give the required count and two compatible completions |
| `rerandomize` | 30 | Refresh by zero-total adjustments, preserving the secret |
| `two-of-three` | 30 | Recover from any pair, while one share hides the secret under the stated assumptions |

Wrong submissions cost 10 points. Each checkpoint has three hints: mechanism,
one-digit formula/example, then actions using the on-screen names. IDs, points,
and penalties are unchanged; opening all 15 hints costs 99 of 200 points.
Public tests check shapes and reconstruction; passing them does not prove privacy.
Submitting each checkpoint checks its required properties. A failed code checkpoint
returns property-level feedback so you can revise and resubmit.

## Week 2 sources and alignment

The rewrite was checked against the actual seminar
[`week2/problems/toy-mpc/README.md`](https://github.com/susumutomita/advanced-cryptography-2026/blob/main/week2/problems/toy-mpc/README.md)
and the owner's [Week 2 notes, slides 15–23](https://github.com/susumutomita/advanced-cryptography-note/blob/main/week2/index.html).
The seminar distinguishes sharing, local addition, multiplication, and revealing
outputs. The notes distinguish additive and Shamir sharing. This problem addresses
the sharing component only.

The catalog's historical `courseAlignment` placeholder still records that Week 2
material was absent at its pinned commit. Updating that pin and draft status is a
separate course-sync change; the current source reading is not a claim that the
historical pin already points to the published material.

## Execution and assurance scope

The Workbench carries the statement's starter and public tests. Fixtures, hidden
checks, and reference code remain in the unpublished verifier/author images.
Both Compose services run as non-root with `init: true`, read-only filesystems,
limited memory/PIDs, dropped capabilities, and no-new-privileges. Only the Workbench
port is published, on loopback. The existing prepare/manual `tcw1` envelope is unchanged.

The supervisors retain the deployment seed for public evidence and sealing. Submitted
Python is never imported into a supervisor. A separate Linux worker receives only
source and function arguments with a clean environment. Before executing it, the
problem-local seccomp filter denies file opens (including `/proc`), network and exec,
and access to the same-UID supervisor. `PR_SET_DUMPABLE=0` protects supervisors.
Values returned through JSON are untrusted; the original property comparisons run
in the trusted verifier. Reconstruction starts a different worker containing only
shares and the divisor, so storage by the splitting function does not transfer.

The total grading budget remains 12 seconds. Fixed fixture call sets are batched;
the bounded, file-backed value transcript allows 16 MiB for the exhaustive Shamir
checks. Success and timeout clean the worker's process group; Compose init reaps its
orphaned descendants. A zombie PID does not count as cleanup. Public syntax/import
or initialization failures show only `sharing.py`, a bounded line number, and an
allowlisted exception type. Hidden failures expose property-level or generic text,
never learner stdout, exception messages, expected results, or hidden inputs.

These are exercise boundaries, not a claim of formal security or a complete MPC
protocol. A person administering Docker still controls both containers and can inspect
their own verifier. Local mode is self-study; an externally administered verifier is
needed for ranking or certification ([#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271)).

## Cost and teardown

No AWS account or cloud resources are used. Docker uses local CPU and memory while
running. Stop the problem's own Compose project with `make verifier-down`; remove only
the corresponding local images when no longer needed. Do not use another event's stack.

## Local verification for authors

- `make test` runs the public checks against the starter through the Linux value
  boundary. The deliberately unfinished starter fails reconstruction; replace only
  your local editor input when practicing. `make test-one ID=...` filters the visible
  checks. `make inspect` shows the public example.
- `make reference-test` builds an author image, runs the existing mutation suite, then
  the Linux execution-boundary tests under `--init`. It rejects 27 mutations and accepts
  the reference plus a valid alternative two-of-three construction. Boundary tests
  cover verdict spoofing, file/environment access, supervisor control, no stored-secret
  reconstruction, public diagnostics, zero randomness, and actual descendant reaping.
- From the repository root, `make install && make agent-gate` validates the catalog.

[Reader and runtime evidence](local/tests/hidden/READER.md) records the original eight
reading gaps, the unchanged participant-written solution, and actual prepare → verify
results. The work was limited to this problem in #716; other problems remain separate.

## Filesystem metadata boundary follow-up

The learner's Linux filter also denies file/directory creation, links, renames, removal and metadata writes. Blocking file opens alone did not stop those operations from persisting after a worker exited. The problem-local regression applies the actual filter in 16 disposable children, checks 19 operations return EPERM, and verifies unchanged parent-owned fixture contents, directory entries, permissions, ownership, timestamps and extended attributes. Its temporary fixture is removed afterward. This adds no API, scoring, mathematical rule or execution deadline; existing positive sources and suites remain the acceptance baseline. See `local/tests/hidden/READER.md` for before/after scope and commands.

## Computational tools and execution time

Available computational standard libraries (tools included with Python): `collections`, `decimal`, `fractions`, `functools`, `hashlib`, `hmac`, `itertools`, `json`, `math`, `operator`, `random`, `statistics`, `time`, `typing`. Import them in your submitted files. Installing packages, file access and network access are unavailable. Submitted code has a 12-second execution deadline.
