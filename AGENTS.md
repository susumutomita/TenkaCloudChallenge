# AGENTS.md — TenkaCloudChallenge authoring contract

This repository owns public problem metadata and payloads. TenkaCloud owns deployment, scoring dispatch, compatibility decisions, and the participant/admin applications. Agents do not need a repository-specific skill: this file is the canonical authoring procedure and is loaded from the repository root.

## Repository boundary

- `challenges/<id>/` and `battles/<id>/` are the unit of ownership. Keep a problem's metadata, runtime code, README files, fixtures, and tests together there.
- `runtimes/<family>/` is only for one runtime implementation consumed unchanged by two or more problems. A family runtime must not become a dumping ground for unrelated problem code.
- Do not add problem-specific suites under root `scripts/`. Root scripts are limited to catalog contract validation.
- Do not expose credentials, flags, hidden checks, fixture seeds, or reference answers on participant-visible surfaces or in participant images.
- Do not run deploy, destroy, release, or production cloud commands from this repository.
- `SCHEMA.json` is the metadata shape. Executable runtime support is owned by TenkaCloud; a schema value is not proof that the platform can deploy it.

## How to add or change a problem

1. Define the participant outcome before choosing a service: role, initial symptom, first useful action, observable success condition, and required runtime.
2. Copy the closest current problem with the same runtime and scoring contract. Good starting points are `challenges/hello-world` for an AWS flag Challenge, `battles/hello-world-battle` for an uptime Battle, `challenges/sqli-demo` for a local `verify` Challenge, and `challenges/wp-exposed-backup` for local `multi-verify`.
3. Change every problem identity and contract field: directory name, `id`, Japanese top-level text, `i18n.en`, runtime, endpoints, scoring, hints, and problem-specific resources. Do not leave starter answers or names behind.
4. Write both `README.md` and `README.ja.md`. Describe the story, deployed/runtime components, intended participant route, scoring evidence, safety boundary, cost-bearing resources, teardown, and local verification commands. Do not claim a behavior that was not exercised.
5. Run the problem's own documented tests. For local problems this normally includes `make test` and, where provided, `make reference-test`; inspect the problem Makefile instead of assuming target names.
6. Run the shared catalog gate from the repository root:

   ```bash
   make install
   make agent-gate
   ```

7. For a runtime or participant-flow change, validate the strongest reproducible participant route available locally. Prefer a browser harness that renders the real Portal components and drives only participant-visible inputs. Catalog validation alone is not runtime proof, but a real AWS event and an independent third-party playtest are optional pre-event rehearsals, not merge gates; record them as not run without blocking development.

One PR should normally contain one problem. A shared-runtime change may cover its affected family, but list every consumer and the runtime evidence in the PR.

## Verification boundary

`make agent-gate` validates all metadata against `SCHEMA.json`, bilingual README presence, simulation overlays, and catalog/platform cross-references. CI runs this lightweight gate.

It does not prove that CloudFormation deploys, a Compose service becomes reachable, the intended solution works, or a verifier rejects shortcuts. Those claims require the owning problem's tests and an appropriate runtime smoke test.

## §7 AWS Console deep links

Keep literal `/` characters in AWS Console deep-link fragments unless the target console requires otherwise. Verify the generated link in the participant role; a syntactically valid URL is not evidence that the destination or permissions work.

## §9 Battle participant-action gate

A Battle must not earn uptime points merely because deployment emitted a working URL. Leave score-target defaults empty until the participant registers or configures them, expose a non-scoring host hint where needed, and keep endpoints overridable. `battles/hello-world-battle` is the minimal reference.

## §10 Participant-visible content

Participants can see `shortDescription`, `instructions`, endpoint labels/descriptions, hints, and public phase/disruption descriptions. Describe the symptom, asset, first action, and goal. Do not reveal vulnerability names, exact hidden predicates, hardened state, surprise timing, or answers. `description` is author/operator context and must not be treated as participant guidance.

## §11 Disruptions and platform contracts

A disruption description must match an executable mechanism:

