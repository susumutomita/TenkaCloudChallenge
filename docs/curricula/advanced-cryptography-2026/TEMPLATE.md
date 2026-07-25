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
    ├── reference/         inside the image only, never mounted
    ├── fixtures/          everything derived from FLAG_SEED
    ├── tests/
    │   ├── public/        the learner reads these
    │   └── hidden/        the verifier runs these
    └── verifier/          POST /verify
```

Two naming traps, both hit while building the reference problem:

- **Do not name a top-level module `inspect.py`.** It shadows the standard library's `inspect`,
  and `dataclasses` imports it — the failure surfaces as a circular-import error somewhere
  unrelated. The template uses `show.py`.
- **`reference/` ships inside the image** (the mutation suite needs it) **but is never bind-mounted**.
  Mount `starter/` read-only and nothing else, or the answer lands in the learner's checkout.

## Participant contract

Identical across every AC26 problem, so a learner learns the commands once:

```bash
make test             # public tests
make test-one ID=...  # iterate on one behaviour
make inspect          # fixtures, intermediate values, the trace to reason about
make reset            # restore starter/ to its shipped state
```

`make reference-test` is authors and CI only. It runs the hidden and mutation suites **inside the
image**, so the reference implementation never reaches the host.

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
  have a SHA, omit the block and note why, as the Bridge 0 problem does.
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
- [ ] A `scripts/<id>.test.ts` runs the above in CI.
