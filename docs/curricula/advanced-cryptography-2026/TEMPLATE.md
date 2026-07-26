# AC26 companion problem template

Every problem in this track is scaffolded from the same shape, so that adding one means writing
the cryptography, not re-deciding the Docker layout, the scoring API, the hidden-test discipline,
or the metadata graph.

The reference implementation is [`challenges/ac26-bridge-experiment`](../../../challenges/ac26-bridge-experiment).
It is a working problem, not a skeleton: `bun test scripts/ac26-bridge-experiment.test.ts` runs
its starter, its reference, its mutation suite, and its `/verify` contract for real on every CI
run. When this document and that directory disagree, the directory is right and this document is
a bug.

Scaffold a new one:

```bash
bun run new-course-challenge ac26-w3-field-inverse
```

## Layout

```text
challenges/<id>/
├── metadata.json
├── README.md          English primary
├── README.ja.md       Japanese mirror
├── Makefile           the participant contract
├── diagram.svg        optional
├── artifacts/         specs, observation logs, figures — never answers
└── local/
    ├── docker-compose.yml
    ├── Dockerfile
    ├── show.py            `make inspect`
    ├── mutation.py        proves the hidden tests can fail a wrong answer
    ├── starter/           the only thing the learner edits
    ├── reference/         author stage only, never bind-mounted (see Assurance scope)
    ├── fixtures/          everything derived from FLAG_SEED
    ├── tests/
    │   ├── public/        the learner reads these
    │   └── hidden/        the verifier runs these
    └── verifier/          POST /verify
```

The scaffolder hands you one neutrally-named exercise module in each place:

```text
local/starter/exercise.py
local/reference/exercise.py
local/tests/public/test_exercise.py
local/tests/hidden/check_exercise.py
```

**Rename those four. Do not add alongside them.** The scaffolder copies a whole working problem,
so a fifth file named after your exercise leaves the template's four inside your image — dead
code that ships to participants and, in `reference/`, an answer to a problem that is not yours.
That reached main once. `scripts/scaffold-leftover-guard.test.ts` now fails the build on it:
`reference/` must mirror `starter/`, and each problem has exactly one public test entry point and
exactly one hidden check module.

Three naming traps, all hit while building the reference problem:

- **Do not name a top-level module `inspect.py`.** It shadows the standard library's `inspect`,
  and `dataclasses` imports it — the failure surfaces as a circular-import error somewhere
  unrelated. The template uses `show.py`.
