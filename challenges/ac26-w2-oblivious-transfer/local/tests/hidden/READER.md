# OT participant reading and runtime evidence (#716)

## Reading boundary and teaching inputs

The root agent first read only participant-visible Japanese instructions/hints,
English statement/README, starter and public tests. It did not read hidden checks,
reference, generator or verifier sources. The first reading caught 14 concrete gaps:
role/bit/XOR/GMW vocabulary; late first action; inconsistent small examples;
tiny-group security overclaim; unsupported discrete-log necessity claim; sets versus
probabilities; literal-zero versus exponent-residue-zero confusion; missing inverse
and nonidentity assumptions; undefined observation boundary; withheld offer/mask/
output formulas; seven/eight function mismatch; missing exponent in the unseen hint;
undefined integer XOR; and dense, strategy-first hints.

The independent reading and immutable answer are retained externally in
`/private/tmp/oblivious-transfer-716-reader/first-reading.md` and
`reader-oblivious.py`. The same source is checked in under `portal/reader-oblivious.py`.
SHA-256: `7edb056890be2aa84c07baab3b871298b88a4c82fbd866d370aaea2f0a5bd896`.
It was created from the original public packet, not a reference answer. No manual
JSON is needed for this problem's six code checkpoints.

Before reading author internals, that unchanged source passed all eight original
public tests and all six real `/api/prepare` → `/verify` submissions on the dedicated
localhost18154 deployment. Public config, inspect and starter were saved too:
`/private/tmp/oblivious-transfer-716-reader/baseline-*.json` and
`/private/tmp/oblivious-transfer-716-baseline.log`. These are agent/API observations,
not a timed human or production playtest.

Both requested sources were read:

- Official `advanced-cryptography-2026/week2/problems/toy-mpc/README.md`, Part B,
  at `bdbc913fa7fd4ed87ce7f0de6b1d73fb41e49732`: OT request, encryption, decryption,
  zero-inclusive uniform receiver exponents, and two OTs for a GMW AND.
- Author `advanced-cryptography-note/week2/index.html` at
  `58344a29ea39c25839475ba9a594c115ed89989b`, OT/GMW explanations and interactive
  gate: exponent agreement, request distributions, cross terms, masks and local views.

The root reviewer read the revised JA/EN packet independently while implementation
continued. It checked p7/q3/g2/A4 request and key-input tables, shifted full cycles,
the probability distinction, GMW cancellation, and all eight function mappings.
Its terminology corrections (group before definition, generator wording and binary
place values) were applied to the statements and starter. All 18 hints per language
use mechanism → formula/example → actual editor/argument steps. The unchanged
reader remains separate from these later revisions and author-side security tests.

## What the mathematics does and does not establish

The public lesson gives both the concrete p7 table and the general index law. A
uniform draw over q consecutive integers visits every subgroup value once, including
a shifted interval q..2q−1. Removing one residue is different from merely shifting
an entire cycle. Equal supports alone do not generally establish equal distributions.
The private checker counts each request and validates canonical subgroup membership.

The gate checker enumerates all 64 bit/randomness settings for reconstruction, then
counts the selected `(received, own output)` observation over four uniform random
pairs while varying the other party's inputs. Both observation directions are tested.
This finite projection is not a proof for the full view of a distributed protocol or
for arbitrary Python running both roles. The explanation explicitly assumes a
semi-honest party following the protocol and an OT meeting its promises. The tiny
OT group itself is enumerable, public exercise data implements both roles, and
sender security is not proved by trying only one wrong decryption key.

## Confirmed before/after defects

1. The old grader imported the submission beside its checker and accepted a final
   stdout `{"failures":[]}` as a grade. A source that printed that object and exited
   without any of the eight functions passed all six private checkpoints and public
   tests through the actual API. The parent now runs all mathematical checks against
   untrusted returned values. The worker receives source, then a fresh call ID and
   arguments; it receives no checker or seed. Success text and preprinted replies
   fail closed.
2. The old gate check compared only sets. `biased_gate.py` is a concrete stateful
   counterexample: it reconstructs all 64 AND cases correctly, always receives0,
   and sets z0 to `(r0 & r1) ^ x1`. Both x1 values have the same output support{0,1},
   but probabilities3/4 and1/4 exchange places. A second output supplies the required
   reconstruction. The original real API accepted both and-gate and gate-privacy;
   occurrence-count comparison preserves the first pass and rejects the latter.
   This is a regression of the stated finite observation property, not a claim that
   arbitrary stateful Python implements separated distributed parties.
3. The public offer check originally accepted booleans as bits. Public and private
   formats now agree on integer0/1, excluding bool; unwrap also requires an integer
   rather than accepting an equal float. List and tuple pairs remain equivalent
   through JSON arrays. No native-Python-container attestation is claimed.

