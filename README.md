# TenkaCloudChallenge

> 日本語版: [README.ja.md](./README.ja.md)

The **problem library** for the [TenkaCloud](https://github.com/susumutomita/TenkaCloud) platform. The platform repo (CDK / Lambda / 3 SPAs) mounts this repo as a **git submodule under `problems/`** and ships its contents inside `source.zip` via `make deploy`. **Problem authors do not need to clone the platform repo** — adding a problem only requires changes in this repo.

> **This repository is public.** If you plan to add problems that contain spoilers or answers, host them in a separate private repo and deliver them via the `ChallengePayloadStack` S3 path (= ADR-008). This repo holds the **base problem set** — public problems that can ship bundled with the platform under an OSS license.

## Related ADRs (platform side)

- [ADR-008](https://github.com/susumutomita/TenkaCloud/blob/main/docs/architecture/) — Private problem payload separation (= S3 path for add-on problems)
- [ADR-010](https://github.com/susumutomita/TenkaCloud/blob/main/docs/architecture/adr-010-api-first-cli-mcp.html) — Make the operator path API-first
- [ADR-012](https://github.com/susumutomita/TenkaCloud/blob/main/docs/architecture/adr-012-problem-plugin-architecture.html) — One problem = one plugin (3-asset model: `metadata.json` + `template.yaml` + optional `portal/services`)

## Directory layout

The root of this repo is mounted as `problems/` in the platform repo (= the submodule mount point).

```
.
├── battles/                       # Battle (real-time, head-to-head)
│   └── <id>/
│       ├── metadata.json
│       ├── template.yaml
│       ├── portal/                # Optional: <slot>.tsx (= participant-portal slot UI)
│       └── services/              # Optional: problem-specific code (docker-compose / Lambda, etc.)
├── challenges/                    # Challenge (self-paced)
│   └── <id>/
│       ├── metadata.json
│       └── template.yaml
├── SCHEMA.json                    # JSON Schema for metadata.json (synced with the platform repo)
├── index.json                     # Catalog index (built from every metadata.json)
├── CATALOG.md / CATALOG.ja.md     # Catalog docs (synced with the platform repo's problems/README)
├── scripts/validate-problems.ts   # Validates metadata + cross-refs in local + CI
├── package.json + bun.lock        # Catalog CI deps (ajv etc.)
└── .github/workflows/ci.yml       # Runs the validator in GitHub Actions
```

One problem directory follows the ADR-012 *thick metadata* DSL. The schema is [`SCHEMA.json`](./SCHEMA.json) (kept in sync with the platform repo).

## Delivery flow

```
[contributor] open a PR that touches battles/<id>/ or challenges/<id>/
       │
       ▼
[merge to main]
       │
       ▼
[platform repo (= TenkaCloud) bumps the submodule pointer]
       │   git submodule update --remote problems
       │   git add problems && git commit
       ▼
[make deploy] prepare-source-bundle.sh bundles `problems/` (= this repo's contents)
       into source.zip → S3 → CodeBuild deploys template.yaml from the local path.
```

Bumping the submodule pointer is a platform-repo maintainer action. To automate it, wire a GitHub Action (`git submodule update --remote` → PR flow, the same shape as the old `catalog-pr.yml`).

## Adding a new problem

1. Write `<category>/<id>/metadata.json` to conform to [`SCHEMA.json`](./SCHEMA.json).
2. Write `template.yaml` (a single-page CFn template). It must accept the required parameters (`NamePrefix` / `TenkaCloudAccountId` / `ExternalId`) and create the required IAM role (`ParticipantViewerRole`).
3. Optionally add `portal/<slot>.tsx` / `services/`.
4. Run `bun run validate` locally to check schema + cross-references.
5. Get the PR reviewed and merged to main → a platform-repo maintainer bumps the submodule pointer.

For scaffolding, use the platform repo's `/create-problem` Claude Code skill or `bun run scripts/tenkacloud-problem.ts create <id> --kind <kind>` (the scaffolding CLI lives on the platform side).

## See also

- Platform repo: <https://github.com/susumutomita/TenkaCloud>