- **`reference/` ships only in the `author` stage** (the mutation suite needs it); `make build` and
  the compose `target:` both select `participant`. Mount `starter/` read-only and nothing else, so
  the answer reaches neither the image the learner runs nor any bind mount. It is still in the
  repository they cloned — this arrangement cannot and does not remove it from their checkout.
  That is the whole of what it buys; it is not confidentiality. See
  [Assurance scope](#assurance-scope).
- **A scaffolded problem is a full copy, not a link.** Fixes made to the template after you
  scaffolded do not reach you. The macOS `RLIMIT_AS` fix had to be applied by hand to four
  problems for exactly this reason; `scripts/verifier-rlimit-guard.test.ts` exists to catch it.

## Participant contract

Identical across every AC26 problem, so a learner learns the commands once:

```bash
make test             # public tests
make test-one ID=...  # iterate on one behaviour
make inspect          # fixtures, intermediate values, the trace to reason about
make reset            # restore starter/ to its shipped state
```

`make reference-test` is authors and CI only. It runs the hidden and mutation suites **inside the
image**, so the reference implementation is not written into the learner's working tree.

## Assurance scope

Local mode is **self-paced, honor-system verification**. Everything below follows from one fact:

> The participant owns the machine, the Docker daemon, and the image.

### What the local verifier does guarantee

These are properties of the verifier against a submission, and they hold:

- a submission cannot hang, crash, fork-bomb, or shell-inject the verifier — it fails the
  checkpoint instead (see the `/verify` security contract below);
- a checkpoint can only ever credit the id it echoes, so the platform fails closed on a mismatch;
- responses carry a verdict and at most a property name, so a checkpoint result is not an oracle
  that dumps expected values;
- fixtures derive from the per-deploy `FLAG_SEED`, so an answer memorized from one deployment does
  not carry to another, and a hardcoded constant does not pass.

### What it does not guarantee

State these plainly rather than implying otherwise:

- **`tests/hidden/` is not confidential.** It ships inside the image the participant builds and
  runs. Not bind-mounting it keeps it out of the git checkout — it does not keep it from someone
  who wants to look. "Not mounted" is tidiness, not a boundary.
- **`reference/` no longer ships in the image a learner runs**, which is a different and weaker
  claim than confidentiality. `make build` builds the `participant` stage, which carries the
  fixtures, tests, verifier and starter; `reference/` and `mutation.py` are added by the `author`
  stage that `make reference-test` builds. Nothing on the participant path loads `reference/`, so
  the split costs the learner nothing. It is **misdelivery prevention**: the answer is no longer
  sitting in `/problem/reference/` on their machine by default. They can still build the author
  stage, and the source is in this repository either way.
  `scripts/author-artifact-separation.test.ts` parses each Dockerfile stage's `COPY` sources and
  fails the build if any of them brings either artifact into the participant stage — including
  `COPY ./reference/`, `COPY --chown=… reference/` and a whole-context `COPY . .`, none of which a
  literal string check would have caught. It also fails if a Makefile builds without `--target`, or
  if a `local/docker-compose.yml` omits `target: participant`; both silently produce the author
  stage, since it is last.
- **The checker is not tamper-resistant.** The participant controls the image and the process, so
  they can replace the checker, the fixtures, or the verifier itself.
- **Submission and checker share a Python module graph.** `/verify` loads both into the same child
  process, so the submission can reach the checker's namespace.

None of these is a defect in a particular problem. They follow from running the grader on hardware
the graded party controls, and no amount of care inside the image changes that.

### Which claims local results support

| Use | Supported |
|---|---|
| Self-study, practice, and formative feedback | Yes — this is what local mode is for |
| A learner convincing themselves they understood something | Yes |
| Competition ranking, examination, completion certification | **No** |

Trusted verification needs a verifier the participant does not administer. The design options are
set out in [ADR-0001](./adr/0001-trusted-verification.md); none is adopted yet, and until one is,
do not let a local `multi-verify` result stand behind a claim in the "No" row.

[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) lists eight completion
conditions. Where they stand:

| # | Condition | State |
|---|---|---|
| 1 | Threat model written down; participant controls host, daemon and image | Landed — the section above |
| 2 | Overstated "hidden" / "does not reach the host" wording corrected | Landed |
| 3 | Honor-system and trusted verification separated by use | Landed — the table above |
| 4 | Trusted-verification design **proposal** in an ADR | Landed — [ADR-0001](./adr/0001-trusted-verification.md), which adopts nothing |
| 5 | `reference/` and mutation tooling out of the default participant image | Landed |
| 6 | That separation positioned as misdelivery prevention, not confidentiality | Landed — stated here and in every problem README |
| 7 | Regression test that author-only artifacts cannot enter the participant bundle | Landed — `scripts/author-artifact-separation.test.ts` |
| 8 | Impact list and migration order for existing AC26 problems | Landed — [`author-artifact-migration.md`](./author-artifact-migration.md) |

Adopting an ADR option is explicitly **not** one of them; #271 says the decision is separate.

The item that is not in that list and not fixed is the one that keeps the "No" row at "No":
the submission and the checker still share a Python process. Separating the artifacts changed what
is delivered by default; it did not change who administers the machine, and that is the fact the
whole table rests on.

Every AC26 problem README carries a short **Assurance scope** section saying this in participant
language. `scripts/assurance-scope.test.ts` asserts it is there and that no problem has drifted
back to claiming confidentiality.

## Scoring contract

`scoring.kind: "multi-verify"`, 2–8 checkpoints (4–6 recommended), each scoring exactly one
observable outcome. Spanning at least three of these kinds:

`observe` · `predict` · `construct` · `counterexample` · `repair` · `transfer` · `misconception`

A problem that can be completed by finding one fixed string in the repository does not qualify.
Point totals follow the tier regulation in [`SCORING.md`](../../../SCORING.md); the evidence
requirements are in [`ASSESSMENT.md`](./ASSESSMENT.md).

## `/verify` security contract

The verifier runs learner code. Every item below is implemented in
`challenges/ac26-bridge-experiment/local/verifier/server.py` and asserted by its test file.

| Requirement | How the reference does it |
|---|---|
| `checkpointId` required, echoed verbatim | Response is always `{"checkpointId": ..., "correct": ...}`; the platform fails closed on a mismatch, so it can never credit a different checkpoint |
| Unknown checkpoint is a failed verdict, not an error | Returns `correct: false` with the id echoed |
| Submission runs in a throwaway workspace | `tempfile.TemporaryDirectory()`; the source tree is never written |
| Wall-clock timeout | `subprocess.run(..., timeout=10)` |
| Memory and process caps | `RLIMIT_AS`, `RLIMIT_NPROC`, `RLIMIT_FSIZE` applied in `preexec_fn` |
| Output size cap | Truncated to 64 KiB before parsing |
| No shell | Argument list with `shell=False`; learner input is never concatenated into a command |
| Nothing leaks | Responses carry `correct` and at most a property name — never hidden test names, expected values, or reference output |
| Malformed input never kills the verifier | Body parsing and evaluation are both wrapped; a broken checkpoint returns `correct: false` |
| Fixtures from the per-deploy seed | `fixtures/generate.py` derives everything from `FLAG_SEED` |
| Loopback only | Compose binds `127.0.0.1:` on every published port |

One more, easy to forget: the verifier's access log is silenced. The default
`BaseHTTPRequestHandler` log would echo request lines, and submissions are request bodies.

## Test design

**Public tests** show the API and the minimal happy path. They must be readable and they must
*not* be sufficient — if a learner can pass the hidden tests by satisfying the public ones, the
problem has no teeth.

**Hidden tests** vary what the public ones hold fixed: modulus, group element, polynomial degree,
noise, share count, nonce. They include boundary and invalid values, and they check metamorphic
relations rather than fixed expected values wherever possible, because a relation cannot be
satisfied by memorizing one output.

**Mutation tests** are the check on the checks. Break the reference on purpose, assert the hidden
tests catch each break. Include the always-succeed verifier — a verifier that returns `correct:
true` unconditionally is the one defect that silently invalidates an entire problem, and it
cannot be expressed as a broken submission.

### Equivalent mutants

Some plausible-looking mutations are mathematically identical to the reference, so no correct
test can distinguish them. In the reference problem, reducing once at the end and leaving `start`
unnormalized are both equivalent to round-by-round reduction under Python's floored `%`. Listing
them produces a permanent "survived" that trains authors to ignore the suite.

Before adding a mutation, convince yourself it changes an observable output for some input. If
you cannot construct that input, it is an equivalent mutant — leave it out and say why in a
comment.

## Metadata checklist

- `track.id: "advanced-cryptography-2026"`, plus `track.order` from the band table in
  [`curriculum.md`](./curriculum.md) and `track.chapter`.
- `courseAlignment` with a **real** 40-hex upstream commit SHA. Never invent one: if you do not
  have a SHA, omit the block and note why, as the Bridge 0 problem does. For a companion written
  against a week whose material is not published yet (Week 2, Week 4), pin the placeholder with
  `kind: "placeholder"` so the day it is published is reported as a publication rather than as an
  edit — see [`SYNC.md`](./SYNC.md) §2, which is also the procedure for moving a pin.
- `learningGoals`, and `nodes` covering `learning_objectives`, `concepts`,
  `assessment_criteria`, `misconceptions`.
- `relations`: `teaches` / `covers` / `requires` / `assesses`. Concept IDs come from the shared
  table in `curriculum.md`; do not mint a near-duplicate.
- `instructions` (JA + `i18n.en`) — the portal never shows `description` to competitors.
- `writeup` (JA + `i18n.en`), gated per [`GOVERNANCE.md`](./GOVERNANCE.md) §4 for
  `assignment-companion` problems.
- `runtime.provider: "docker"`, `runtime.engine: "compose"`, `runtime.verifyUrl`,
  `runtime.secretEnv: ["FLAG_SEED"]`. Omit `challengeEndpoints` entirely when the problem has no
  participant-facing HTTP surface — the schema requires at least one entry if the key is present.
- Both READMEs carry the disclaimer from `GOVERNANCE.md` §3.

## Before opening the PR

- [ ] `bun run validate` passes.
- [ ] The container builds and starts.
- [ ] At least one checkpoint fails in the shipped starter state.
- [ ] Every checkpoint passes with the reference.
- [ ] `/verify` scores per checkpoint and echoes the id.
- [ ] Timeout, malformed request, and unknown checkpoint are all handled safely.
- [ ] Changing the seed changes the fixtures.
- [ ] The mutation suite kills every listed defect, including the verifier mutations.
- [ ] Neither the writeup nor the hidden tests reach the participant-facing bundle.
- [ ] Both READMEs carry the **Assurance scope** section, and nothing in the problem claims
      the reference or the hidden tests are confidential or tamper-resistant.
      `scripts/assurance-scope.test.ts` checks this; it exists because the whole catalog had
      drifted into claiming it once already.
- [ ] A `scripts/<id>.test.ts` runs the above in CI.
