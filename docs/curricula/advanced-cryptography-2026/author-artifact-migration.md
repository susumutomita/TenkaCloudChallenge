# Author-artifact separation — impact and migration order

The inventory [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271)
asks for: which AC26 problems the separation touches, in what order they moved,
and what a reader has to check when adding the thirty-first.

## What changed, per problem

All **30** AC26 problems were affected, because every one of them shipped one
image containing `reference/`. There is no partial state: they moved in a single
commit with an identical shape, so there is no ordering to get wrong and no
window in which half the catalog behaves differently from the other half.

| Week | Problems | Count |
|---|---|---|
| bridge | `ac26-bridge-experiment`, `ac26-bridge-properties` | 2 |
| Week 1 | `ac26-w1-constraint-lab`, `ac26-w1-underconstraint` | 2 |
| Week 2 | `ac26-w2-beaver-mul`, `ac26-w2-linear-shares`, `ac26-w2-privacy-audit`, `ac26-w2-private-aggregate`, `ac26-w2-secret-sharing` | 5 |
| Week 3 | `ac26-w3-ec-group`, `ac26-w3-field-inverse`, `ac26-w3-nonce-reuse`, `ac26-w3-schnorr` | 4 |
| Week 4 | `ac26-w4-arithmetization`, `ac26-w4-commit-open`, `ac26-w4-proof-pipeline` | 3 |
| Week 5 | `ac26-w5-cmux-blind-rotation`, `ac26-w5-encoding-noise`, `ac26-w5-extract-key-switch`, `ac26-w5-lwe-rlwe`, `ac26-w5-pbs-homnand`, `ac26-w5-rgsw-external` | 6 |
| Week 6 | `ac26-w6-cosnark-beaver`, `ac26-w6-cosnark-linear`, `ac26-w6-cosnark-privacy`, `ac26-w6-stack-design`, `ac26-w6-zkvm-exploit-predicate`, `ac26-w6-zkvm-witness-binding` | 6 |
| Week 7 | `ac26-w7-capstone-demo`, `ac26-w7-capstone-design` | 2 |

Each one received the same four edits:

1. `local/Dockerfile` — the single stage became `FROM … AS participant`, and a
   second stage `FROM participant AS author` took over `COPY reference/` and
   `COPY mutation.py`.
2. `Makefile` — `build:` gained `--target participant`; `reference-test:` builds
   `--target author` into a separate `$(IMAGE)-author` tag.
3. `local/docker-compose.yml` — `build:` gained `target: participant`.
4. `scripts/ac26-<id>.test.ts` — the digest-pin assertion was widened by exactly
   one optional group, `( AS \S+)?`, so a stage name is admitted and nothing
   else. The digest is still required.

## The three delivery paths, and why all three needed the edit

A learner can obtain an image three ways, and the separation is only real if all
three select `participant`. **Two of them defaulted to `author`**, which is the
last stage:

| Path | Before | After |
|---|---|---|
| `make build` | built the last stage → `author` | `--target participant` |
| `docker compose up` (what the READMEs and `make local` use) | built the last stage → `author` | `target: participant` |
| `make reference-test` | last stage → `author` | `--target author`, explicitly, into its own tag |

The compose path was missed on the first pass, and it is the one participants
actually use. `scripts/author-artifact-separation.test.ts` now checks all three
rather than only the Makefile, which is what let the gap through.

## Adding the thirty-first problem

`scripts/new-course-challenge.ts` scaffolds the two-stage shape, so a new problem
gets it without thinking about it. The guard is what makes that reliable, and it
fails on:

- either artifact reaching the participant stage through **any** `COPY` source —
  `COPY reference/`, `COPY ./reference/`, `COPY --chown=… reference/`, or a
  whole-context `COPY . .`;
- a `Makefile` whose `build:` omits `--target participant`;
- a `local/docker-compose.yml` whose `build:` omits `target: participant`;
- the `author` stage *not* receiving both artifacts, which would break
  `make reference-test` in a way that reads like a problem bug;
- any participant-path Python file importing `reference/`, checked across every
  `.py` the participant stage copies in — including `show.py`, which
  `make inspect` runs.

## What this migration does not do

It does not make local results trustworthy, and nothing here should be read that
way. The participant owns the machine, the daemon and the image; they can build
the author stage themselves, and `reference/` is in the repository they cloned
regardless. This is **misdelivery prevention** — the answer is no longer the
default state of the thing a learner was told to run.

The boundary itself is unchanged and is stated in
[`TEMPLATE.md`](./TEMPLATE.md#assurance-scope); the options for changing it are
in [ADR-0001](./adr/0001-trusted-verification.md), which adopts none of them.

## Platform-side changes

None. The separation is entirely inside this catalog: Dockerfiles, Makefiles,
compose files and tests. No TenkaCloud platform issue is required, which is why
#271's last condition has no linked issue rather than an open one.