- `effect` is scoring pressure only and must not claim a real cloud fault.
- `action` is a real platform-executed fault, needs a valid target and a reversible path, and must not also double-charge with an `effect`.
- Operator-driven probes belong with an operator runbook.

Multiple or mixed disruptions require a `redteam/README.md` describing targeting, recovery, revert, and a pre-event smoke test. New scoring kinds, runtime adapters, endpoint semantics, or Portal slots require a coordinated TenkaCloud change; do not reserve a schema value and call it supported.

## §12 Participant instructions

Every problem needs Japanese `instructions` and `i18n.en.instructions`. Use a short structure: framing, concrete first action, and observable goal. Defining unfamiliar terms is not a spoiler. For multi-resource problems, add a non-spoiler `diagram.svg` when it materially helps orientation.

### §12b Target reader

Participant-visible text — `shortDescription`, `instructions`, hints, starter docstrings, and workbench screen text — is written for a reader with Japanese junior-high-school mathematics and one beginner Python book.

- Assume only: negative numbers, literal expressions, linear/simultaneous/quadratic equations, powers, square roots, prime factorisation, division remainders, basic probability; Python variables, `if`, `for`, function definitions, lists, dicts.
- Do not assume: `mod` notation (say 「割った余り」 first, then introduce the word), Σ, logarithms, matrices, vectors, general polynomial theory, set notation, congruences, or any cryptographic vocabulary.
- Every term beyond that baseline is defined at or before first use, in the same document. A glossary entry counts; so does an inline 「(= …)」.
- Every formula or procedure the solution needs is given in the statement or the starter, with a worked example in one-digit numbers. Problems test applying and understanding a given procedure, never deriving it. A needed formula must not sit behind a paid hint.
- Difficulty lives in the work — implementation, case analysis, constructing counterexamples, transfer to unseen parameters — never in the reading.
- Check this bar with a participant-role read-through over participant-visible text only: the situation, first action, observable feedback, and definition of done must all be recoverable without repository internals. The author or reviewer may perform this check, and a deterministic browser assertion may record it; an independent third party is not required for merge.

### §12c Problem quality bar — low floor, high ceiling

Every problem in this catalog, on every track, is designed for both audiences at once: a junior-high student can get in, and a veteran engineer still finds it worth their time.

- **Low floor**: within the first screen of the statement the participant knows the situation — who they are, what broke or what is at stake — the first concrete action, and what they will see when they take it. The first checkpoint is earnable by direct engagement with the visible surfaces. If a reader finishes the statement and still cannot say what to try first, the problem fails this bar.
- **High ceiling**: the closing checkpoints are worth an experienced engineer's attention — constructing a counterexample, making the same code survive unseen parameters, exploiting a stated gap — never more transcription of earlier steps. Difficulty lives in the work, not in withheld information.
- **Story with intent**: the scenario is coherent and motivates the work. Every checkpoint has a reason that follows from the story, and a reader can say why this step comes next. A section that starts out of nowhere (唐突) is a defect, the same class as an undefined term.
- **Neither a task list nor a cliff**: a statement that walks the reader step-by-step through the answers turns the problem into 作業ゲー and fails; a statement that offers no foothold at all also fails. The statement's job is footholds and feedback loops — what to observe first, what the observation should provoke — while the insight stays the participant's to have.
- **Participant-fidelity evidence**: a playability claim must use only what a participant can see — the statement, the editor's starter files, Inspect evidence, public-test output, and /verify verdicts with their §15 messages. This evidence may come from a deterministic browser harness or a human run. An independent tester and live AWS are not required for merge. Runs that read repository internals, probe undocumented endpoints, or bypass the participant surface prove nothing about playability and must not be cited as if they did.

### §12d Hints are a staircase

The owner's bar, set on a live run (Issue #712): a reader with junior-high mathematics and no vocabulary must be able to open the hints and complete the checkpoint, and after the last hint must be able to say これは何か / どういう仕組みか / 数式で落とすとどうなるか / 計算はどうやるか. Difficulty is understanding the mechanism, never arithmetic bulk.

