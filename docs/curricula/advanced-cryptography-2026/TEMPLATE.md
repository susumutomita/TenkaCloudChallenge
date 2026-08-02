# AC26 companion problem template

Every problem in this track is scaffolded from the same shape, so that adding one means writing
the cryptography, not re-deciding the Docker layout, the scoring API, the hidden-test discipline,
or the metadata graph.

There are **two** shapes, and the first decision when writing a problem is which one it is.

| Shape | Played by | Scoring | Reference implementation |
|---|---|---|---|
| **Terminal** | attaching the portal's container terminal and typing one line at a time | `verify`, a single discovered flag | [`ac26-bridge-experiment`](../../../challenges/ac26-bridge-experiment) (difficulty 1), [`ac26-w1-underconstraint`](../../../challenges/ac26-w1-underconstraint) (difficulty 4) |
| **Starter** | editing `local/starter/` in a checkout and submitting the file | `multi-verify`, checkpoints with partial credit | [`ac26-w3-field-inverse`](../../../challenges/ac26-w3-field-inverse) |

**Reach for the terminal shape unless you have a specific reason not to.** The portal's answer box
is a single-line `<input type="text">`; the container has no `make`, no `vi` and no `nano`; and
`starter/` is baked into a `read_only` image. A starter-shaped problem is therefore not playable
from the portal at all — it needs a checkout, an editor and a local Docker daemon, which is a
different product. The starter shape is documented here because most of the track still uses it,
not because it is the default.

Both references are working problems, not skeletons: `bun test scripts/ac26-bridge-experiment.test.ts`
and `bun test scripts/ac26-w3-field-inverse.test.ts` run their references, their mutation suites
and their `/verify` contracts for real on every CI run. When this document and those directories
disagree, the directories are right and this document is a bug.

Scaffold a new one:

```bash
bun run new-course-challenge ac26-w3-field-inverse
```

> **Known stale.** `scripts/new-course-challenge.ts` hard-codes
> `TEMPLATE_ID = "ac26-bridge-experiment"` and renames `local/starter/counter.py` and friends,
> which that problem no longer has. Until the scaffolder is repointed or taught the terminal
> shape, it copies a terminal-shaped problem while printing starter-shaped next steps, and
> `scripts/new-course-challenge.test.ts` fails on the file layout it expects. Copy an existing
> problem of the shape you want by hand in the meantime.

## Layout

Terminal shape — `ac26-bridge-experiment`, `ac26-w1-underconstraint`:

```text
challenges/<id>/
├── metadata.json
├── README.md          English primary
├── README.ja.md       Japanese mirror
├── Makefile           author tools only; no participant ever sees it
├── diagram.svg        optional
└── local/
    ├── docker-compose.yml
    ├── Dockerfile
    ├── <verb>.py          the CLI: the entire participant surface, installed on PATH
    ├── mutation.py        proves the judge can fail a wrong answer  (author stage)
    ├── lab/               the judgements, the input language, the progress store
    ├── reference/         the answers, derived from the seed        (author stage)
    ├── fixtures/          everything derived from FLAG_SEED
    ├── tests/public/      the interface self-check
    └── verifier/          POST /verify — compares a flag, runs nothing
```

Starter shape — `ac26-w3-field-inverse` and most of the track:

```text
challenges/<id>/
├── ... (as above)
├── Makefile           the participant contract
└── local/
    ├── show.py            `make inspect`
    ├── mutation.py        proves the hidden tests can fail a wrong answer
    ├── starter/           the only thing the learner edits
    ├── reference/         author stage only, never bind-mounted (see Assurance scope)
    ├── fixtures/          everything derived from FLAG_SEED
    ├── tests/
    │   ├── public/        the learner reads these
    │   └── hidden/        the verifier runs these
    └── verifier/          POST /verify — runs learner code
```

The rest of this section is the starter shape. The scaffolder hands you one neutrally-named
exercise module in each place:

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

Three naming traps, all hit while building these problems:

- **Do not name a top-level module `inspect.py`.** It shadows the standard library's `inspect`,
  and `dataclasses` imports it — the failure surfaces as a circular-import error somewhere
  unrelated. The starter shape uses `show.py`; the terminal shape names its CLI after the verb the
  participant types.
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

Identical across every AC26 problem **that ships a `local/starter/`**, so a learner who edits a
starter learns the commands once:

```bash
make test             # public tests
make test-one ID=...  # iterate on one behaviour
make inspect          # fixtures, intermediate values, the trace to reason about
make reset            # restore starter/ to its shipped state
```

`make reference-test` is authors and CI only. It runs the hidden and mutation suites **inside the
image**, so the reference implementation is not written into the learner's working tree.

### Terminal-delivered problems have no starter and no `make` contract

A problem can instead be played **entirely from the container terminal the portal attaches**, with
a CLI inside the image and no file to edit. Two worked examples, at opposite ends of the track's
difficulty range:

- `ac26-bridge-experiment` — `counter show` / `counter predict 4` / `counter locate 2` /
  `counter rule "…"` / `counter transfer predict=1 locate=3` / `counter flag`.
