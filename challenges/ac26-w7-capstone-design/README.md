# Design a cryptographic system from its requirements

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. Statements, code,
> fixtures, and figures are independently authored. Contact the TenkaCloud repository about this track.

**Track:** `advanced-cryptography-2026` · **Order:** 710 · **Week 7 / Capstone Design**
· **Role:** `synthesis` · **Time:** 120–180 minutes · **Points:** 300

## Participant outcome

You design a system from a brief naming people, data, readers, and required behavior. Write
`design.py` so that changed requirements produce a new choice of tools, component graph, attack
plan, and evidence table. The six tool descriptions in `participant.lab.PRIMITIVES` are a supplied
teaching model. This exercise does not implement the cryptographic algorithms themselves.

The free Japanese and English instructions define the full input schema, return values, six
requirement rules, tool assumptions, and admissibility/minimality rules. They include a dataflow
diagram and small examples. The first action is classifying data using two independent facts:

| A forbidden reader exists | Direct source data exists | Classification |
|---|---|---|
| No | No | `public` |
| Yes | No | `private` |
| No | Yes | `derived-public` |
| Yes | Yes | `derived-private` |

In the problem editor, implement `classify_assets`, run public tests, and look for
`PASS test_asset_labels_follow_two_independent_facts`. Submit `assets` after that first PASS;
the later unfinished functions may still fail. No extra direct-answer field is needed.

## Participant route and scoring

Use **Inspect evidence** for your brief, a changed version of the same brief, and the completed
tool table. Edit `design.py`, run public tests, and submit the named checkpoint from the same
problem page. A correct submission returns its own checkpoint ID with `correct: true`; the
Portal owns the resulting score/Solved display. Code failures identify a documented broken rule
without supplying a hidden brief or expected answer.

| Checkpoint | Points | Work and dependency |
|---|---:|---|
| `assets` | 30 | Classify every datum and retain its owner |
| `requirements` | 45 | Derive six booleans from the brief |
| `alternatives` | 30 | Compare all six tools against the supplied table and trust rules |
| `selection` | 50 | Choose admissible, sufficient tools; removing one must lose coverage |
| `architecture` | 45 | Build nodes and data edges for a valid selection |
| `attacks` | 35 | Cover required properties and each placed tool/trust pair on a valid graph |
| `matrix` | 35 | Link required properties to providing components and same-property experiments |
| `revision` | 30 | Rebuild a consistent design and attack evidence from changed facts |

Each checkpoint can be submitted separately. Later checkpoints also validate the artifacts they
depend on; a malformed graph cannot pass merely because its attack rows look complete. There
are three hints per checkpoint (mechanism → small example → editor actions): **24 hints at
2 points each**, 48 points total. Wrong submissions cost 15 points under the platform tier rule.

There can be several correct answers. Selection is inclusion-minimal, not necessarily the fewest
tools. Node names, layout, and order are not copied from the author solution. The final task
requires constructing new graph/plan/evidence combinations for changed and generated briefs;
a fixed artifact or an ID lookup does not satisfy that contract.

## What the model does and does not check

- Every comparison includes all six options and their actual supplied assumptions/non-goals.
- Every asset occurs in the graph. Readable data cannot arrive at a forbidden reader; node
  trust links must refer to real nodes and have no cycle. Data self-loops are permitted.
- An attack on a placed trust uses `assumption: {primitive: name, trust: name}`. Every distinct
  placed pair is covered, including when the same tool is placed on several nodes.
- Evidence references a real attack ID on the same property. `attack_plan` must use stable IDs
  for the same brief/graph, since `property_matrix` and the grader regenerate the plan.
- The checker validates structure, coverage, references, and text presence. It does not assess
  the scientific quality of prose, execute attack experiments, or prove confidentiality or
  computation correctness from labels such as `ciphertext` or `proof`. A human must evaluate
  whether the proposed experiments and limitations support the real-world claim.

## Runtime and assurance boundary

The existing two-service Compose runtime serves the Workbench on `127.0.0.1:18119`. The verifier
is reachable only over the internal Docker network; its port is not published. Participant
images include the editor, starter, public tests, and completed vocabulary. Author/reference,
fixture generator, and hidden checker files stay in the verifier/author stages.

