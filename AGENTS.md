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

7. For a runtime or participant-flow change, validate the real route through TenkaCloud: Portal → problem start → participant surface → submission. Catalog validation alone is not runtime proof.

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