- `ac26-w1-underconstraint` — `circuit show` / `circuit check …` / `circuit repair "…"` /
  `circuit flag`.

Reach for this shape when the portal is the only place the problem will be played. The `make`
contract above assumes a checkout, an editor, and a starter to reset; a player who opened the
problem in a browser has none of those, and `make inspect` is not a command they can run. What
replaces each piece:

- **`scoring.kind: "verify"`, not `multi-verify`.** The portal's answer box is a single-line text
  input. A checkpoint that expects a file's source cannot be submitted from it. The submission is
  a flag derived from `FLAG_SEED` inside the container, released by the CLI only after the stages
  are cleared — so it stays a discovered value rather than a remembered one.
- **State lives in `/tmp`**, the only writable path under `read_only: true` + a tmpfs. It is lost
  when the container is recreated; say so in the README rather than adding a volume.
- **Every command fits on one line.** The terminal has no TTY, so there is no line editing, no
  prompt, and no multi-line paste. Take `key=value` lists and short quoted expressions, not JSON.
- **Install the entry point on `PATH`** and resolve imports from the script's own directory. The
  terminal does not promise to open in `/problem`.
- **The Makefile stays, as an author tool.** Keep `build` / `test` / `reference-test`; drop
  `reset`, which has no starter to restore. `scripts/participant-contract.test.ts` selects on
  `local/starter/`, so such a problem sits outside that contract rather than violating it.
- **`reference/` and `mutation.py` still split into the `author` stage**, and
  `make reference-test` still has to fail a wrong answer — the grading moved into the image, so
  the mutation suite now breaks the *judge* one requirement at a time instead of the submission.

#### `show` is the whole briefing

The portal shows a short `instructions` block and then hands over a shell. Whatever the CLI's
`show` does not say, nobody says. It has to carry the subject, this deployment's numbers, **and
the literal next command for every stage** — not a description of what to do, the line to type.
`ac26-bridge-experiment` is the one to copy here, because it is the first problem in the track and
the first terminal its participants ever open.

Two consequences worth stating:

- **Run it again is the recovery path.** There is no scrollback you can rely on and no editor, so
  `show` must be idempotent, must restate everything, and must be advertised as the thing to run
  when lost.
- **Gate later stages inside `show` itself.** A stage that is not yet reachable prints "locked"
  and what unlocks it, rather than being absent — absent reads as broken.

#### Multi-stage problems need a transfer stage

A CLI with three stages can be cleared by someone who found one shape and repeated it. After the
main stages pass, present **the same subject with different parameters** and require that too
before the flag is released. Keep it the same *questions* rather than new ones: what is being
measured is whether the reading generalises, not whether a fifth concept was learned.
`ac26-bridge-experiment` runs its counter backwards for exactly this.

Gate it on the earlier stages both ways — refuse the answer, and keep the case off the screen —
so the transfer cannot be worked in parallel with the thing it is supposed to come after.

#### What the mutation suite has to cover once the CLI is the grader

Breaking the judge is necessary but not sufficient, because two of the failure modes live outside
it:

- **The flag gate, over every subset of the stages.** Enumerate them (`itertools.combinations`)
  rather than hand-listing: four stages is sixteen states, and the one nobody thought of is the
  one that leaks.
- **The stage locks**, driven through the CLI, since the progress store is CLI-level state that
  the judge functions never see.

And expect the suite to change the problem, not just check it. `ac26-bridge-experiment`'s broken
trace originally left the window exactly once; breaking the judge's "is it the **first** entry"
requirement then changed no verdict, because with one break there is no difference between the
first and the only. The mutation survived, and the fix was to the fixture — the trace now breaks
twice. A surviving mutant is as often a badly-posed question as a missing test.

Finally, a mutation that only fails on some seeds is worse than no mutation. When a defect is real
but not deterministically reachable from the wrong-answer catalog — defaulting a missing input to
`0` is only wrong on a deployment whose answer happens to be `0` — assert the property directly
instead and say why in a comment. A `SURVIVED` line that is sometimes correct trains authors to
stop reading the output.

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

**Starter shape:** `scoring.kind: "multi-verify"`, 2–8 checkpoints (4–6 recommended), each scoring
exactly one observable outcome.

**Terminal shape:** `scoring.kind: "verify"`, a single discovered flag, with the same coverage
demanded of the CLI's **stages** instead of of checkpoints. The stages are what the participant
walks; the flag is what the platform scores.

Either way, span at least three of these kinds:

`observe` · `predict` · `construct` · `counterexample` · `repair` · `transfer` · `misconception`

A problem that can be completed by finding one fixed string in the repository does not qualify.
Point totals follow the tier regulation in [`SCORING.md`](../../../SCORING.md); the evidence
requirements are in [`ASSESSMENT.md`](./ASSESSMENT.md).

## `/verify` security contract

**This section applies to the starter shape**, where `/verify` runs learner code. Every item below
is implemented in `challenges/ac26-w3-field-inverse/local/verifier/server.py` and asserted by its
test file.