- Three rungs, one hint each, in this order: (1) 仕組み — what the quantity is and why it hides, binds, or recovers, in words, no formula yet; (2) 数式 — the formula, run once on one-digit numbers (「割った余り」 before `%`); (3) 手順 — the reader's own numbers one step at a time, ending where the reader writes the answer. Battles render rung 3 against the reader's projection (`hints.ts`); Challenge hints are static text, so rung 3 walks the on-screen names (「画面の w[0] と r0 を見る → w[0] − r0 → 負なら p を足す → …」) and never embeds a sample seed's finished numbers.
- The statement is rung 0, for free: what the thing is, and the formula or the line to type (§12b — a needed formula never sits behind a paid hint). A hint that opens with strategy (「どちらを選ぶか」) or with typos before the mechanism fails this bar.
- No leaps: every term a rung uses is defined in the statement or in an earlier rung. Hint penalties stay within §14.
- Completion check, over participant-visible text only (statement, hints, Inspect evidence, public-test output): a junior-high-role reader, for each graded checkpoint, (a) says in one sentence why the step exists, (b) produces the value by hand from rung 3 without running the given code, (c) flags any term used before it is defined. The author may run this reader on one problem; before a rewrite fans out across problems, an independent run is required and its first pass must have caught at least one real leap — a pass that flags nothing is a prompt that is too soft, not a problem that is done.

## §13 Local-play containers

- Declare `runtime.provider: "docker"`, `runtime.engine: "compose"`, and a real `runtime.entry`.
- Use `verify` or `multi-verify`; the platform delegates the verdict to the container.
- Derive answers and privileged values from injected per-run secrets. Do not commit them or copy hidden/reference material into the participant image.
- Bind every published port to `127.0.0.1`, include a real health check, and run the image as a non-root user.
- Keep the participant surface and verifier authority separated even if they share a process.
- A Compose build context may point into `runtimes/<family>/` only when that exact implementation is shared by multiple problems. Changing it requires testing affected consumers.

## §14 Challenge scoring

Challenge scores follow the tier contract enforced by the validator:

- difficulty 1–2: 100 points and 5-point wrong-answer penalty
- difficulty 3: 200 points and 10-point penalty
- difficulty 4–5: 300 points and 15-point penalty
- all hint penalties together must be no more than half the base score

For `multi-verify`, checkpoint points sum to the tier total, checkpoint and hint IDs are unique, English labels mirror Japanese labels, and the verifier echoes the submitted `checkpointId`. Battles do not use this fixed-total table.

## §15 Verify failure feedback

A `/verify` response for a failed `kind: "code"` checkpoint should carry an optional `message`: the hidden checker's property-level failure list joined with `"; "` and truncated to 1900 characters. The platform's `VerifyResponseSchema` already accepts `message` (string, max 2000); do not invent another field name.

- `message` appears only when `correct` is `false`, and only for code checkpoints. Direct-answer checkpoints (environment / window / audit / observe and similar) never return a reason — a reason would narrow the expected value.
- Allowed content: which property or documented rule was broken (something the starter docstring or README already states), and echoes of values the participant's own submission computed or of public parameters.
- Forbidden content: hidden fixture data, expected values, seeds, flags, and the content of any paid hint. When adding or editing a checker failure string, read the problem's `metadata.json` hints and confirm the message does not pre-empt one (precedent: #629). If a checker string interpolates hidden fixture data, keep the property-name prefix and drop the interpolated part.
- `message` never changes the verdict, and a participant-facing proxy passes it through only as a string, truncated to 2000 characters, dropping every other extra field.

## Course placement

Use `track.id`, `track.order`, and `track.chapter` for participant ordering. Use `courseAlignment` only for a pinned external-course mapping. Do not create a second prerequisite graph in catalog metadata; the platform presents the declared track order.

## Cost claims

Do not maintain or quote a static AWS dollar table in this repository. In each problem README, enumerate cost-bearing resources, supported/default Region, expected session duration, teardown, and resources that continue billing until deletion. Exact estimates belong in current AWS pricing/billing tools and still depend on usage, Region, account discounts, and data transfer.
