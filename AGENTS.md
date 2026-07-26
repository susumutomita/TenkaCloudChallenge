# AGENTS.md — TenkaCloudChallenge

This is the working contract for autonomous coding agents, including Symphony, Codex, and Claude Code.

## Repository boundary

TenkaCloudChallenge owns problem content, learning material, scenarios, metadata, templates, local workloads, grading logic, and catalog indexes.

- Declare capabilities a problem requires; do not implement simulator capabilities here.
- TenkaCloudSimulator declares the capabilities it implements and must not contain problem IDs or problem-specific branches.
- TenkaCloud performs the compatibility comparison and platform integration.
- Do not move Challenge-specific scenarios or StackStack content into the TenkaCloud platform repository.

## Setup

```bash
make install
```

CI and clean agent workspaces use:

```bash
make install_ci
```

## Deterministic completion contract

Run this before creating or updating a pull request:

```bash
make agent-gate
```

`make agent-gate` is the only machine-readable completion contract. It runs the complete catalog test suite and the static checks for metadata, CloudFormation templates, simulator workloads and compatibility, generated index drift, cost drift, and course drift.

A task is incomplete while this command fails. Fix the implementation or content. Do not weaken validators, schemas, test discovery, cost checks, or compatibility checks to make a change pass.

## Agent workflow

1. Read the Issue and write explicit acceptance criteria.
2. Reproduce the current behavior or record the current catalog state.
3. Inspect existing problems and shared scripts before adding new helpers.
4. Keep changes inside the Issue scope.
5. Add or update tests for every behavior change.
6. Run `make agent-gate` until it passes.
7. Review the diff for correctness, security, learning quality, unintended hints, stale generated files, and cross-repository contract impact.
8. Leave proof in the pull request: acceptance criteria, risk, commands executed, results, and known limitations.

## Risk boundaries

Treat the following as high risk and do not auto-merge them:

- `SCHEMA.json`, shared metadata contracts, or compatibility semantics
- CloudFormation security rules or cost estimation rules
- simulator capability requirements
- grading, flags, reference solutions, or participant-visible secrets
- GitHub Actions, `Makefile`, `AGENTS.md`, `CLAUDE.md`, dependency manifests, or lockfiles
- changes that can leave billable cloud resources behind

New problem content that stays within existing contracts is medium risk. Documentation-only and test-only changes can be low risk when they do not reveal solutions or secrets.

## Prohibited actions

- Do not run deploy, destroy, release, or production cloud commands.
- Do not use AWS credentials or other production secrets.
- Do not force-push or push directly to a protected branch.
- Do not use `npx`; use `bunx`.
- Do not use silent fallbacks, placeholder implementations, skipped tests, focused tests, or empty verification results.
- Do not edit generated `index.json` or `cost-report.json` by hand; run the generators.
- Do not add an Issue-unrelated cleanup to the same pull request.

## Problem authoring rules

- Every problem must satisfy `metadata.json` and catalog schema requirements.
- Template outputs and portal references must resolve.
- CloudFormation templates must pass ASCII and security checks.
- Container problems must exercise starter, reference, mutation, and `/verify` behavior through the real test suite.
- Simulator workloads must use the compatibility contract rather than problem-specific simulator logic.
- Update generated catalog and cost artifacts whenever their source changes.

## Pull request evidence

Include these sections:

```markdown
## Acceptance criteria
- [x] ...

## Risk
- level: low | medium | high
- reasons: ...

## Validation
- make agent-gate: passed

## Cross-repo impact
- TenkaCloud: ...
- TenkaCloudSimulator: ...
- TenkaCloudPassport: none unless explicitly related
```