Before probes: `/private/tmp/oblivious-transfer-716-verdict-before.log`,
`oblivious-transfer-716-distribution-before.log` and reader `check-before.py`,
`biased-gate.py`. The original false-success and concrete bias are tested separately
from the preserved correct frozen answer.

## Execution boundary

The existing endpoints, checkpoint IDs, scores, phase composition and tcw1 preparation
contract remain. The suite wall limit remains20 seconds; memory512MiB, processes64,
and bounded64KiB value/log output remain. The worker has an additional CPU limit and
inherits no server environment or descriptors. Both HTTP supervisors protect their
process memory/FDs. Both Compose services use non-root users and init to reap orphaned
descendants. Problem-local seccomp blocks files/network/exec, SysV/POSIX persistent
IPC, scheduler changes and persistent filesystem metadata operations. These are
additional process restrictions within the existing Docker boundary.

Fresh 128-bit IDs prevent initialization-time/predictable replies from matching
future calls. They do not authenticate native Python return objects: arbitrary Python
can read a live call and implement the same value protocol. Every value still must
satisfy the trusted parent's shape and mathematical checks. The public helper
`participant.ot.derive_key` is loaded before restriction and remains available;
private fixture modules and FLAG_SEED do not enter the learner. Workbench alone keeps
the existing seed needed by the unchanged preparation contract.

Public compile/import failures expose only validated participant filename, line and
exception type. Private failures stay generic/property-level; hidden input prints do
not enter returned feedback. A partial-output test measures the deliberately hung
call after real initialization, avoiding a startup scheduling race without changing
the production timeout. Descendant tests wait for disappearance of every extra PID;
a zombie or a soon-to-be zombie is not successful cleanup.

## Reproduce

From this problem directory, with Docker and the host repository dependencies:

```sh
make runtime-test FLAG_SEED=oblivious-transfer-reader-716
make reference-test FLAG_SEED=oblivious-transfer-reader-716
FLAG_SEED=oblivious-transfer-reader-716 docker compose \
  -p ac26-oblivious-transfer-reader -f local/docker-compose.yml up -d --build --wait
AC26_WORKBENCH_URL=http://127.0.0.1:18310 \
  local/tests/hidden/portal/run.sh /absolute/path/to/TenkaCloud
FLAG_SEED=oblivious-transfer-reader-716 docker compose \
  -p ac26-oblivious-transfer-reader -f local/docker-compose.yml down
# Repository root: make install; make agent-gate
```

The retained harness uses actual ContainerWorkbenchPanel and actual config, starter,
inspect, public-test, prepare and verify HTTP paths. It edits the real starter with the
frozen source, submits six fields, and checks each solved row collapses. Only the
outer Portal transport/auth/score adapter is mocked. It is component/API evidence,
not a physical browser or AWS claim.

This run's dedicated stack is `ac26-oblivious-transfer-reader-716`, published only on
localhost18154, using `/private/tmp/oblivious-transfer-716-compose.yml` and synthetic
seed `oblivious-transfer-reader-716`. It remains running for the root review.

## Final results (2026-09-07)

| Verification | Result |
|---|---|
| Actual Linux `make runtime-test` | 19 tests pass, 55.844 seconds. Includes frozen/reference answers, full shifted range, live-ID math checks, same-support biased distributions, list/tuple transport and scalar types, clean helper import, IPC/scheduler/FS restrictions, diagnostics, timeout and descendant cleanup |
| Existing `make reference-test` | Reference passes; all13 existing mutations killed |
| Catalog `make install`, `make agent-gate` | All116 entries valid; runtime metadata, difficulty, checkpoint IDs/points and hint penalties unchanged |
| Real final API, frozen reader | Public10 examples pass; prepare→verify all6 checkpoints true |
| Real API false-success contrast | Previously6/6 true plus public true; now6/6 false plus public false |
| Real API biased observation contrast | Previously and-gate=true and gate-privacy=true; now and-gate=true and gate-privacy=false |
| Retained Portal component harness | One test passes in16.12s total (5.72s test), with real starter editing, inspect, public tests, all6 submissions and solved-row folding |
| Existing public CLI inside final participant image | All10 public examples pass with only the unchanged reader supplied through stdin into an automatically removed temporary directory |

Artifacts are `/private/tmp/oblivious-transfer-716-{runtime-final,mutations,
catalog-final,compose-final,final-http,verdict-before,verdict-after,
distribution-before,distribution-after,portal,public-cli}.log`.
The full CLI was tested using the final participant container; no new CLI interface
was introduced. The literal default `make test` target, which rebuilds a different
host port and bind-mounts the unfinished starter, was not used in this dedicated run.
No real browser, AWS, release, commit or push was performed by the implementing agent.

Root final verification: the retained six-field Portal harness was rerun on the unchanged final service and passed (9.49s total, 3.85s test); see `/private/tmp/oblivious-transfer-716-root-portal.log`. The root reviewed the parent value protocol, finite distribution checks, isolation and the revised participant packet before committing.