A terminal-shaped problem's `/verify` runs **no** participant code at all: the grading that needs
reasoning happened in the participant's own terminal, and by the time a string reaches the verifier
the only question left is whether it is this deployment's flag. Such a verifier needs only the
constant-time comparison (`hmac.compare_digest`, so a wrong answer is not a timing oracle), the
body-size and timeout bounds, the silenced access log, and the two binding rules at the bottom of
the table. `scripts/verifier-spoof-guard.test.ts` enforces the split from the other side: a
verifier with no runner must execute nothing — no `subprocess`, `exec`, `eval` or `compile`.

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
| Loopback only, on the host | Compose publishes `127.0.0.1:<port>:<port>`. This is the half that restricts exposure |
| Reachable, inside the container | `HTTPServer(("0.0.0.0", port), ...)`. A published port is forwarded to the container's bridge address, so binding the container's own `127.0.0.1` accepts nothing from outside it — refused connection, no scoring, nothing in any log. The careful-looking address is the broken one, and no `make` target crosses this path, so it is invisible while authoring. `scripts/verifier-reachability-guard.test.ts` asserts both halves |

One more, easy to forget: the verifier's access log is silenced. The default
`BaseHTTPRequestHandler` log would echo request lines, and submissions are request bodies.

## Test design

**Public tests** show the API and the minimal happy path. They must be readable and they must
*not* be sufficient — if a learner can pass the hidden tests by satisfying the public ones, the
problem has no teeth. In a terminal-shaped problem there is no submission to test, so the public
suite tests the *interface* instead: that `show` says everything, that a malformed input explains
itself, that a locked stage stays locked, that nothing prints the flag.

**Hidden tests** vary what the public ones hold fixed: modulus, group element, polynomial degree,
noise, share count, nonce. They include boundary and invalid values, and they check metamorphic
relations rather than fixed expected values wherever possible, because a relation cannot be
satisfied by memorizing one output. The terminal shape's equivalent is the **family** a structural
judgement is graded over — same discipline, same reason: grade against a relation over parameters
the participant cannot see, never against the case in front of them.

Whatever that family is, assert it cannot have collapsed. An empty or degenerate family makes the
comparison vacuously true and accepts everything, so check every run that the family still fails
some obviously-wrong answer, and fail closed and loudly when it does not. A checkpoint nobody can
fail is worse than no checkpoint, because it reports as a pass.

**Mutation tests** are the check on the checks. Break the reference on purpose, assert the hidden
tests catch each break. Include the always-succeed verifier — a verifier that returns `correct:
true` unconditionally is the one defect that silently invalidates an entire problem, and it
cannot be expressed as a broken submission. In the terminal shape the target is the judge rather
than the submission; see "What the mutation suite has to cover once the CLI is the grader" above.

### Equivalent mutants

Some plausible-looking mutations change no verdict, so no correct test can distinguish them.
Listing one produces a permanent "survived" that trains authors to ignore the suite. Two families
of them show up repeatedly:

- **Mathematically identical rewrites.** Reducing once at the end and leaving a running value
  unnormalized before the loop are both equivalent to round-by-round reduction under Python's
  floored `%`.
- **Branches that change a message, not an outcome.** A guard that rejects an out-of-range answer
  before the comparison that would have rejected it anyway is there for the wording. Removing it
  is an equivalent mutant, and the wording is still worth keeping.

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
- [ ] Changing the seed changes the fixtures.
- [ ] The mutation suite kills every listed defect, and every equivalent mutant left out is
      explained in a comment where a reader will look for it.

Starter shape:

- [ ] At least one checkpoint fails in the shipped starter state.
- [ ] Every checkpoint passes with the reference.
- [ ] `/verify` scores per checkpoint and echoes the id.
- [ ] Timeout, malformed request, and unknown checkpoint are all handled safely.

Terminal shape:

- [ ] **You have played it through in the container**, by hand, from the compose service rather
      than from a checkout — `docker compose up`, then `docker exec -w /root <container> <verb>
      show` and onwards. Every problem below the line was found this way and by no test: a case
      whose parameters made a stage unanswerable, a `show` that never said what to type next.
- [ ] `show` alone names the subject, this deployment's numbers, and the literal next command for
      every stage, and says nothing about a flag anyone has not earned.
- [ ] Every stage refuses a wrong answer with what is not satisfied, and never with the answer.
- [ ] The transfer stage is refused *and* invisible until the stages before it are cleared.
- [ ] The flag is released for exactly one progress state, checked over every subset.
- [ ] Nothing participant-facing mentions `make`, a starter, or a file to edit — including
      `metadata.json` and both READMEs.
- [ ] Neither the writeup nor the hidden tests reach the participant-facing bundle.
- [ ] Both READMEs carry the **Assurance scope** section, and nothing in the problem claims
      the reference or the hidden tests are confidential or tamper-resistant.
      `scripts/assurance-scope.test.ts` checks this; it exists because the whole catalog had
      drifted into claiming it once already.
- [ ] A `scripts/<id>.test.ts` runs the above in CI.