The trusted parent grades inert function values from a restricted Linux worker. The worker
receives neither the checker nor a fixture seed, and its output cannot set the verdict. A
type-preserving codec retains list/tuple, integer/boolean, and dictionary-key distinctions.
The parent preserves its input and its own copy of the vocabulary when running submitted
functions. A submission has a 12-second total deadline; Compose runs non-root with an init
process to reap descendants. Missing process isolation fails closed. Tests reproduce and reject submissions that erase forbidden-reader requirements or
rewrite the public `PRIMITIVES` table to make `none` provide every property. These checks are
specific demonstrated protections, not proof of a general Python sandbox. A local Docker owner
can build and inspect the author stages; local use remains self-study, not an independent exam
or ranking authority. Real event scoring and deployment remain platform responsibilities.

## Local commands and resource use

```bash
# Repository root
make install
make agent-gate

# This problem directory
make test
make reference-test
FLAG_SEED=local-study docker compose -f local/docker-compose.yml up -d --build --wait
# Workbench: http://127.0.0.1:18119
make verifier-down
```

This problem uses local containers, CPU, memory, and Docker image/build-cache storage; it creates
no AWS resource or cloud account. Each service has a 1 GiB memory limit. The intended study
session is 120–180 minutes. Stop both services with `make verifier-down`; images and build caches
remain on disk until removed. A host or cloud VM used to run Docker has its own operating cost.

## Author verification — 2026-09-08

- `make install` and repository catalog validation: 116 entries validated.
- `make reference-test`: **47 mutations rejected** (17 existing implementation mutations,
  27 targeted contract mutations, and 3 verifier probes), plus **12 regression test methods**.
  Nineteen of the 27 targeted invalid outputs were accepted by the previous checker. The new
  table-rewrite probe also reproduced `correct: true` before its fix and false afterward.
- Boundary regressions reject four forms of forged execution evidence at all eight checkpoints
  (32 negative cases), retain all eight reference successes, check tuple/list and bool/int
  distinctions, and exercise denied private-file access and parent signals. The separate
  reviewer found no additional concrete defect in a read-only boundary review; they did not
  rerun Docker.
- Positive regressions retain different valid minimal selections, graph ordering, owner-aware
  zero-knowledge requirements, and same-brief changed previews across 30 seeds.
- Real Compose Workbench HTTP route: unfinished starter imports; the free first classification
  edit earns `assets`; omitting `derived-` fails with a rule message; author reference passes
  all **13 public tests and 8 prepare/verify checkpoints**. Documented tuple selections pass;
  rewriting the public tool table fails. Reference runs are author verification, not evidence
  that a novice independently solved all eight stages.
- A separate reviewer read only participant material and found the tuple/public-test mismatch
  and the missing stable-attack-ID explanation. Both were corrected and reread. This is contract
  readability evidence, not a measured novice study.

The standard checkout-bind-mounted `make test` was also attempted. On this machine, Colima did
not expose the `/private/tmp` worktree starter mount, so that route failed to import `design`.
The actual Workbench upload route ran the same 13 public tests successfully, before and
after the value-boundary change. No platform or
runtime contract was changed to hide this host mount failure. Browser rendering, Portal score
persistence, AWS deployment, and a third-party play session were not exercised in this run.

### Supported computation imports / 計算用の標準ライブラリ

Supported computation imports / 計算用に使える標準ライブラリ:
array, base64, binascii, bisect, collections, contextlib, copy, dataclasses, decimal, enum, fractions, functools, hashlib, heapq, hmac, itertools, json, math, operator, random, re, statistics, string, struct, time, typing.
This list covers optional standard-library helpers. Imports already supplied by the starter (including __future__ and problem APIs) are also supported. Other optional imports and file/network access are not supported in grading.
この一覧は追加できる標準ライブラリです。スターターに最初からあるimport（__future__や教材のAPIなど）も、そのまま使えます。それ以外の追加importとファイル・通信操作には採点時は対応しません。
