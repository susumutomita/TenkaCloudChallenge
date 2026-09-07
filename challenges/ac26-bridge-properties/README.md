# What it holds, what it breaks

Audit three small input-checking programs. Find a valid value that a boundary check
rejects, construct an out-of-range value that a missing check accepts, and read a
witness from a record. Then classify each program and make the same functions work
on unseen numeric inputs. This teaches counterexamples and the difference between
completeness, input validity, and record disclosure; it is not a real zero-knowledge
protocol or a claim that these public equations hide their solutions.

## Participant route

Start the problem in Participant Portal, select **Inspect evidence**, and compare
`statement`, `verifiers`, and `transcript` with the formula table in the statement.
Edit `classify.py` and `counterexamples.py` in the problem editor. All five Submit
buttons derive their submission values from those files. No terminal is required.
The Japanese and English statements supply the needed formulas, small examples,
three hint steps per checkpoint, and the meaning of each Inspect check name.

Public tests check return-value shapes; the intentionally wrong starter passes.
Submitting checks the property. A correct `incompleteness` function must calculate
from its argument: this checkpoint supplies a different boundary statement from
Inspect. `transfer` keeps the deployment's public verifier names while changing the
numeric statements and transcripts. A fresh deployment can change names and values;
restarting the same one need not do so.

| Checkpoint | Points | Evidence |
| --- | ---: | --- |
| incompleteness | 40 | A valid input rejected by the strict lower-bound check |
| unsoundness | 45 | An out-of-range input accepted by the equation-only check |
| privacy-leak | 40 | The witness read from the supplied record |
| property-matrix | 35 | Three booleans for each of the three public verifier names |
| transfer | 40 | The same functions passing unseen numeric cases |

Each wrong attempt costs 10 points. Each checkpoint has three hints costing 3, 3,
and 4 points, so all hints together cost 50 of the 200 base points. The closing
questions ask which repair changes input acceptance and which changes disclosure.

## Runtime and boundary

Compose runs a loopback-published Workbench and an unpublished verifier on an
internal network. The Workbench image contains public materials and a restricted
function evaluator, with no fixture generator, hidden checker, reference answer,
or deployment seed. Only the verifier receives `FLAG_SEED`.

The verifier parent generates cases, runs submitted functions in a fresh child,
and checks their returned JSON values itself. Neither a child exit code nor printed
`{"failures": []}` is a grade. The child receives only source and function inputs,
not the seed, expected results, or checker. After loading its inputs and standard
library, Linux seccomp denies file opening, exec, networking, and interference with
other processes. Supervisors disable same-UID memory inspection; time, memory,
output and process limits apply. Both success and timeout clean up the child's
process group. These restrictions are enforced in the pinned Linux image and are
not silently replaced by weaker execution on a macOS author host.

The public proxy uses fixed internal `/public`, `/prepare`, and `/verify` routes.
It does not relay arbitrary paths. Failed preparation never echoes the child's
unseen input values; failed transfer reports only the checker's property messages.
A participant can see public inputs and their own output, but cannot turn that
output into an authoritative success or import the hidden checker through the editor.

Local Docker administrators can inspect or alter their containers. This is a
self-study runtime, not confidentiality against its operator. Code evaluation is
limited to this arithmetic exercise, not a general Python filesystem/network sandbox
service. No hidden or reference materials belong in the participant image.

## Local checks and resources

From this problem directory:

```sh
make test                 # public shapes and the live editor adapter, via Compose
make inspect              # public evidence, via Compose
make reference-test       # author-only mutations and Linux boundary regressions
make verifier-down        # stop this problem's Compose containers and networks
```

`make test` leaves its verifier running for repeated practice until teardown.
`make reference-test` builds a separate author image and uses disposable containers.
Linux boundary regressions cover public-name transfer, forged verdicts, private file
and process-environment access, networking, exec, supervisor interference, timeout,
and child cleanup. Catalog checks are separate: run `make install && make agent-gate`
from the repository root. They do not prove the runtime.

This local problem creates no AWS resources. Its two containers consume local CPU,
memory and disk; images and build caches remain after containers are stopped.
For a hosted event, platform compute/storage and any platform networking can incur
cost until the deployment is removed. Use the platform's deployment teardown to stop
it. Live AWS and third-party acceptance were not used as verification gates here.

Author-only source rationale, independent reader findings and HTTP evidence are in
`local/tests/hidden/READER.md`.

## Filesystem metadata boundary follow-up

The learner's Linux filter also denies file/directory creation, links, renames, removal and metadata writes. Blocking file opens alone did not stop those operations from persisting after a worker exited. The problem-local regression applies the actual filter in 16 disposable children, checks 19 operations return EPERM, and verifies unchanged parent-owned fixture contents, directory entries, permissions, ownership, timestamps and extended attributes. Its temporary fixture is removed afterward. This adds no API, scoring, mathematical rule or execution deadline; existing positive sources and suites remain the acceptance baseline. See `local/tests/hidden/READER.md` for before/after scope and commands.

## Computational tools and execution time

Available computational standard libraries (tools included with Python): `collections`, `decimal`, `fractions`, `functools`, `hashlib`, `hmac`, `itertools`, `json`, `math`, `operator`, `random`, `statistics`, `time`, `typing`. Import them in your submitted files. Installing packages, file access and network access are unavailable. Submitted code has a 15-second execution deadline.
